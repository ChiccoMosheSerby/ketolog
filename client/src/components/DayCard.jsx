import { useState } from 'react';
import {
  dayTotal, dayMacroGrams, macroPct, hasMacros, fmt, heDate, zoneInfo, maxRange,
  activityBurn, dayKcal, TARGET,
} from '../lib/helpers.js';
import './DayCard.scss';

export default function DayCard({
  iso,
  day,
  title,
  open,
  onToggle,
  onDeleteMeal,
  onSetMetric,
  onCopyMeal,
  onSaveTemplate,
  onSaveProduct,
  onSaveItemProduct,
  target = TARGET,
}) {
  const mt = day.metrics || {};
  const [weight, setWeight] = useState(mt.weight || '');
  const [status, setStatus] = useState(mt.status || '');

  const total = dayTotal(day);
  const zi = zoneInfo(total, target);
  const maxr = maxRange(target);
  const meals = [...(day.meals || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const g = dayMacroGrams(day);
  const mp = macroPct(g);
  const burn = activityBurn(day);
  const eaten = dayKcal(day);

  return (
    <div className={'day' + (open ? ' open' : '')}>
      <button className="day-head" onClick={onToggle} aria-expanded={open}>
        <span className="day-htext">
          <span className="day-title">{title || day.label || iso}</span>
          <span className="day-date">{heDate(iso)}</span>
        </span>
        <span className="day-hright">
          <span className="day-burn" title="הערכת קלוריות שנשרפו היום (תנועה יומית + פעילות מתועדת)">
            🔥 {fmt(burn.total)} <small>קק"ל</small>
          </span>
          <span className="day-total" style={{ color: zi.color }}>
            {fmt(total)} <small>ג' נטו</small>
          </span>
          <span className="chev"></span>
        </span>
      </button>

      <div className="meter">
        <span style={{ width: zi.pct + '%', background: zi.color }}></span>
        <i className="meter-mark" title={'גבול היעד: ' + fmt(target) + ' גרם'}></i>
      </div>
      <div className="meter-scale">
        <span className="s0">0</span>
        <span className="s20">יעד {fmt(target)}</span>
        <span className="s50">{fmt(maxr)}</span>
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
              meals.map((m) => {
                const items = Array.isArray(m.items) ? m.items : [];
                return (
                <div className="meal" key={m._id}>
                  <div className="time">{m.time || '--:--'}</div>
                  <div className="body">
                    <div className="desc">{m.desc || m.cat}</div>
                    {items.length > 0 && (
                      <ul className="meal-items">
                        {items.map((it, i) => (
                          <li key={i}>
                            <span className="mi-name">
                              {it.qty > 1 && <b className="mi-qty">{fmt(it.qty)}×</b>} {it.name}
                            </span>
                            <span className="mi-carb">
                              {fmt((Number(it.carbs) || 0) * (it.qty || 1))} ג'
                            </span>
                            {onSaveItemProduct && (
                              <button
                                className="mi-save"
                                title="הוסף למוצרים שלי"
                                onClick={() => onSaveItemProduct(it)}
                              >
                                📦
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="carb">{fmt(Number(m.carbs) || 0)} ג'</div>
                  <div className="meal-acts">
                    {onSaveTemplate && (
                      <button className="mact" title="שמור כתבנית" onClick={() => onSaveTemplate(m)}>
                        ★
                      </button>
                    )}
                    {onSaveProduct && (
                      <button
                        className="mact"
                        title="הוסף למוצרים שלי"
                        onClick={() => onSaveProduct(m)}
                      >
                        📦
                      </button>
                    )}
                    {onCopyMeal && (
                      <button className="mact" title="שכפל ליום הנבחר" onClick={() => onCopyMeal(m)}>
                        ⧉
                      </button>
                    )}
                    <button className="del" title="מחק" onClick={() => onDeleteMeal(iso, m._id)}>
                      ✕
                    </button>
                  </div>
                </div>
                );
              })
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

            <div className="burn">
              <div className="burn-top">
                <span className="burn-fire">🔥</span>
                <span className="burn-total">
                  ~{fmt(burn.total)} <small>קק"ל נשרפו (הערכה)</small>
                </span>
                {eaten != null && (
                  <span className="burn-eaten">מול ~{fmt(eaten)} קק"ל שנאכלו</span>
                )}
              </div>
              <div className="burn-rows">
                <span className="burn-it">
                  תנועה יומית <small>(הליכת כלב · הליכה לעבודה · מדרגות)</small> <b>{fmt(burn.base)}</b>
                </span>
                {burn.run > 0 && (
                  <span className="burn-it">ריצה <b>{fmt(burn.run)}</b></span>
                )}
                {burn.abs > 0 && (
                  <span className="burn-it">תרגילי בטן <b>{fmt(burn.abs)}</b></span>
                )}
              </div>
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
