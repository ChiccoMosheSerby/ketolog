import { useMemo } from 'react';
import { buildAnalytics } from '../lib/analytics.js';
import { zoneInfo, fmt, heDate, TARGET } from '../lib/helpers.js';
import CarbRing from './CarbRing.jsx';
import './Dashboard.scss';

// dd.m — compact axis/label date (RTL-safe: reads as a single number cluster)
function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return Number(d) + '.' + Number(m);
}

// ---- tiny inline charts (no chart lib — keeps the bundle lean) ----

// Daily net-carb bars over the (chronological) log, oldest→newest left→right,
// each bar colored by the same zone logic as the rest of the app, with the
// daily target drawn as a dashed line across the plot.
function CarbTrend({ series, target }) {
  const W = 720;
  const H = 200;
  const padX = 8;
  const padTop = 14;
  const padBottom = 26;
  const plotH = H - padTop - padBottom;
  const max = Math.max(target, ...series.map((p) => p.total)) * 1.12 || 1;
  const n = series.length;
  const slot = (W - padX * 2) / n;
  const barW = Math.max(2, Math.min(26, slot * 0.7));
  const y = (v) => padTop + plotH * (1 - v / max);
  const targetY = y(target);
  // thin out x labels so they never collide
  const step = Math.ceil(n / 12);

  return (
    <div className="chart-scroll">
      <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label="מגמת פחמימות נטו יומית">
        {/* target line */}
        <line x1={padX} x2={W - padX} y1={targetY} y2={targetY}
              stroke="var(--olive-soft)" strokeWidth="1.5" strokeDasharray="5 5" />
        <text x={W - padX} y={targetY - 5} textAnchor="end" className="trend-tl">
          יעד {fmt(target)} ג'
        </text>
        {series.map((p, i) => {
          const cx = padX + slot * i + (slot - barW) / 2;
          const yy = y(p.total);
          const h = Math.max(1, padTop + plotH - yy);
          return (
            <g key={p.date}>
              <rect x={cx} y={yy} width={barW} height={h} rx="2.5"
                    fill={zoneInfo(p.total, target).color}>
                <title>{`${shortDate(p.date)} · ${fmt(p.total)} ג'`}</title>
              </rect>
              {i % step === 0 && (
                <text x={cx + barW / 2} y={H - 8} textAnchor="middle" className="trend-x">
                  {shortDate(p.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Average keto macro split (calorie %) drawn as a stacked bar, mirroring the
// header's TargetLegend so the two read the same way.
function MacroBalance({ macroAvg }) {
  const segs = [
    { key: 'fat', label: 'שומן', pct: macroAvg.fat, color: 'var(--olive)' },
    { key: 'protein', label: 'חלבון', pct: macroAvg.protein, color: 'var(--protein)' },
    { key: 'carb', label: 'פחמ׳', pct: macroAvg.carb, color: 'var(--amber)' },
  ];
  return (
    <div className="macro">
      <div className="macro-bar">
        {segs.map((s) => (
          <i key={s.key} style={{ width: s.pct + '%', background: s.color }} title={`${s.label} ${s.pct}%`} />
        ))}
      </div>
      <div className="macro-legend">
        {segs.map((s) => (
          <span className="it" key={s.key}>
            <span className="dot" style={{ background: s.color }} />
            {s.label} <b>{s.pct}%</b>
          </span>
        ))}
      </div>
      <div className="macro-foot">
        ממוצע מתוך {macroAvg.days} ימים עם פירוט מאקרו · ~{macroAvg.kcal} קק"ל ליום ·
        היעד הקטוגני: שומן 70–75% · חלבון 20–25% · פחמ׳ 5–10%
      </div>
    </div>
  );
}

// Weight over time as a sparkline polyline with start/min/max framing.
function WeightSpark({ weight }) {
  const W = 720;
  const H = 150;
  const padX = 10;
  const padY = 16;
  const pts = weight.points;
  const lo = Math.min(...pts.map((p) => p.w));
  const hi = Math.max(...pts.map((p) => p.w));
  const span = hi - lo || 1;
  const x = (i) => padX + (i / Math.max(1, pts.length - 1)) * (W - padX * 2);
  const y = (w) => padY + (1 - (w - lo) / span) * (H - padY * 2);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.w).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts.length - 1).toFixed(1)} ${H - padY} L${x(0).toFixed(1)} ${H - padY} Z`;

  return (
    <div className="chart-scroll">
      <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
           aria-label="מגמת משקל">
        <path d={area} fill="var(--green-tint)" stroke="none" />
        <path d={d} fill="none" stroke="var(--accent-ink)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.w)} r={i === pts.length - 1 ? 4 : 2.5}
                  fill="var(--accent-ink)">
            <title>{`${shortDate(p.date)} · ${fmt(p.w)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// Horizontal "count" bars for the most-logged meal categories.
function CategoryBars({ categories }) {
  const top = categories.slice(0, 6);
  const max = Math.max(...top.map((c) => c.count)) || 1;
  return (
    <div className="cats">
      {top.map((c) => (
        <div className="cat-row" key={c.cat}>
          <span className="cat-name" title={c.cat}>{c.cat}</span>
          <span className="cat-track">
            <i style={{ width: (c.count / max) * 100 + '%' }} />
          </span>
          <span className="cat-meta">{c.count} · {fmt(c.avg)} ג' לארוחה</span>
        </div>
      ))}
    </div>
  );
}

function Tile({ num, sub, lab, tone }) {
  return (
    <div className={'d-tile' + (tone ? ' tone-' + tone : '')}>
      <span className="d-num">{num}{sub && <span className="d-sub">{sub}</span>}</span>
      <span className="d-lab">{lab}</span>
    </div>
  );
}

export default function Dashboard({ days, target = TARGET }) {
  const a = useMemo(() => buildAnalytics(days, target), [days, target]);

  if (!a.hasData) {
    return (
      <div className="dashboard">
        <div className="empty">
          עדיין אין נתונים לניתוח. הוסף ארוחות בלשונית "היום" והתובנות יופיעו כאן.
        </div>
      </div>
    );
  }

  const trendNote =
    a.avg7 && a.loggedDays > 7
      ? a.avg7 < a.avg
        ? `ממוצע 7 הימים האחרונים (${fmt(a.avg7)} ג') נמוך מהממוצע הכולל — מגמה טובה ⬇`
        : `ממוצע 7 הימים האחרונים: ${fmt(a.avg7)} ג'`
      : null;

  return (
    <div className="dashboard">
      {/* headline tiles */}
      <div className="panel d-panel">
        <h2>תמונת מצב</h2>
        <div className="d-tiles">
          <div className="d-tile d-ring">
            <CarbRing consumed={a.avg} target={target} size={66} stroke={7}>
              <span className="ring-num">{fmt(a.avg)}</span>
            </CarbRing>
            <span className="d-lab">ממוצע נטו ליום (יעד {fmt(target)})</span>
          </div>
          <Tile num={a.inTargetRate} sub="%" lab={`ימים ביעד (${a.inTargetCount}/${a.loggedDays})`}
                tone={a.inTargetRate >= 70 ? 'good' : a.inTargetRate >= 40 ? 'warn' : 'bad'} />
          <Tile num={a.currentStreak} lab="רצף נוכחי ביעד" tone={a.currentStreak > 0 ? 'good' : null} />
          <Tile num={a.longestStreak} lab="הרצף הארוך ביותר" />
          <Tile num={a.loggedDays} lab="ימים מתועדים" />
          <Tile num={a.totalMeals} sub={` · ${fmt(a.avgMeals)}/יום`} lab="ארוחות נרשמו" />
        </div>
        {a.span && (
          <div className="d-span">מתועד מ-{heDate(a.span.from)} עד {heDate(a.span.to)}</div>
        )}
      </div>

      {/* carb trend */}
      <div className="panel d-panel">
        <h2>מגמת פחמימות נטו</h2>
        <CarbTrend series={a.series} target={target} />
        {trendNote && <div className="d-note">{trendNote}</div>}
      </div>

      {/* best / worst */}
      <div className="panel d-panel">
        <h2>שיאים</h2>
        <div className="d-records">
          {a.best && (
            <div className="rec good">
              <span className="rec-cap">היום הנקי ביותר</span>
              <span className="rec-val">{fmt(a.best.total)} ג'</span>
              <span className="rec-date">{heDate(a.best.date)}</span>
            </div>
          )}
          {a.worst && (
            <div className="rec bad">
              <span className="rec-cap">היום הגבוה ביותר</span>
              <span className="rec-val">{fmt(a.worst.total)} ג'</span>
              <span className="rec-date">{heDate(a.worst.date)}</span>
            </div>
          )}
        </div>
        {a.topMeals.length > 0 && (
          <>
            <div className="d-subhead">הארוחות עתירות הפחמימות</div>
            <ul className="d-list">
              {a.topMeals.map((m, i) => (
                <li key={i}>
                  <span className="li-carb">{fmt(m.carbs)} ג'</span>
                  <span className="li-label">{m.label}</span>
                  <span className="li-date">{shortDate(m.date)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* macro balance */}
      {a.macroAvg && (
        <div className="panel d-panel">
          <h2>איזון מאקרו ממוצע</h2>
          <MacroBalance macroAvg={a.macroAvg} />
        </div>
      )}

      {/* weight */}
      {a.weight && (
        <div className="panel d-panel">
          <h2>מגמת משקל</h2>
          <div className="d-tiles compact">
            <Tile num={fmt(a.weight.start)} lab="התחלה" />
            <Tile num={fmt(a.weight.current)} lab="נוכחי" />
            <Tile num={(a.weight.delta > 0 ? '+' : '') + fmt(a.weight.delta)} lab="שינוי"
                  tone={a.weight.delta < 0 ? 'good' : a.weight.delta > 0 ? 'warn' : null} />
          </div>
          <WeightSpark weight={a.weight} />
        </div>
      )}

      {/* activity */}
      <div className="panel d-panel">
        <h2>פעילות</h2>
        <div className="d-tiles compact">
          <Tile num={a.activity.runDays} sub={` · ${a.activity.runRate}%`} lab="ימי ריצה" />
          <Tile num={a.activity.absDays} lab="ימי בטן" />
        </div>
      </div>

      {/* categories */}
      {a.categories.length > 0 && (
        <div className="panel d-panel">
          <h2>קטגוריות מובילות</h2>
          <CategoryBars categories={a.categories} />
        </div>
      )}
    </div>
  );
}
