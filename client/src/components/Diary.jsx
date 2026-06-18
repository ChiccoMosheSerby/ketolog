import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { dayTotal, fmt, todayISO, dayHebrewName } from '../lib/helpers.js';
import AddMeal from './AddMeal.jsx';
import Products from './Products.jsx';
import DayCard from './DayCard.jsx';

export default function Diary() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState([]); // array of day docs, newest first
  const [products, setProducts] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [viewDate, setViewDate] = useState(''); // '' = show all
  const [jump, setJump] = useState(todayISO());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.getDays(), api.getProducts()])
      .then(([d, p]) => {
        setDays(d);
        setProducts(p);
        if (d.length) setExpanded(new Set([d[0].date])); // newest open by default
      })
      .catch((e) => toast(e.message))
      .finally(() => setLoaded(true));
  }, [toast]);

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

  async function addMeal(date, meal) {
    const existing = days.find((d) => d.date === date);
    const payload = existing ? meal : { ...meal, label: nextLabel(date) };
    const day = await api.addMeal(date, payload);
    mergeDay(day);
    setExpanded((s) => new Set(s).add(date));
    setViewDate('');
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

  // ---- summary ----
  const totals = days.map(dayTotal);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  const t = todayISO();
  const today = days.find((d) => d.date === t);

  const shown = viewDate ? days.filter((d) => d.date === viewDate) : days;

  return (
    <div className="wrap">
      <header className="top">
        <div className="headrow">
          <div className="stats">
            <div className="stat">
              <span className="num">{totals.length ? fmt(avg) : '–'}</span>
              <span className="lab">ממוצע יומי (גרם נטו)</span>
            </div>
            <div className="stat">
              <span className="num">{days.length || '–'}</span>
              <span className="lab">ימים מתועדים</span>
            </div>
            <div className="stat">
              <span className="num">{today ? fmt(dayTotal(today)) : '0'}</span>
              <span className="lab">היום עד כה</span>
            </div>
          </div>
          <div className="target target-mini">
            <div className="tt">היעד המאוזן בקיטו</div>
            <div className="target-bar">
              <i style={{ width: '72%', background: 'var(--olive)' }}></i>
              <i style={{ width: '23%', background: 'var(--protein)' }}></i>
              <i style={{ width: '5%', background: 'var(--amber)' }}></i>
            </div>
            <div className="target-legend">
              <span className="it">
                <span className="dot" style={{ background: 'var(--olive)' }}></span>שומן <b>70–75%</b>
              </span>
              <span className="it">
                <span className="dot" style={{ background: 'var(--protein)' }}></span>חלבון{' '}
                <b>20–25%</b>
              </span>
              <span className="it">
                <span className="dot" style={{ background: 'var(--amber)' }}></span>פחמ' <b>5–10%</b>
              </span>
            </div>
          </div>
        </div>
        <div className="userbar">
          <span className="uemail">{user?.email}</span>
          <button className="btn ghost mini" onClick={logout}>
            התנתק
          </button>
        </div>
      </header>

      <AddMeal products={products} onLogged={addMeal} />
      <Products products={products} onAdd={addProduct} onDelete={deleteProduct} />

      <div className="toolbar">
        <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>קפיצה ליום:</label>
        <input type="date" value={jump} onChange={(e) => setJump(e.target.value)} />
        <button className="btn ghost mini" onClick={() => jump && setViewDate(jump)}>
          הצג יום
        </button>
        <button className="btn ghost mini" onClick={() => setViewDate('')}>
          כל הימים
        </button>
        <span className="spacer"></span>
        <button className="btn ghost mini" onClick={copyData}>
          העתק נתונים
        </button>
      </div>

      <div id="days">
        {!loaded ? null : shown.length === 0 ? (
          <div className="empty">
            {viewDate ? 'אין רישום ליום שנבחר.' : 'עדיין אין ימים מתועדים. הוסף ארוחה למעלה.'}
          </div>
        ) : (
          shown.map((d) => (
            <DayCard
              key={d.date}
              iso={d.date}
              day={d}
              open={expanded.has(d.date)}
              onToggle={() => toggle(d.date)}
              onDeleteMeal={deleteMeal}
              onSetMetric={setMetric}
            />
          ))
        )}
      </div>

      <div className="foot">
        הנתונים נשמרים בענן (MongoDB) ומסונכרנים לחשבון שלך בכל מכשיר.
        <br />
        הערכים הם הערכות (±2–3 גרם למנות בית). היעד הקטוגני הוא מתחת ל-20 גרם פחמימות נטו ביום.
      </div>
    </div>
  );
}
