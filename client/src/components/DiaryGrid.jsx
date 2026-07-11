import { useState } from 'react';
import {
  dayTotal, dayKcal, fmt, todayISO, zoneInfo, kcalZone, TARGET,
} from '../lib/helpers.js';
import './DiaryGrid.scss';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

// Monthly calendar view of the diary: one cell per day showing that day's
// totals (net carbs graded like the day cards, kcal, meal count) — no meal
// detail. Read-only; clicking a logged day hands off to the list view via
// onOpenDay for the full card.
export default function DiaryGrid({ days, target = TARGET, kcalTarget = 0, onOpenDay }) {
  const t = todayISO();
  const [month, setMonth] = useState(t.slice(0, 7)); // 'YYYY-MM'

  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const leadBlanks = new Date(y, m - 1, 1).getDay(); // Sunday-first offset

  function shiftMonth(n) {
    setMonth(() => {
      const d = new Date(y, m - 1 + n, 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    });
  }

  const cells = Array.from({ length: daysInMonth }, (_, i) => {
    const iso = month + '-' + String(i + 1).padStart(2, '0');
    return { iso, num: i + 1, day: days.find((d) => d.date === iso) };
  });

  const isCurrentMonth = month === t.slice(0, 7);

  return (
    <div className="dgrid">
      <div className="dg-nav">
        <button className="btn ghost mini" onClick={() => shiftMonth(-1)} title="חודש קודם">
          → חודש קודם
        </button>
        <span className="dg-range">
          {MONTHS[m - 1]} {y}
        </span>
        {!isCurrentMonth && (
          <button className="btn ghost mini" onClick={() => setMonth(t.slice(0, 7))}>
            החודש
          </button>
        )}
        <button className="btn ghost mini" onClick={() => shiftMonth(1)} title="חודש הבא">
          חודש הבא ←
        </button>
      </div>

      <div className="dg-cal" role="grid" aria-label="לוח ימים חודשי">
        {DAY_NAMES.map((n) => (
          <div className="dg-dow" key={n}>
            {n}
          </div>
        ))}

        {Array.from({ length: leadBlanks }, (_, i) => (
          <div className="dg-blank" key={'b' + i} />
        ))}

        {cells.map(({ iso, num, day }) => {
          const logged = !!day && (day.meals || []).length > 0;
          const total = logged ? dayTotal(day) : 0;
          const zi = logged ? zoneInfo(total, target) : null;
          const kcal = logged ? dayKcal(day) : null;
          const kz = kcalZone(kcal, kcalTarget);
          return (
            <button
              key={iso}
              className={
                'dg-day' + (iso === t ? ' today' : '') + (logged ? ' logged' : '')
              }
              disabled={!logged}
              title={logged ? zi.cap + ' — פתח את היום ביומן' : 'אין רישום ליום זה'}
              onClick={() => logged && onOpenDay?.(iso)}
            >
              <span className="dg-num">{num}</span>
              {logged ? (
                <>
                  <b className="dg-carb" style={{ color: zi.color }}>
                    {fmt(total)} <small>ג'</small>
                  </b>
                  {kcal != null && (
                    <span
                      className="dg-kcal"
                      style={kz ? { color: kz.color } : undefined}
                      title={kz ? kz.cap : 'סה"כ קלוריות ליום'}
                    >
                      ~{kcal} קק"ל
                    </span>
                  )}
                  <span className="dg-count">
                    {day.meals.length} {day.meals.length === 1 ? 'ארוחה' : 'ארוחות'}
                  </span>
                </>
              ) : (
                <span className="dg-none">–</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
