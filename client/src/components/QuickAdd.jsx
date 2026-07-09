import { useMemo, useState } from 'react';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmt, macroPct, nowHM, prevISO, nextISO, todayISO } from '../lib/helpers.js';
import {
  DEMO_PRODUCTS,
  PRODUCT_TYPES,
  MEAL_COMBOS,
  historicalSuggestions,
} from '../data/demoProducts.js';
import { recordSelection, suggestIds } from '../lib/quickAddPatterns.js';
import './QuickAdd.scss';

// Quick-Add POC: compose a meal purely by tapping products from a fixed demo
// DB (built from the user's real log history) — selection only, no free text,
// so a meal can never contain a typo or an unknown food. Quantities are
// stepper-only. Totals are a local qty × per-unit sum (source:'local'), so
// logging costs zero AI calls. Products are grouped by type; an hour-aware
// suggestion row and one-tap recurring combos cover the habitual meals.
export default function QuickAdd({ date, onDateChange, onLogged }) {
  const toast = useToast();
  const { user } = useAuth();
  const [qty, setQty] = useState({}); // productId -> count
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState(0); // bumps per log → re-rank suggestions

  const byId = useMemo(() => new Map(DEMO_PRODUCTS.map((p) => [p.id, p])), []);

  // Hour-aware suggestions: live patterns learned from this user's quick-adds,
  // padded with what the log history says they eat at this hour.
  const { suggested, learnedCount } = useMemo(() => {
    const now = new Date();
    const { ids, learnedCount } = suggestIds(user?.email || '', {
      now,
      limit: 4,
      defaults: historicalSuggestions(now.getHours()),
    });
    return { suggested: ids.map((id) => byId.get(id)).filter(Boolean), learnedCount };
  }, [user?.email, byId, logged]);

  const picked = DEMO_PRODUCTS.filter((p) => qty[p.id] > 0);

  // First tap adds the product's usual amount (e.g. 5 cherry tomatoes); the
  // steppers then adjust one by one.
  const add = (p) =>
    setQty((q) => ({ ...q, [p.id]: (q[p.id] || 0) + (q[p.id] ? 1 : p.typicalQty || 1) }));

  const bump = (id, delta) =>
    setQty((q) => {
      const next = Math.max(0, (q[id] || 0) + delta);
      const copy = { ...q };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });

  const applyCombo = (combo) => {
    setQty((q) => {
      const copy = { ...q };
      for (const it of combo.items) copy[it.id] = (copy[it.id] || 0) + it.qty;
      return copy;
    });
    toast(combo.name + ' נוסף לארוחה');
  };

  const round2 = (n) => Math.round(n * 100) / 100;
  const total = (key) => round2(picked.reduce((s, p) => s + (Number(p[key]) || 0) * qty[p.id], 0));
  const totals = { carbs: total('carbs'), fat: total('fat'), protein: total('protein') };
  const mp = picked.length
    ? macroPct({ carb: totals.carbs, fat: totals.fat, protein: totals.protein })
    : null;

  const comboCarbs = (combo) =>
    round2(combo.items.reduce((s, it) => s + (byId.get(it.id)?.carbs || 0) * it.qty, 0));

  // Same composition as AddMeal's pickedToText, so the resolver / journal read
  // these meals exactly like shortcut-composed ones.
  const unitName = (p) => `${p.unit ? p.unit + ' ' : ''}${p.name}`;
  const descText = picked
    .map((p) => (qty[p.id] > 1 ? `${qty[p.id]} ${unitName(p)}` : unitName(p)))
    .join(', ');

  async function logMeal() {
    if (!picked.length) return;
    setBusy(true);
    try {
      await onLogged(date, {
        time: nowHM(),
        desc: descText,
        carbs: totals.carbs,
        fat: totals.fat,
        protein: totals.protein,
        items: picked.map((p) => ({
          name: p.name,
          qty: qty[p.id],
          unit: p.unit,
          carbs: p.carbs,
          fat: p.fat,
          protein: p.protein,
        })),
        source: 'local',
      });
      recordSelection(
        user?.email || '',
        picked.map((p) => p.id),
      );
      setQty({});
      setLogged((n) => n + 1);
      toast('הארוחה נרשמה · 🧮 ללא AI (ממאגר המוצרים)');
    } catch (e) {
      toast(e.message || 'הרישום נכשל');
    } finally {
      setBusy(false);
    }
  }

  const card = (p, extraClass = '') => {
    const n = qty[p.id] || 0;
    return (
      <div key={p.id} className={'qa-card' + (n > 0 ? ' on' : '') + extraClass}>
        <button
          type="button"
          className="qa-card-main"
          onClick={() => add(p)}
          title={p.desc || 'הוסף לארוחה'}
        >
          <span className="qa-emoji">{p.emoji}</span>
          <span className="qa-name">{p.name}</span>
          <span className="qa-meta">
            {p.unit} · {fmt(p.carbs)} ג' פחמ'
            {p.typicalQty > 1 && <em> · בד"כ ×{p.typicalQty}</em>}
          </span>
          {p.desc && <span className="qa-desc">{p.desc}</span>}
        </button>
        <div className="qa-step" aria-hidden={n === 0}>
          <button type="button" onClick={() => bump(p.id, -1)} title="הפחת">
            −
          </button>
          <b>{n}</b>
          <button type="button" onClick={() => bump(p.id, 1)} title="הוסף">
            +
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="panel quick-add">
      <h2>הוספה מהירה ממאגר המוצרים</h2>
      <p className="qa-sub">
        בוחרים מוצרים בהקשה — בלי הקלדה, בלי טעויות. המאגר נבנה מהיומן האמיתי שלך; הערכים
        מחושבים מיידית, ללא AI.
      </p>

      <div className="qa-date">
        <label>תאריך</label>
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

      {suggested.length > 0 && (
        <div className="qa-suggest">
          <div className="qa-glabel">
            ⏰ מומלץ עכשיו
            <small>
              {learnedCount > 0
                ? 'לפי ההרגלים שלך בשעה הזו'
                : 'לפי מה שנרשם ביומן שלך בשעות האלה'}
            </small>
          </div>
          <div className="qa-grid">{suggested.map((p) => card(p, ' hint'))}</div>
        </div>
      )}

      {MEAL_COMBOS.length > 0 && (
        <>
          <div className="qa-glabel">
            🔁 הארוחות החוזרות שלך
            <small>הקשה אחת ממלאת את כל הארוחה</small>
          </div>
          <div className="qa-combos">
            {MEAL_COMBOS.map((c) => (
              <button
                key={c.id}
                type="button"
                className="qa-combo"
                onClick={() => applyCombo(c)}
                title={c.desc}
              >
                <span className="plus">+</span>
                {c.name}
                <small>{fmt(comboCarbs(c))} פחמ'</small>
              </button>
            ))}
          </div>
        </>
      )}

      {PRODUCT_TYPES.map((t) => {
        const list = DEMO_PRODUCTS.filter((p) => p.type === t.id);
        if (!list.length) return null;
        return (
          <div key={t.id} className="qa-type">
            <div className="qa-glabel">
              {t.emoji} {t.label}
              <small>{list.length}</small>
            </div>
            <div className="qa-grid">{list.map((p) => card(p))}</div>
          </div>
        );
      })}

      <div className={'qa-cart' + (picked.length ? ' show' : '')}>
        {picked.length === 0 ? (
          <span className="qa-empty">הקישו על מוצר כדי להתחיל לבנות ארוחה</span>
        ) : (
          <>
            <ul className="qa-lines">
              {picked.map((p) => (
                <li key={p.id}>
                  <span className="qa-line-name">
                    {qty[p.id] > 1 && <b>{qty[p.id]}×</b>} {p.name}
                  </span>
                  <span className="qa-line-carb">{fmt(round2(p.carbs * qty[p.id]))} ג' פחמ'</span>
                </li>
              ))}
            </ul>
            <div className="qa-totals">
              <strong>
                {fmt(totals.carbs)} ג' פחמימות נטו · {fmt(totals.fat)} ג' שומן ·{' '}
                {fmt(totals.protein)} ג' חלבון
              </strong>
              {mp && (
                <span className="qa-mp">
                  שומן {mp.fat}% · חלבון {mp.protein}% · פחמ' {mp.carb}% (~{mp.kcal} קק"ל)
                </span>
              )}
            </div>
            <div className="qa-actions">
              <button className="btn" disabled={busy} onClick={logMeal}>
                {busy ? 'רושם…' : 'רשום ארוחה'}
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => setQty({})}>
                נקה בחירה
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
