import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../lib/i18n.js';
import { buildAnalytics } from '../lib/analytics.js';
import { fmt, heDate, zoneInfo, TARGET } from '../lib/helpers.js';
import CarbRing from './CarbRing.jsx';
import './Dashboard.scss';

const pad2 = (n) => String(n).padStart(2, '0');
// "08:00–09:00" — the one-hour bucket a meal time falls into
const hourRange = (h) => `${pad2(h)}:00–${pad2((h + 1) % 24)}:00`;

// Compact "Jul 5" — for the trend-chart axis ends, where the full heDate
// (e.g. "Sunday, July 5, 2026") would overflow. Locale-aware (day + month).
const shortDate = (iso) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' })
    .format(new Date(y, m - 1, dd));
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const addDaysISO = (iso, k) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + k);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

// Catmull-Rom → cubic-bézier: a smooth path through the given {x,y} points.
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0].x} ${pts[0].y}` : '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  const t = 0.18; // tension
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// ---- small presentational pieces ----

function Tile({ num, sub, lab, tone }) {
  return (
    <div className={'d-tile' + (tone ? ' tone-' + tone : '')}>
      <span className="d-num">{num}{sub && <span className="d-sub">{sub}</span>}</span>
      <span className="d-lab">{lab}</span>
    </div>
  );
}

// A GitHub-contributions-style strip: one square per calendar day, colored by
// its status class (k-good / k-over / k-missed / k-future / k-today). Shared by
// the progress trend and the keto-period sections.
function DayStrip({ cells }) {
  const { t } = useTranslation();
  return (
    <div className="day-strip">
      {cells.map((c) => (
        <span
          key={c.date}
          className={'kcell k-' + c.status}
          title={c.total != null ? t('dashboard.dayCarbsTitle', { date: heDate(c.date), value: fmt(c.total) }) : heDate(c.date)}
        />
      ))}
    </div>
  );
}

// Net-carb progress over the whole log. A layered area chart across *every*
// calendar day between the first and last logged day: the raw daily line +
// gradient fill (broken over un-logged gaps), a smoothed 7-day trend line, a
// dashed target reference with a shaded over-target band, y-axis ticks, faint
// markers for un-logged days, and best/worst callouts. The svg scales to 100%
// width (non-scaling strokes stay crisp).
function TrendChart({ series, target, best, worst }) {
  const { t } = useTranslation();
  const W = 340;
  const H = 184;
  const padL = 30;
  const padR = 10;
  const padTop = 16;
  const padBottom = 22;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;

  const first = series[0].date;
  const last = series[series.length - 1].date;
  const spanDays = Math.max(1, daysBetween(first, last));

  const totals = series.map((p) => p.total);
  const peak = Math.max(...totals, target);
  const yMax = Math.max(5, Math.ceil((peak * 1.12) / 5) * 5); // nice round headroom
  const x = (date) => padL + (daysBetween(first, date) / spanDays) * plotW;
  const y = (v) => padTop + plotH * (1 - Math.min(v / yMax, 1));
  const baseY = padTop + plotH;

  // every calendar day in the span; total is null on days with nothing logged
  const byDate = new Map(series.map((p) => [p.date, p.total]));
  const days = [];
  for (let i = 0; i <= spanDays; i++) {
    const date = addDaysISO(first, i);
    const total = byDate.has(date) ? byDate.get(date) : null;
    days.push({ date, total, cx: x(date), cy: total == null ? null : y(total) });
  }
  const dayCount = days.length;
  const loggedDots = days.filter((d) => d.total != null);

  // daily line/area broken into runs of consecutive logged days (gaps stay gaps)
  const segments = [];
  let run = [];
  days.forEach((d) => {
    if (d.total != null) run.push(d);
    else if (run.length) { segments.push(run); run = []; }
  });
  if (run.length) segments.push(run);
  const segLine = (seg) => seg.map((d, i) => `${i ? 'L' : 'M'}${d.cx.toFixed(1)} ${d.cy.toFixed(1)}`).join(' ');
  const segArea = (seg) =>
    `${segLine(seg)} L${seg[seg.length - 1].cx.toFixed(1)} ${baseY} L${seg[0].cx.toFixed(1)} ${baseY} Z`;

  // trailing 7-calendar-day moving average, over whatever was logged in the window
  const maPts = days
    .map((d, i) => {
      const win = days.slice(Math.max(0, i - 6), i + 1).filter((w) => w.total != null);
      if (!win.length) return null;
      return { x: d.cx, y: y(win.reduce((s, w) => s + w.total, 0) / win.length) };
    })
    .filter(Boolean);
  const maPath = smoothPath(maPts);

  const yTarget = y(target);
  const ticks = [0, target, yMax];
  const showDots = loggedDots.length <= 60;
  const showGaps = dayCount <= 70; // faint marks for un-logged days, when not too dense
  const markable = loggedDots.length >= 3; // only flag records once there's a spread

  return (
    <div className="trend">
      <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={t('dashboard.trendAriaLabel')}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--olive)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--olive)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* over-target zone + gridlines */}
        <rect x={padL} y={padTop} width={plotW} height={Math.max(0, yTarget - padTop)}
              fill="var(--red)" opacity="0.06" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)}
                  stroke={t === target ? 'var(--amber)' : 'var(--line)'}
                  strokeWidth="1" strokeDasharray={t === target ? '4 4' : null}
                  vectorEffect="non-scaling-stroke" opacity={t === target ? 0.8 : 0.5} />
            <text x={padL - 5} y={y(t) + 3} textAnchor="end" className="trend-tick">{fmt(t)}</text>
          </g>
        ))}

        {/* raw daily series: gradient area + thin line, per logged run */}
        {segments.map((seg, i) =>
          seg.length > 1 ? <path key={'a' + i} d={segArea(seg)} fill="url(#trendFill)" /> : null
        )}
        {segments.map((seg, i) => (
          <path key={'l' + i} d={segLine(seg)} fill="none" stroke="var(--olive)" strokeWidth="1.25"
                strokeLinejoin="round" strokeLinecap="round" opacity="0.55"
                vectorEffect="non-scaling-stroke" />
        ))}

        {/* smoothed 7-day trend line */}
        {maPts.length >= 2 && (
          <path d={maPath} fill="none" stroke="var(--olive-dark)" strokeWidth="2.5"
                strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}

        {/* faint baseline marks for days with nothing logged */}
        {showGaps && days.filter((d) => d.total == null).map((d) => (
          <circle key={'g' + d.date} cx={d.cx} cy={baseY} r="1.3"
                  fill="var(--ink-soft)" opacity="0.4">
            <title>{t('dashboard.notLoggedTitle', { date: heDate(d.date) })}</title>
          </circle>
        ))}

        {/* per-day dots, colored by zone */}
        {showDots && loggedDots.map((d) => (
          <circle key={d.date} cx={d.cx} cy={d.cy} r={loggedDots.length <= 20 ? 3 : 2.2}
                  fill={zoneInfo(d.total, target).color} stroke="var(--paper)" strokeWidth="1"
                  vectorEffect="non-scaling-stroke">
            <title>{t('dashboard.dayCarbsTitle', { date: heDate(d.date), value: fmt(d.total) })}</title>
          </circle>
        ))}

        {/* best (lowest) / worst (highest) markers */}
        {markable && best && (
          <g>
            <circle cx={x(best.date)} cy={y(best.total)} r="4.5" fill="none"
                    stroke="var(--olive)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <text x={x(best.date)} y={y(best.total) + 15} textAnchor="middle" className="trend-mark best">
              ↓ {fmt(best.total)}
            </text>
          </g>
        )}
        {markable && worst && (
          <g>
            <circle cx={x(worst.date)} cy={y(worst.total)} r="4.5" fill="none"
                    stroke="var(--red)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <text x={x(worst.date)} y={y(worst.total) - 9} textAnchor="middle" className="trend-mark worst">
              ↑ {fmt(worst.total)}
            </text>
          </g>
        )}
      </svg>

      <div className="trend-axis">
        <span>{shortDate(first)}</span>
        <span>{shortDate(last)}</span>
      </div>
      <div className="strip-legend">
        <span className="it"><span className="ln solid" /> {t('dashboard.legendDaily')}</span>
        <span className="it"><span className="ln bold" /> {t('dashboard.legendMa7')}</span>
        <span className="it"><span className="ln dash" /> {t('dashboard.legendTarget', { value: fmt(target) })}</span>
      </div>
    </div>
  );
}

// Average keto macro split (calorie %) as a stacked bar, mirroring the header
// TargetLegend so the two read the same way.
function MacroBalance({ macroAvg }) {
  const { t } = useTranslation();
  const segs = [
    { key: 'fat', label: t('dashboard.macroFat'), pct: macroAvg.fat, color: 'var(--olive)' },
    { key: 'protein', label: t('dashboard.macroProtein'), pct: macroAvg.protein, color: 'var(--protein)' },
    { key: 'carb', label: t('dashboard.macroCarb'), pct: macroAvg.carb, color: 'var(--amber)' },
  ];
  return (
    <div className="macro">
      <div className="macro-bar">
        {segs.map((s) => (
          <i key={s.key} style={{ width: s.pct + '%', background: s.color }} title={t('dashboard.macroTitle', { label: s.label, pct: s.pct })} />
        ))}
      </div>
      <div className="macro-legend">
        {segs.map((s) => (
          <span className="it" key={s.key}>
            <span className="dot" style={{ background: s.color }} />
            <span className="lab">{s.label}</span>
            <b>{s.pct}<span className="pct">%</span></b>
          </span>
        ))}
      </div>
      <div className="macro-foot">
        {t('dashboard.macroFoot', { days: macroAvg.days, kcal: macroAvg.kcal })}
      </div>
    </div>
  );
}

// Horizontal bars of net carbs per hour-of-day, busiest hours first.
function HoursBars({ peakHours }) {
  const { t } = useTranslation();
  const top = peakHours.slice(0, 6);
  const max = Math.max(...top.map((h) => h.carbs)) || 1;
  return (
    <div className="cats">
      {top.map((h) => (
        <div className="cat-row" key={h.hour}>
          <span className="cat-name mono">{hourRange(h.hour)}</span>
          <span className="cat-track">
            <i style={{ width: (h.carbs / max) * 100 + '%', background: 'var(--amber)' }} />
          </span>
          <span className="cat-meta">{t('dashboard.hoursMeta', { carbs: fmt(h.carbs), count: h.count })}</span>
        </div>
      ))}
    </div>
  );
}

// Progress through the keto-period goal: a timeline bar (elapsed vs total) plus
// remaining days and in-target adherence over the period so far.
function KetoProgress({ keto }) {
  const { t } = useTranslation();
  return (
    <div className="keto">
      <div className="keto-hero">
        <span className="keto-num">{keto.done ? '✓' : keto.pct + '%'}</span>
        <span className="keto-lab">
          {keto.done
            ? t('dashboard.ketoDone', { months: keto.months })
            : t('dashboard.ketoProgress', { elapsed: keto.elapsed, totalDays: keto.totalDays, months: keto.months })}
        </span>
      </div>
      <div className="keto-bar">
        <i style={{ width: keto.pct + '%' }} />
      </div>
      {keto.strip?.length > 0 && (
        <>
          <DayStrip cells={keto.strip} />
          <div className="strip-legend">
            <span className="it"><span className="sw k-good" /> {t('dashboard.stripInTarget')}</span>
            <span className="it"><span className="sw k-over" /> {t('dashboard.stripOver')}</span>
            <span className="it"><span className="sw k-missed" /> {t('dashboard.stripMissed')}</span>
            <span className="it"><span className="sw k-future" /> {t('dashboard.stripFuture')}</span>
          </div>
        </>
      )}
      <div className="keto-foot">
        {heDate(keto.start)} – {heDate(keto.end)}
        {!keto.done && t('dashboard.ketoRemaining', { remaining: keto.remaining })}
        {keto.loggedInPeriod > 0 &&
          t('dashboard.ketoAdherence', { inTarget: keto.inTargetInPeriod, logged: keto.loggedInPeriod, adherence: keto.adherence })}
      </div>
    </div>
  );
}

// Average coffees/day + a breakdown by type (black / espresso / instant).
function Coffee({ coffee }) {
  const { t } = useTranslation();
  const types = [
    { key: 'black', label: t('dashboard.coffeeBlack'), n: coffee.types.black },
    { key: 'espresso', label: t('dashboard.coffeeEspresso'), n: coffee.types.espresso },
    { key: 'instant', label: t('dashboard.coffeeInstant'), n: coffee.types.instant },
    ...(coffee.types.other ? [{ key: 'other', label: t('dashboard.coffeeOther'), n: coffee.types.other }] : []),
  ];
  return (
    <div className="coffee">
      <div className="coffee-hero">
        <span className="coffee-num">{fmt(coffee.perDay)}</span>
        <span className="coffee-lab">{t('dashboard.coffeeHero', { total: coffee.total })}</span>
      </div>
      <div className="coffee-types">
        {types.map((t) => (
          <span className="chip" key={t.key}>
            {t.label} <b>{t.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard({ days, target = TARGET, today, ketoMonths, children }) {
  const { t } = useTranslation();
  const a = useMemo(
    () => buildAnalytics(days, target, { today, ketoGoal: { months: ketoMonths } }),
    [days, target, today, ketoMonths]
  );

  if (!a.hasData) {
    return (
      <div className="dashboard" data-tour="insights">
        <div className="empty">
          {t('dashboard.emptyData')}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="dashboard" data-tour="insights">
      {/* daily average + streaks — kept at the top of the tab */}
      <div className="panel d-panel">
        <h2>{t('dashboard.avgTitle')}</h2>
        <div className="d-tiles">
          <div className="d-tile d-ring">
            <CarbRing consumed={a.avg} target={target} size={66} stroke={7}>
              <span className="ring-num">{fmt(a.avg)}</span>
            </CarbRing>
            <span className="d-lab">{t('dashboard.avgNetPerDay', { target: fmt(target) })}</span>
          </div>
          <Tile num={a.longestStreak} sub={t('dashboard.daysSuffix')} lab={t('dashboard.longestStreak')} />
          <Tile num={a.currentStreak} sub={t('dashboard.daysSuffix')} lab={t('dashboard.currentStreak')}
                tone={a.currentStreak > 0 ? 'good' : null} />
        </div>
        {a.span && (
          <div className="d-span">{t('dashboard.span', { count: a.loggedDays, from: heDate(a.span.from), to: heDate(a.span.to) })}</div>
        )}
      </div>

      {/* 1 · average macro balance */}
      <div className="panel d-panel">
        <h2>{t('dashboard.macroBalanceTitle')}</h2>
        {a.macroAvg ? (
          <MacroBalance macroAvg={a.macroAvg} />
        ) : (
          <div className="d-note">{t('dashboard.macroNoData')}</div>
        )}
      </div>

      {/* AI insights slot — rendered right under the daily-average summary */}
      {children}

      {/* keto-period goal progress */}
      <div className="panel d-panel">
        <h2>{t('dashboard.ketoTitle')}</h2>
        {a.keto ? (
          <KetoProgress keto={a.keto} />
        ) : (
          <div className="d-note">
            {t('dashboard.ketoNoData')}
          </div>
        )}
      </div>

      {/* progress trend — sits under the keto-period timeline */}
      <div className="panel d-panel">
        <h2>{t('dashboard.progressTitle')}</h2>
        {a.series.length >= 2 ? (
          <TrendChart series={a.series} target={target} best={a.best} worst={a.worst} />
        ) : (
          <div className="d-note">{t('dashboard.progressNoData')}</div>
        )}
      </div>

      {/* records (best / worst day) */}
      <div className="panel d-panel">
        <h2>{t('dashboard.recordsTitle')}</h2>
        <div className="d-records">
          {a.best && (
            <div className="rec good">
              <span className="rec-cap">{t('dashboard.cleanestDay')}</span>
              <span className="rec-val">{t('common.grams', { value: fmt(a.best.total) })}</span>
              <span className="rec-date">{heDate(a.best.date)}</span>
            </div>
          )}
          {a.worst && (
            <div className="rec bad">
              <span className="rec-cap">{t('dashboard.highestDay')}</span>
              <span className="rec-val">{t('common.grams', { value: fmt(a.worst.total) })}</span>
              <span className="rec-date">{heDate(a.worst.date)}</span>
            </div>
          )}
        </div>
      </div>

      {/* 4 · peak carb hours */}
      <div className="panel d-panel">
        <h2>{t('dashboard.peakHoursTitle')}</h2>
        {a.peakHours.length ? (
          <HoursBars peakHours={a.peakHours} />
        ) : (
          <div className="d-note">{t('dashboard.peakHoursNoData')}</div>
        )}
      </div>

      {/* 5 · coffee per day */}
      <div className="panel d-panel">
        <h2>{t('dashboard.coffeeTitle')}</h2>
        {a.coffee.total ? (
          <Coffee coffee={a.coffee} />
        ) : (
          <div className="d-note">{t('dashboard.coffeeNoData')}</div>
        )}
      </div>
    </div>
  );
}
