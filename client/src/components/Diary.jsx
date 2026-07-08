import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { dayTotal, fmt, todayISO, dayHebrewName, prevISO, TARGET } from '../lib/helpers.js';
import { downloadReport } from '../lib/exportLog.js';
import AddMeal from './AddMeal.jsx';
import Products from './Products.jsx';
import DayCard from './DayCard.jsx';
import Dashboard from './Dashboard.jsx';
import SmartInsights from './SmartInsights.jsx';
import KetoCalc from './KetoCalc.jsx';
import Header, { TargetLegend } from './Header.jsx';
import TabShell from './TabShell.jsx';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import { useInsightsBadge, markVisited } from '../lib/insightsStore.js';
import './Diary.scss';

// strip subdoc id / extras → a clean meal payload for the API
const cleanMeal = (m) => ({
  time: m.time || '',
  cat: m.cat || '',
  desc: m.desc || '',
  carbs: Number(m.carbs) || 0,
  fat: m.fat ?? null,
  protein: m.protein ?? null,
  items: Array.isArray(m.items)
    ? m.items.map((it) => ({
        name: it.name || '',
        qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
        unit: it.unit || '',
        carbs: Number(it.carbs) || 0,
        fat: it.fat ?? null,
        protein: it.protein ?? null,
      }))
    : [],
});

