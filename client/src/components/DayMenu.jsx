import { useState } from 'react';
import { useToast } from '../lib/toast.jsx';
import { fmt, macroPct, nowHM, prevISO, nextISO, todayISO } from '../lib/helpers.js';
import { MENU_TEMPLATES } from '../data/menuTemplates.js';
import './DayMenu.scss';

// Ready-made daily menu templates, rendered in the app's own look. Each meal
// can be logged to the selected day with one tap: its items become the meal's
// items (qty 1, macros as given), so it lands in the journal exactly like a
// locally-summed meal — no AI call.
export default function DayMenu({ date, onDateChange, onLogged }) {
  const toast = useToast();
  const [tplId, setTplId] = useState(MENU_TEMPLATES[0].id);
  const [busyMeal, setBusyMeal] = useState('');
  const tpl = MENU_TEMPLATES.find((t) => t.id === tplId) || MENU_TEMPLATES[0];
  const mp = macroPct({ carb: tpl.totals.carbs, fat: tpl.totals.fat, protein: tpl.totals.protein });

  async function logMeal(meal) {
    setBusyMeal(meal.id);
    try {
      await onLogged(date, {
        time: nowHM(),
        desc: meal.items.map((it) => it.name).join(', '),
        carbs: meal.carbs,
        fat: meal.fat,
        protein: meal.protein,
        items: meal.items.map((it) => ({
          name: it.name,
          qty: 1,
          unit: 'מנה',
          carbs: it.carbs,
          fat: it.fat,
          protein: it.protein,
        })),
        source: 'local',
      });
      toast(meal.title + ' נרשמה ליומן · 🧮 ללא AI');
    } catch (e) {
      toast(e.message || 'הרישום נכשל');
    } finally {
      setBusyMeal('');
    }
  }

  return (
    <div className="panel day-menu">
      <div className="dm-eyebrow">{tpl.eyebrow}</div>
      <h2>{tpl.title}</h2>
      <p className="dm-sub">{tpl.sub}</p>

      {MENU_TEMPLATES.length > 1 && (
        <div className="dm-picker">
          {MENU_TEMPLATES.map((t) => (
            <button
              key={t.id}
              className={'dm-pick' + (t.id === tplId ? ' active' : '')}
              onClick={() => setTplId(t.id)}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      <div className="dm-totals">
        <div className="dm-tot cal">
          <span className="n">~{tpl.totals.kcal.toLocaleString()}</span>
          <span className="l">קלוריות</span>
        </div>
        <div className="dm-tot carb">
          <span className="n">~{tpl.totals.carbs}</span>
          <span className="l">פחמ׳ נטו (ג׳)</span>
        </div>
        <div className="dm-tot fat">
          <span className="n">~{tpl.totals.fat}</span>
          <span className="l">שומן (ג׳)</span>
        </div>
        <div className="dm-tot prot">
          <span className="n">~{tpl.totals.protein}</span>
          <span className="l">חלבון (ג׳)</span>
        </div>
      </div>
      <div className="dm-rule">{tpl.balance}</div>

      <div className="qa-date">
        <label>לרשום ארוחות ליום</label>
        <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
        <div className="date-nav">
          <button
            type="button"
            className="date-arrow"
            title="יום הבא"
            disabled={date >= todayISO()}
            onClick={() => onDateChange(nextISO(date))}
          >
            ‹
          </button>
          <button
            type="button"
            className="date-arrow"
            title="יום קודם"
            onClick={() => onDateChange(prevISO(date))}
          >
            ›
          </button>
        </div>
      </div>

      {tpl.meals.map((meal) => (
        <div className="dm-meal" key={meal.id}>
          <div className="dm-mhead">
            <span className="dm-mtitle">{meal.title}</span>
            <span className="dm-mtime">{meal.time}</span>
          </div>
          <div className="dm-mmac">
            פחמ׳ נטו <b>~{fmt(meal.carbs)}</b> · שומן ~{fmt(meal.fat)} · חלבון ~{fmt(meal.protein)} · ~{meal.kcal} קק״ל
          </div>
          <ul className="dm-items">
            {meal.items.map((it, i) => (
              <li key={i}>
                <span>{it.name}</span>
                <span className="c" title="פחמ׳ · שומן · חלבון">
                  {fmt(it.carbs)} · {fmt(it.fat)} · {fmt(it.protein)}
                </span>
              </li>
            ))}
          </ul>
          {meal.swap && (
            <div className="dm-swap">
              <b>החלפה:</b> {meal.swap}
            </div>
          )}
          <button
            className="btn ghost mini dm-log"
            disabled={!!busyMeal}
            onClick={() => logMeal(meal)}
          >
            {busyMeal === meal.id ? 'רושם…' : '🧮 רשום ארוחה זו ליומן'}
          </button>
        </div>
      ))}

      <h3 className="dm-h3">1,700 מול 1,900 — מה לבחור</h3>
      <ul className="dm-tips">
        {tpl.tips.map((t, i) => (
          <li key={i}>
            <b>{t.b}</b> — {t.text}
          </li>
        ))}
      </ul>

      {mp && (
        <div className="dm-foot">
          חלוקה קלורית מחושבת: שומן {mp.fat}% · חלבון {mp.protein}% · פחמ׳ {mp.carb}% (~{mp.kcal} קק״ל)
        </div>
      )}
      <div className="dm-foot">{tpl.footer}</div>
    </div>
  );
}
