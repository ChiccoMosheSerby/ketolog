import { useState } from 'react';
import {
  dayTotal, dayMacroGrams, dayKcal, kcalZone, macroPct, macroKcal, hasMacros, fmt, heDate, zoneInfo, maxRange, TARGET,
} from '../lib/helpers.js';
import './DayCard.scss';

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Keep only digits and lay them out as HH:MM (a colon after the 2nd digit).
// Typing "0930" yields "09:30"; anything non-numeric is dropped.
function formatHM(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : d.slice(0, 2) + ':' + d.slice(2);
}

// The meal time, shown as a tap-to-edit chip. Editing accepts digits only,
// formatted as HH:MM; a valid, changed value is saved on blur / Enter, and the
// parent re-sorts the meal into its new slot.
function MealTime({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');

  if (!onSave) return <div className="time">{value || '--:--'}</div>;

  function commit() {
    setEditing(false);
    const v = val.trim();
    if (HM_RE.test(v) && v !== value) onSave(v);
    else setVal(value || '');
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="time time-btn"
        data-tour="meal-time"
        title="הקש/י לעריכת השעה"
        onClick={() => {
          setVal(value || '');
          setEditing(true);
        }}
      >
        {value || '--:--'}
      </button>
    );
  }

  return (
    <input
      className="time time-edit"
      type="text"
      inputMode="numeric"
      autoFocus
      maxLength={5}
      placeholder="--:--"
      value={val}
      onChange={(e) => setVal(formatHM(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setVal(value || '');
          setEditing(false);
        }
      }}
    />
  );
}

export default function DayCard({
  iso,
  day,
  title,
  open,
  onToggle,
  onDeleteMeal,
  onSetMealTime,
  onSetMetric,
  onCopyMeal,
  onSaveTemplate,
  onSaveProduct,
  onSaveItemProduct,
  target = TARGET,
  kcalTarget = 0,
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
  const kcal = dayKcal(day);
  const kz = kcalZone(kcal, kcalTarget);

  return (
    <div className={'day' + (open ? ' open' : '')}>
      <button className="day-head" onClick={onToggle} aria-expanded={open}>
        <span className="day-htext">
          <span className="day-title">{title || day.label || iso}</span>
          <span className="day-date">{heDate(iso)}</span>
        </span>
        <span className="day-hright">
          <span className="day-hnums">
            <span className="day-total" style={{ color: zi.color }}>
              {fmt(total)} <small>ג' נטו</small>
            </span>
            {kcal != null && (
              <span
                className="day-kcal"
                style={kz ? { color: kz.color } : undefined}
                title={kz ? kz.cap : 'סה"כ קלוריות ליום (לפי המאקרו שתועד)'}
              >
                ~{kcal} <small>קק"ל</small>
              </span>
            )}
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
                <span className="seg" style={{ width: mp.fat + '%' }}>
                  <b>{mp.fat}%</b>
                  <i style={{ background: 'var(--olive)' }}></i>
                </span>
                <span className="seg" style={{ width: mp.protein + '%' }}>
                  <b>{mp.protein}%</b>
                  <i style={{ background: 'var(--protein)' }}></i>
                </span>
                <span className="seg" style={{ width: mp.carb + '%' }}>
                  <b>{mp.carb}%</b>
                  <i style={{ background: 'var(--amber)' }}></i>
                </span>
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
                const mmp =
                  m.fat != null || m.protein != null
                    ? macroPct({
                        carb: Number(m.carbs) || 0,
                        fat: Number(m.fat) || 0,
                        protein: Number(m.protein) || 0,
                      })
                    : null;
                const mkcal = macroKcal(m);
                return (
                <div className="meal" key={m._id}>
                  <MealTime
                    value={m.time}
                    onSave={onSetMealTime ? (t) => onSetMealTime(iso, m._id, t) : null}
                  />
                  <div className="body">
                    <div className="desc">
                      {m.desc || m.cat}
                      {m.source === 'catalog' && (
                        <span className="meal-src" title="חושב מקטלוג המוצרים הנלמד — ללא AI">📖</span>
                      )}
                      {m.source === 'local' && (
                        <span className="meal-src" title="חושב מהמוצרים השמורים שלך — ללא AI">🧮</span>
                      )}
                      {m.source === 'ai' && (
                        <span className="meal-src" title="חושב באמצעות AI">🤖</span>
                      )}
                    </div>
                    {items.length > 0 && (
                      <ul className="meal-items">
                        {items.map((it, i) => {
                          const ikcal = macroKcal(it, it.qty || 1);
                          return (
                          <li key={i}>
                            <span className="mi-name">
                              {it.qty > 1 && <b className="mi-qty">{fmt(it.qty)}×</b>} {it.name}
                            </span>
                            {ikcal != null && (
                              <span className="mi-kcal" title="קלוריות לפריט (לפי המאקרו שלו)">
                                ~{ikcal} קק"ל
                              </span>
                            )}
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
                          );
                        })}
                      </ul>
                    )}
                    {mmp && (
                      <div
                        className="meal-macro"
                        title={`שומן ${mmp.fat}% · חלבון ${mmp.protein}% · פחמ' ${mmp.carb}% · ~${mmp.kcal} קק"ל`}
                      >
                        <span className="seg" style={{ width: mmp.fat + '%' }}>
                          <b>{mmp.fat}%</b>
                          <i style={{ background: 'var(--olive)' }}></i>
                        </span>
                        <span className="seg" style={{ width: mmp.protein + '%' }}>
                          <b>{mmp.protein}%</b>
                          <i style={{ background: 'var(--protein)' }}></i>
                        </span>
                        <span className="seg" style={{ width: mmp.carb + '%' }}>
                          <b>{mmp.carb}%</b>
                          <i style={{ background: 'var(--amber)' }}></i>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="carb">
                    {fmt(Number(m.carbs) || 0)} ג'
                    {mkcal != null && (
                      <span className="carb-kcal" title="קלוריות לארוחה (לפי המאקרו שתועד)">
                        ~{mkcal} קק"ל
                      </span>
                    )}
                  </div>
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