export default function Diary() {
  const toast = useToast();
  const { user } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const insightsBadge = useInsightsBadge(user?.email || '');
  const handleTabChange = useCallback(
    (id) => {
      if (id === 'insights') markVisited(user?.email || '');
    },
    [user?.email],
  );
  const target = user?.dailyCarbTarget ?? TARGET;
  const [days, setDays] = useState([]); // array of day docs, newest first
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [viewDate, setViewDate] = useState(''); // '' = show all (history filter)
  const [historyOpen, setHistoryOpen] = useState(false); // folded journal under "today"
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

  // Edit a logged meal's time (HH:MM). DayCard sorts meals by time, so the row
  // moves into its new chronological slot as soon as the update lands.
  async function updateMealTime(date, mealId, time) {
    try {
      const day = await api.updateMeal(date, mealId, { time });
      mergeDay(day);
      toast('השעה עודכנה');
    } catch (e) {
      toast(e.message);
    }
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
  async function renameProduct(id, key) {
    const updated = await api.updateProduct(id, { key });
    setProducts((prev) => prev.map((p) => (p._id === id ? updated : p)));
    toast('השם עודכן');
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

  // Turn a single part of a meal into a reusable product. Its macros are already
  // per-unit, so the product maps onto it 1:1 (the unit becomes the product unit,
  // e.g. one "נקניקיה"), ready to one-click add to future meals.
  async function saveItemAsProduct(item) {
    const def = (item.name || 'מוצר').slice(0, 30);
    const name = window.prompt('שם קצר למוצר חדש:', def);
    if (name == null || !name.trim()) return;
    await addProduct({
      key: name.trim(),
      label: (item.name || name).trim(),
      unit: (item.unit || '').trim() || 'מנה',
      carbs: Number(item.carbs) || 0,
      fat: Number(item.fat) || 0,
      protein: Number(item.protein) || 0,
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

  // Download a full, human-readable HTML report: all insights + every logged
  // day + the saved products (with their thumbnails). Opens/prints anywhere.
  function exportReport() {
    try {
      downloadReport({
        days,
        products,
        target,
        email: user?.email || '',
        ketoMonths: user?.ketoGoalMonths || 0,
        generatedAt: todayISO(),
      });
      toast('הדוח יוצא');
    } catch {
      toast('ייצוא הדוח נכשל');
    }
  }

  // ---- summary (persistent header) ----
  const t = todayISO();
  // Average over *past* logged days only — today is still in progress, so
  // counting it would drag the average down (matches the insights tab).
  const totals = days
    .filter((d) => d.date < t && (d.meals || []).length > 0)
    .map(dayTotal);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
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
  // The folded journal lists past days; the current day already has its own card
  // above it, so drop it from the "all" view to avoid showing it twice.
  const shown = viewDate
    ? days.filter((d) => d.date === viewDate)
    : days.filter((d) => d.date !== activeDate);
  const journalCount = days.filter((d) => d.date !== activeDate).length;

  const canRepeat = (days.find((d) => d.date === prevISO(activeDate))?.meals || []).length > 0;

  // ---- tab contents ----
  const productsPanel = (
    <Products products={products} onAdd={addProduct} onRename={renameProduct} onDelete={deleteProduct} compact={!isMobile} />
  );

  const historyContent = (
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
            {viewDate ? 'אין רישום ליום שנבחר.' : 'אין עדיין ימים קודמים ביומן.'}
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
              onSetMealTime={updateMealTime}
              onSetMetric={setMetric}
              onCopyMeal={copyMealToActive}
              onSaveTemplate={saveMealAsTemplate}
              onSaveProduct={saveMealAsProduct}
              onSaveItemProduct={saveItemAsProduct}
              target={target}
            />
          ))
        )}
      </div>
    </>
  );

  // Desktop: a 2-col grid — products spans the full top row, then AddMeal (right
  // in RTL) and the current day sit below. Mobile: a plain block that stacks
  // AddMeal + day. The full journal lives below the current day as a folded
  // section (no separate tab), so it's one scroll away on every breakpoint.
  const todayTab = (
    <div className="today-grid">
      {!isMobile && <div className="grid-top">{productsPanel}</div>}
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
        onSetMealTime={updateMealTime}
        onSetMetric={setMetric}
        onCopyMeal={copyMealToActive}
        onSaveTemplate={saveMealAsTemplate}
        onSaveProduct={saveMealAsProduct}
        onSaveItemProduct={saveItemAsProduct}
        target={target}
      />

      <div className={'journal-fold' + (historyOpen ? ' open' : '')}>
        <button
          className="journal-head"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
          data-tour="journal"
        >
          <span className="journal-htext">
            <span className="journal-title">יומן</span>
            <span className="journal-sub">כל הימים הקודמים</span>
          </span>
          <span className="journal-hright">
            <span className="journal-count">{journalCount}</span>
            <span className="chev"></span>
          </span>
        </button>
        {historyOpen && <div className="journal-body">{historyContent}</div>}
      </div>
    </div>
  );

  // Products lives at the top of the today grid on desktop, so it's only a tab on mobile.
  const tabs = [
    { id: 'today', label: 'היום', content: todayTab },
    {
      id: 'insights',
      label: 'תובנות',
      badge: insightsBadge,
      content: (
        <Dashboard
          days={days}
          target={target}
          today={todayISO()}
          ketoMonths={user?.ketoGoalMonths || 0}
        >
          <SmartInsights />
        </Dashboard>
      ),
    },
    ...(isMobile ? [{ id: 'products', label: 'המוצרים שלי', content: productsPanel }] : []),
    {
      id: 'calc',
      label: 'חישוב מדדים',
      content: (
        <KetoCalc days={days} target={target} ketoMonths={user?.ketoGoalMonths || 0} />
      ),
    },
  ];

  return (
    <div className="wrap">
      <Header stats={stats} onExport={exportReport} />

      <TabShell tabs={tabs} onTabChange={handleTabChange} />

      <div className="foot">
        {/* Desktop: the keto-balance diagram moves out of the header to here. */}
        {!isMobile && (
          <div className="foot-target">
            <TargetLegend />
          </div>
        )}
        הנתונים נשמרים בענן (MongoDB) ומסונכרנים לחשבון שלך בכל מכשיר.
        <br />
        הערכים הם הערכות (±2–3 גרם למנות בית). היעד היומי שלך הוא מתחת ל-{fmt(target)} גרם פחמימות נטו ביום.
      </div>
    </div>
  );
}
