import { useState } from 'react';
import {
  dayTotal, dayMacroGrams, macroPct, hasMacros, fmt, heDate, zoneInfo,
} from '../lib/helpers.js';

export default function DayCard({ iso, day, open, onToggle, onDeleteMeal, onSetMetric }) {
  const mt = day.metrics || {};
  const [weight, setWeight] = useState(mt.weight || '');
  const [status, setStatus] = useState(mt.status || '');

  const total = dayTotal(day);
  const zi = zoneInfo(total);
  const meals = [...(day.meals || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const g = dayMacroGrams(day);
  const mp = macroPct(g);

  return (
    <div className={'day' + (open ? ' open' : '')}>
      <button className="day-head" onClick={onToggle} aria-expanded={open}>
        <span className="day-htext">
          <span className="day-title">{day.label || iso}</span>
          <span className="day-date">{heDate(iso)}</span>
        </span>
        <span className="day-hright">
          <span className="day-total" style={{ color: zi.color }}>
            {fmt(total)} <small>ג' נטו</small>
          </span>
          <span className="chev"></span>
        </span>
      </button>

      <div className="meter">
        <span style={{ width: zi.pct + '%', background: zi.color }}></span>
        <i className="meter-mark" title="גבול היעד: 20 גרם"></i>
      </div>
      <div className="meter-scale">
        <span className="s0">0</span>
        <span className="s20">יעד 20</span>
        <span className="s50">50</span>
      </div>
      <div className="meter-cap">{zi.cap}</div>

      {open && (
        <div className="day-body">
          {hasMacros(day) && mp ? (
            <div className="macro">
              <div className="macro-bar">
                <i style={{ width: mp.fat + '%', background: 'var(--olive)' }}></i>
                <i style={{ width: mp.protein + '%', background: 'var(--protein)' }}></i>
                <i style={{ width: mp.carb + '%', background: 'var(--amber)' }}></i>
              </div>
              <div className="macro-legend">
                <span>
                  <span className="dot" style={{ background: 'var(--olive)' }}></span>שומן{' '}
                  <b>{mp.fat}%</b> · {fmt(g.fat)} ג'
                </span>
                <span>
                  <span className="dot" style={{ background: 'var(--protein)' }}></span>חלבון{' '}
                  <b>{mp.protein}%</b> · {fmt(g.protein)} ג'
                </span>
                <span>
                  <span className="dot" style={{ background: 'var(--amber)' }}></span>פחמ'{' '}
                  <b>{mp.carb}%</b> · {fmt(g.carb)} ג'
                </span>
                <span style={{ marginInlineStart: 'auto' }}>~{mp.kcal} קק"ל</span>
              </div>
            </div>
          ) : (
            <div className="macro-na">מאקרו (שומן/חלבון) לא תועד ליום זה</div>
          )}

          <div className="meals">
            {meals.length === 0 ? (
              <div className="desc" style={{ padding: '10px 0', color: 'var(--ink-soft)' }}>
                עדיין אין ארוחות ליום הזה.
              </div>
            ) : (
              meals.map((m) => (
                <div className="meal" key={m._id}>
                  <div className="time">{m.time || '--:--'}</div>
                  <div className="body">
                    <div className="cat">{m.cat}</div>
                    <div className="desc">{m.desc}</div>
                  </div>
                  <div className="carb">{fmt(Number(m.carbs) || 0)} ג'</div>
                  <button className="del" title="מחק" onClick={() => onDeleteMeal(iso, m._id)}>
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="metrics">
            <div className="mlabel">מדדים פיזיולוגיים</div>
            <div className="mrow">
              <div className="mfld">
                <label>משקל בוקר (ק"ג)</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="–"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  onBlur={() => onSetMetric(iso, 'weight', weight)}
                />
              </div>
              <label className="mfld">
                <input
                  type="checkbox"
                  checked={!!mt.run}
                  onChange={(e) => onSetMetric(iso, 'run', e.target.checked)}
                />{' '}
                ריצה 10 דק'
              </label>
              <label className="mfld">
                <input
                  type="checkbox"
                  checked={!!mt.abs}
                  onChange={(e) => onSetMetric(iso, 'abs', e.target.checked)}
                />{' '}
                תרגילי בטן 5 דק'
              </label>
            </div>
            <div className="status">
              <textarea
                placeholder="הרגשה, אנרגיה, סטטוס קטוזיס..."
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                onBlur={() => onSetMetric(iso, 'status', status)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
