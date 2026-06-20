import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { dayTotal, fmt, todayISO, dayHebrewName, prevISO, TARGET } from '../lib/helpers.js';
import AddMeal from './AddMeal.jsx';
import Products from './Products.jsx';
import DayCard from './DayCard.jsx';
import Header from './Header.jsx';
import TabShell from './TabShell.jsx';
import './Diary.scss';

// strip subdoc id / extras → a clean meal payload for the API
const cleanMeal = (m) => ({
  time: m.time || '',
  cat: m.cat || '',
  desc: m.desc || '',
  carbs: Number(m.carbs) || 0,
  fat: m.fat ?? null,
  protein: m.protein ?? null,
});

export default function Diary() {
  const toast = useToast();
  const { user } = useAuth();
  const target = user?.dailyCarbTarget ?? TARGET;
  const [days, setDays] = useState([]); // array of day docs, newest first
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [viewDate, setViewDate] = useState(''); // '' = show all (history filter)
  const [jump, setJump] = useState(todayISO());
  const [activeDate, setActiveDate] = useState(todayISO()); // the day the "Today" tab + AddMeal point at
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(
    (firstLoad = false) =>
      Promise.all([api.getDays(), api.getProducts(), api.getTemplates()])
        .then(([d, p, t]) => {
          setDays(d);
          setProducts(p);
          setTemplates(t);
          if (firstLoad && d.length) setExpanded(new Set([d[0].date])); // newest open by default
        })
        .catch((e) => toast(e.message)),
    [toast]
  );

  useEffect(() => {
    reload(true).finally(() => setLoaded(true));
  }, [reload]);

  // the assistant commits meals/products straight to the DB — refresh when it does
  useEffect(() => {
    const onChange = () => reload();
    window.addEventListener('ketolog:dataChanged', onChange);
    return () => window.removeEventListener('ketolog:dataChanged', onChange);
  }, [reload]);

  // keep the active day's card open on the Today tab
  useEffect(() => {
    setExpanded((s) => (s.has(activeDate) ? s : new Set(s).add(activeDate)));
  }, [activeDate]);

  function mergeDay(day) {
    setDays((prev) => {
      const others = prev.filter((d) => d.date !== day.date);
      return [...others, day].sort((a, b) => b.date.localeCompare(a.date));
    });
  }

  // build a "יום N · <weekday>" label when a day is first created
  function nextLabel(date) {
    return 'יום ' + (days.length + 1) + ' · ' + dayHebrewName(date);
  }

  // Chronological day index: the earliest logged date is "יום 1", regardless of
  // the order days were added. Computed live so it stays correct when a day is
  // inserted out of order. Counts existing dates earlier than `iso`, plus one
  // (so a brand-new date that isn't in `days` yet also gets the right number).
  const dayNumber = (iso) => days.reduce((n, d) => (d.date < iso ? n + 1 : n), 1);
  const dayTitle = (iso) => 'יום ' + dayNumber(iso) + ' · ' + dayHebrewName(iso);

  async function addMeal(date, meal) {
    const existing = days.find((d) => d.date === date);
    const payload = existing ? meal : { ...meal, label: nextLabel(date) };
    const day = await api.addMeal(date, payload);
    mergeDay(day);
    setExpanded((s) => new Set(s).add(date));
  }

  async function deleteMeal(date, mealId) {
    const day = await api.deleteMeal(date, mealId);
    mergeDay(day);
    toast('הארוחה נמחקה');
  }

  async function setMetric(date, field, value) {
    const day = await api.setMetric(date, field, value);
    mergeDay(day);
    if (field === 'run' || field === 'abs') toast('נשמר');
  }

  async function addProduct(p) {
    const created = await api.addProduct(p);
    setProducts((prev) => [...prev, created]);
  }
  async function deleteProduct(id) {
    await api.deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p._id !== id));
    toast('המוצר נמחק');
  }

  // Add one or more meals to a day (used by copy-meal, repeat-yesterday, templates).
  // Loops the meals API; label is only honored on insert, so passing it is safe.
  async function applyMeals(date, meals) {
    if (!meals?.length) return;
    const existing = days.find((d) => d.date === date);
    const label = existing ? undefined : nextLabel(date);
    for (const m of meals) {
      await api.addMeal(date, { ...cleanMeal(m), ...(label ? { label } : {}) });
    }
    await reload();
    setExpanded((s) => new Set(s).add(date));
  }

  async function repeatYesterday() {
    const yISO = prevISO(activeDate);
    const yday = days.find((d) => d.date === yISO);
    if (!yday || !(yday.meals || []).length) {
      toast('אין ארוחות מאתמול לשכפול');
      return;
    }
    await applyMeals(activeDate, yday.meals);
    toast('הארוחות מאתמול שוכפלו');
  }

  async function copyMealToActive(meal) {
    await applyMeals(activeDate, [meal]);
    toast('הארוחה שוכפלה ליום הנבחר');
  }

  async function saveMealAsTemplate(meal) {
    const def = (meal.desc || meal.cat || 'תבנית').slice(0, 30);
    const name = window.prompt('שם לתבנית:', def);
    if (name == null || !name.trim()) return;
    const created = await api.addTemplate({ name: name.trim(), ...cleanMeal(meal) });
    setTemplates((prev) => [...prev, created]);
    toast('התבנית נשמרה');
  }

  // Turn a logged meal into a reusable personal product (name + description +
  // macros), the same way "copy to day" / "save as template" work per row.
  async function saveMealAsProduct(meal) {
    const def = (meal.desc || meal.cat || 'מוצר').slice(0, 30);
    const name = window.prompt('שם קצר למוצר חדש:', def);
    if (name == null || !name.trim()) return;
    await addProduct({
      key: name.trim(),
      label: (meal.desc || meal.cat || name).trim(),
      unit: 'מנה',
      carbs: Number(meal.carbs) || 0,
      fat: Number(meal.fat) || 0,
      protein: Number(meal.protein) || 0,
    });
    toast('המוצר נוסף לרשימה שלך');
  }

  async function deleteTemplate(id) {
    await api.deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t._id !== id));
    toast('התבנית נמחקה');
  }

  function toggle(date) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(date)) s.delete(date);
      else s.add(date);
      return s;
    });
  }

  async function copyData() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ days, products }, null, 2));
      toast('הנתונים הועתקו');
    } catch {
      toast('לא ניתן להעתיק');
    }
  }

  // ---- summary (persistent header) ----
  const totals = days.map(dayTotal);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const t = todayISO();
  const today = days.find((d) => d.date === t);
  const stats = {
    avg: totals.length ? fmt(avg) : '–',
    days: days.length || '–',
    today: today ? fmt(dayTotal(today)) : '0',
    todayNum: today ? dayTotal(today) : 0,
    target,
  };

  const activeDay = days.find((d) => d.date === activeDate) || {
    date: activeDate,
    meals: [],
    metrics: {},
  };
  const shown = viewDate ? days.filter((d) => d.date === viewDate) : days;

  const canRepeat = (days.find((d) => d.date === prevISO(activeDate))?.meals || []).length > 0;

  // ---- tab contents ----
  const todayTab = (
    <>
      <AddMeal
        onLogged={addMeal}
        date={activeDate}
        onDateChange={setActiveDate}
        products={products}
        templates={templates}
        onDeleteTemplate={deleteTemplate}
        onRepeatYesterday={repeatYesterday}
        canRepeat={canRepeat}
      />
      <DayCard
        iso={activeDate}
        day={activeDay}
        title={dayTitle(activeDate)}
        open={expanded.has(activeDate)}
        onToggle={() => toggle(activeDate)}
        onDeleteMeal={deleteMeal}
        onSetMetric={setMetric}
        onCopyMeal={copyMealToActive}
        onSaveTemplate={saveMealAsTemplate}
        onSaveProduct={saveMealAsProduct}
        target={target}
      />
    </>
  );

  const historyTab = (
    <>
      <div className="toolbar">
        <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>קפיצה ליום:</label>
        <input type="date" value={jump} onChange={(e) => setJump(e.target.value)} />
        <button className="btn ghost mini" onClick={() => jump && setViewDate(jump)}>
          הצג יום
        </button>
        <button className="btn ghost mini" onClick={() => setViewDate('')}>
          כל הימים
        </button>
      </div>
      <div id="days">
        {!loaded ? null : shown.length === 0 ? (
          <div className="empty">
            {viewDate ? 'אין רישום ליום שנבחר.' : 'עדיין אין ימים מתועדים. הוסף ארוחה בלשונית "היום".'}
          </div>
        ) : (
          shown.map((d) => (
            <DayCard
              key={d.date}
              iso={d.date}
              day={d}
              title={dayTitle(d.date)}
              open={expanded.has(d.date)}
              onToggle={() => toggle(d.date)}
              onDeleteMeal={deleteMeal}
              onSetMetric={setMetric}
              onCopyMeal={copyMealToActive}
              onSaveTemplate={saveMealAsTemplate}
              onSaveProduct={saveMealAsProduct}
              target={target}
            />
          ))
        )}
      </div>
    </>
  );

  const productsTab = <Products products={products} onAdd={addProduct} onDelete={deleteProduct} />;

  const tabs = [
    { id: 'today', label: 'היום', content: todayTab },
    { id: 'history', label: 'יומן', content: historyTab },
    { id: 'products', label: 'המוצרים שלי', content: productsTab },
  ];

  return (
    <div className="wrap">
      <Header stats={stats} onCopyData={copyData} />

      <TabShell tabs={tabs} />

      <div className="foot">
        הנתונים נשמרים בענן (MongoDB) ומסונכרנים לחשבון שלך בכל מכשיר.
        <br />
        הערכים הם הערכות (±2–3 גרם למנות בית). היעד היומי שלך הוא מתחת ל-{fmt(target)} גרם פחמימות נטו ביום.
      </div>
    </div>
  );
}
