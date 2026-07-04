import { useMemo } from 'react';
import { buildAnalytics } from '../lib/analytics.js';
import { fmt, heDate, TARGET } from '../lib/helpers.js';
import CarbRing from './CarbRing.jsx';
import './Dashboard.scss';

const pad2 = (n) => String(n).padStart(2, '0');
// "08:00–09:00" — the one-hour bucket a meal time falls into
const hourRange = (h) => `${pad2(h)}:00–${pad2((h + 1) % 24)}:00`;

// ---- small presentational pieces ----

function Tile({ num, sub, lab, tone }) {
  return (
    <div className={'d-tile' + (tone ? ' tone-' + tone : '')}>
      <span className="d-num">{num}{sub && <span className="d-sub">{sub}</span>}</span>
      <span className="d-lab">{lab}</span>
    </div>
  );
}

// Average keto macro split (calorie %) as a stacked bar, mirroring the header
// TargetLegend so the two read the same way.
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

// Horizontal bars of net carbs per hour-of-day, busiest hours first.
function HoursBars({ peakHours }) {
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
          <span className="cat-meta">{fmt(h.carbs)} ג' · {h.count} ארוחות</span>
        </div>
      ))}
    </div>
  );
}

// Progress through the keto-period goal: a timeline bar (elapsed vs total) plus
// remaining days and in-target adherence over the period so far.
function KetoProgress({ keto }) {
  return (
    <div className="keto">
      <div className="keto-hero">
        <span className="keto-num">{keto.done ? '✓' : keto.pct + '%'}</span>
        <span className="keto-lab">
          {keto.done
            ? `יעד ${keto.months} חודשי הקיטו הושלם!`
            : `${keto.elapsed} מתוך ${keto.totalDays} ימים · יעד ${keto.months} חודשים`}
        </span>
      </div>
      <div className="keto-bar">
        <i style={{ width: keto.pct + '%' }} />
      </div>
      <div className="keto-foot">
        {heDate(keto.start)} – {heDate(keto.end)}
        {!keto.done && ` · נותרו ${keto.remaining} ימים`}
        {keto.loggedInPeriod > 0 &&
          ` · ${keto.inTargetInPeriod}/${keto.loggedInPeriod} ימים ביעד בתקופה (${keto.adherence}%)`}
      </div>
    </div>
  );
}

// Average coffees/day + a breakdown by type (black / espresso / instant).
function Coffee({ coffee }) {
  const types = [
    { key: 'black', label: 'שחור', n: coffee.types.black },
    { key: 'espresso', label: 'אספרסו', n: coffee.types.espresso },
    { key: 'instant', label: 'נס', n: coffee.types.instant },
    ...(coffee.types.other ? [{ key: 'other', label: 'אחר', n: coffee.types.other }] : []),
  ];
  return (
    <div className="coffee">
      <div className="coffee-hero">
        <span className="coffee-num">{fmt(coffee.perDay)}</span>
        <span className="coffee-lab">כוסות קפה ליום בממוצע · {coffee.total} סה"כ ☕</span>
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
  const a = useMemo(
    () => buildAnalytics(days, target, { today, ketoGoal: { months: ketoMonths } }),
    [days, target, today, ketoMonths]
  );

  if (!a.hasData) {
    return (
      <div className="dashboard">
        <div className="empty">
          עדיין אין נתונים לניתוח. הוסף ארוחות בלשונית "היום" והתובנות יופיעו כאן.
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="dashboard">
      {/* daily average + streaks — kept at the top of the tab */}
      <div className="panel d-panel">
        <h2>ממוצע יומי ורצפים</h2>
        <div className="d-tiles">
          <div className="d-tile d-ring">
            <CarbRing consumed={a.avg} target={target} size={66} stroke={7}>
              <span className="ring-num">{fmt(a.avg)}</span>
            </CarbRing>
            <span className="d-lab">ממוצע נטו ליום (יעד {fmt(target)})</span>
          </div>
          <Tile num={a.longestStreak} sub=" ימים" lab="הרצף הארוך ביותר ביעד" />
          <Tile num={a.currentStreak} sub=" ימים" lab="הרצף הנוכחי ביעד"
                tone={a.currentStreak > 0 ? 'good' : null} />
        </div>
        {a.span && (
          <div className="d-span">{a.loggedDays} ימים מתועדים · {heDate(a.span.from)} – {heDate(a.span.to)}</div>
        )}
      </div>

      {/* AI insights slot — rendered right under the daily-average summary */}
      {children}

      {/* keto-period goal progress */}
      <div className="panel d-panel">
        <h2>תקופת הקיטו</h2>
        {a.keto ? (
          <KetoProgress keto={a.keto} />
        ) : (
          <div className="d-note">
            להגדרת יעד לתקופת הקיטו (למשל 3 חודשים), פתח/י את ההגדרות ובחר/י מספר חודשים. הספירה תתחיל מהיום הראשון ביומן.
          </div>
        )}
      </div>

      {/* 1 · average macro balance */}
      <div className="panel d-panel">
        <h2>איזון מאקרו ממוצע</h2>
        {a.macroAvg ? (
          <MacroBalance macroAvg={a.macroAvg} />
        ) : (
          <div className="d-note">אין עדיין ארוחות עם פירוט שומן/חלבון לחישוב האיזון.</div>
        )}
      </div>

      {/* records (best / worst day) */}
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
      </div>

      {/* 4 · peak carb hours */}
      <div className="panel d-panel">
        <h2>השעות העתירות בפחמימות</h2>
        {a.peakHours.length ? (
          <HoursBars peakHours={a.peakHours} />
        ) : (
          <div className="d-note">אין מספיק ארוחות עם שעת רישום כדי לחשב את התפלגות השעות.</div>
        )}
      </div>

      {/* 5 · coffee per day */}
      <div className="panel d-panel">
        <h2>ממוצע קפה ליום</h2>
        {a.coffee.total ? (
          <Coffee coffee={a.coffee} />
        ) : (
          <div className="d-note">לא זוהו ארוחות קפה (שחור · אספרסו · נס) ביומן.</div>
        )}
      </div>
    </div>
  );
}
