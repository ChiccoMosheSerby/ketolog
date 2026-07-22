import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useToast } from "../lib/toast.jsx";
import { useAuth } from "../lib/auth.jsx";
import {
  dayTotal,
  dayKcal,
  fmt,
  todayISO,
  dayHebrewName,
  prevISO,
  nextISO,
  TARGET,
} from "../lib/helpers.js";
import { downloadReport } from "../lib/exportLog.js";
import { energyBalance } from "../lib/energyBalance.js";
import AddMeal from "./AddMeal.jsx";
import Products from "./Products.jsx";
import DayCard from "./DayCard.jsx";
import DiaryGrid from "./DiaryGrid.jsx";
import Dashboard from "./Dashboard.jsx";
import RecordBanner from "./RecordBanner.jsx";
import SmartInsights from "./SmartInsights.jsx";
import Header from "./Header.jsx";
import TabShell from "./TabShell.jsx";
import NameDialog from "./NameDialog.jsx";
import { SkeletonCard } from "./Skeleton.jsx";
import { useInsightsBadge } from "../lib/insightsStore.js";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import { DEMO_PRODUCTS, PRODUCT_TYPES } from "../data/demoProducts.js";
import "./Diary.scss";

// One budget alert per session: own-key users with a monthly AI budget get a
// toast on load when their recorded spend crosses 80% of it (see SettingsModal
// for the detailed numbers).
let budgetAlerted = false;

// While the guided tour runs over an empty day, this stand-in meal is shown so
// the meal-related steps (edit time, save as product, meal actions) have real
// buttons to spotlight. It is never persisted — it exists only in the render
// and disappears the moment the tour ends. DayCard auto-expands it by its id.
export const TOUR_DEMO_MEAL_ID = 'tour-demo';
const TOUR_DEMO_MEAL = {
  _id: TOUR_DEMO_MEAL_ID,
  time: '09:30',
  cat: '',
  desc: 'חביתה מ-2 ביצים בחמאה, חצי אבוקדו וקפה עם שמנת (דוגמה להדרכה)',
  carbs: 3.6,
  fat: 29,
  protein: 14,
  source: 'local',
  items: [
    { name: 'חביתה', desc: 'חביתה מ-2 ביצים בחמאה', qty: 1, unit: 'מנה', carbs: 0.8, fat: 19, protein: 12.5 },
    { name: 'אבוקדו', desc: 'חצי אבוקדו בינוני', qty: 1, unit: 'חצי', carbs: 1.8, fat: 7.5, protein: 1 },
    { name: 'קפה עם שמנת', desc: 'קפה שחור עם כף שמנת מתוקה', qty: 1, unit: 'כוס', carbs: 1, fat: 2.5, protein: 0.5 },
  ],
};

// A small demo catalog for the tour when the user has no saved products yet —
// two per category out of the curated demo DB, mapped to the real Product
// shape so the picker and the products panel render them exactly like real
// ones. Render-only, never persisted.
const TOUR_DEMO_PRODUCTS = (() => {
  const label = new Map(PRODUCT_TYPES.map((t) => [t.id, t.label]));
  const byType = {};
  for (const p of DEMO_PRODUCTS) (byType[p.type] ||= []).push(p);
  return Object.values(byType)
    .flatMap((arr) => arr.slice(0, 2))
    .map((p) => ({
      _id: 'tour-demo-' + p.id,
      key: p.name,
      label: p.desc,
      unit: p.unit,
      cat: label.get(p.type) || 'נשנוש / ביניים',
      carbs: p.carbs,
      fat: p.fat,
      protein: p.protein,
    }));
})();

// Two weeks of plausible demo days so the dashboard (averages, streaks, energy
// balance, weight trend) looks alive during the tour on a fresh account.
// Deterministic, ends yesterday, weight drifts down — render-only.
function buildTourDays(today) {
  const days = [];
  let date = today;
  for (let i = 1; i <= 14; i++) {
    date = prevISO(date);
    const total = 14 + ((i * 7) % 11); // 14–24 g, varied but repeatable
    const part = (f) => Math.round(total * f * 10) / 10;
    days.push({
      _id: 'tour-day-' + i,
      date,
      label: '',
      closed: true,
      metrics: i % 3 === 1 ? { weight: String(Math.round((87.5 + i * 0.12) * 10) / 10) } : {},
      meals: [
        { _id: `tour-b-${i}`, time: '09:00', cat: '', desc: 'חביתה מ-2 ביצים וקפה עם שמנת', carbs: part(0.2), fat: 21, protein: 13, items: [], source: 'local' },
        { _id: `tour-l-${i}`, time: '13:30', cat: '', desc: 'חזה עוף בגריל עם סלט ירוק ושמן זית', carbs: part(0.45), fat: 18, protein: 35, items: [], source: 'local' },
        { _id: `tour-d-${i}`, time: '19:30', cat: '', desc: 'סלמון בתנור עם ברוקולי בחמאה', carbs: part(0.35), fat: 24, protein: 28, items: [], source: 'local' },
      ],
    });
  }
  return days;
}

// strip subdoc id / extras → a clean meal payload for the API
const cleanMeal = (m) => ({
  time: m.time || "",
  cat: m.cat || "",
  desc: m.desc || "",
  carbs: Number(m.carbs) || 0,
  fat: m.fat ?? null,
  protein: m.protein ?? null,
  items: Array.isArray(m.items)
    ? m.items.map((it) => ({
        name: it.name || "",
        desc: it.desc || "",
        qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
        unit: it.unit || "",
        carbs: Number(it.carbs) || 0,
        fat: it.fat ?? null,
        protein: it.protein ?? null,
      }))
    : [],
});

export default function Diary() {
  const toast = useToast();
  const { user, needsOnboarding } = useAuth();
  // Red dot on the תובנות tab while an unseen report exists; it clears only
  // after the user actually views the report there (not on mere tab entry).
  const insightsBadge = useInsightsBadge(user?.email || "");
  const target = user?.dailyCarbTarget ?? TARGET;
  const lossTarget = user?.monthlyLossTarget ?? 2;
  const [days, setDays] = useState([]); // array of day docs, newest first
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [viewDate, setViewDate] = useState(""); // '' = show all (history filter)
  const [historyOpen, setHistoryOpen] = useState(false); // folded journal under "today"
  // journal presentation: card list vs. weekly schedule grid (sticks per device)
  const [diaryView, setDiaryView] = useState(
    () => localStorage.getItem("ketolog:diaryView") || "list",
  );
  function switchDiaryView(v) {
    setDiaryView(v);
    localStorage.setItem("ketolog:diaryView", v);
  }
  const [jump, setJump] = useState(todayISO());
  const [activeDate, setActiveDate] = useState(todayISO()); // the day the "Today" tab + AddMeal point at
  const [loaded, setLoaded] = useState(false);

  // "Close the day": the user declares today finished, so every stat that
  // waits for midnight (dashboard analytics, averages, energy balance) counts
  // today as a completed day right away. Persisted on today's day document so
  // it syncs across devices; localStorage only gives the instant first paint
  // (a value from an older date is ignored, so it auto-expires when a real new
  // day starts). While closed, "effective today" is tomorrow, which flips
  // every `date < today` comparison to include today.
  const [dayClosed, setDayClosed] = useState(
    () => localStorage.getItem("ketolog:closedDay") === todayISO(),
  );
  const effectiveToday = dayClosed ? nextISO(todayISO()) : todayISO();

  // once the days load, the server value wins — covers a close/reopen made on
  // another device (a `closed` flag on a past date is simply never looked at)
  useEffect(() => {
    const todayDoc = days.find((d) => d.date === todayISO());
    if (todayDoc && typeof todayDoc.closed === "boolean") {
      setDayClosed(todayDoc.closed);
      if (todayDoc.closed) localStorage.setItem("ketolog:closedDay", todayISO());
      else localStorage.removeItem("ketolog:closedDay");
    }
  }, [days]);

  async function closeDay(closed) {
    const t = todayISO();
    // optimistic: flip locally right away, then persist to the day doc
    if (closed) localStorage.setItem("ketolog:closedDay", t);
    else localStorage.removeItem("ketolog:closedDay");
    setDayClosed(closed);
    if (closed) {
      toast("היום נסגר ונכלל בתובנות");
      // jump straight to the תובנות tab so the closed day shows up immediately
      window.dispatchEvent(
        new CustomEvent("ketolog:gotoTab", { detail: "insights" }),
      );
    }
    try {
      mergeDay(await api.upsertDay(t, { closed }));
    } catch (e) {
      toast(e.message);
    }
  }

  // The daily kcal target is never typed in — it's derived from the user's own
  // data: measured burn (TDEE, from weigh-ins + logged meals) minus the deficit
  // the monthly loss goal demands. Until there's enough data for the measured
  // burn, a provisional formula estimate (height / birth year / gender from the
  // profile + latest weigh-in) stands in; 0 (no coloring / no target line) only
  // when neither is available.
  const profile = useMemo(
    () => ({
      heightCm: user?.heightCm || 0,
      birthYear: user?.birthYear || 0,
      gender: user?.gender || '',
    }),
    [user],
  );
  const eb = useMemo(
    () => energyBalance(days, { lossTarget, today: effectiveToday, profile }),
    [days, lossTarget, effectiveToday, profile],
  );
  const kcalTarget = eb.ready
    ? eb.recommendedIntake
    : (eb.provisional?.recommendedIntake ?? 0);

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
    [toast],
  );

  useEffect(() => {
    reload(true).finally(() => setLoaded(true));
  }, [reload]);

  // Low-AI-budget warning on load (own-key accounts with a budget set).
  useEffect(() => {
    const budget = user?.ai?.monthlyBudgetUsd || 0;
    if (budgetAlerted || !user?.ai?.hasOwnKey || !budget) return;
    budgetAlerted = true;
    api
      .getMyAiUsage()
      .then(({ monthUsd }) => {
        const ratio = monthUsd / budget;
        if (ratio >= 1) {
          toast(`⚠️ עברתם את תקציב ה-AI החודשי שהגדרתם ($${budget}) — פרטים בהגדרות`);
        } else if (ratio >= 0.8) {
          toast(`⚠️ ניצלתם ${Math.round(ratio * 100)}% מתקציב ה-AI החודשי — פרטים בהגדרות`);
        }
      })
      .catch(() => {});
  }, [user, toast]);

  // the assistant commits meals/products straight to the DB — refresh when it does
  useEffect(() => {
    const onChange = () => reload();
    window.addEventListener("ketolog:dataChanged", onChange);
    return () => window.removeEventListener("ketolog:dataChanged", onChange);
  }, [reload]);

  // keep the active day's card open on the Today tab
  useEffect(() => {
    setExpanded((s) => (s.has(activeDate) ? s : new Set(s).add(activeDate)));
  }, [activeDate]);

  // While the tour runs, force the active day's card open — the demo meal's
  // buttons are tour anchors and must be in the DOM. Depends on `days` because
  // the first data load replaces the expanded set (newest logged day only),
  // which would otherwise fold today's card mid-tour.
  useEffect(() => {
    if (!needsOnboarding) return;
    setExpanded((s) => (s.has(activeDate) ? s : new Set(s).add(activeDate)));
  }, [needsOnboarding, activeDate, days]);

  function mergeDay(day) {
    setDays((prev) => {
      const others = prev.filter((d) => d.date !== day.date);
      return [...others, day].sort((a, b) => b.date.localeCompare(a.date));
    });
  }

  // build a "יום N · <weekday>" label when a day is first created
  function nextLabel(date) {
    return "יום " + (days.length + 1) + " · " + dayHebrewName(date);
  }

  // Chronological day index: the earliest logged date is "יום 1", regardless of
  // the order days were added. Computed live so it stays correct when a day is
  // inserted out of order. Counts existing dates earlier than `iso`, plus one
  // (so a brand-new date that isn't in `days` yet also gets the right number).
  const dayNumber = (iso) =>
    days.reduce((n, d) => (d.date < iso ? n + 1 : n), 1);
  const dayTitle = (iso) =>
    "יום " + dayNumber(iso) + " · " + dayHebrewName(iso);

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
    toast("הארוחה נמחקה");
  }

  // Edit a logged meal's time (HH:MM). DayCard sorts meals by time, so the row
  // moves into its new chronological slot as soon as the update lands.
  async function updateMealTime(date, mealId, time) {
    try {
      const day = await api.updateMeal(date, mealId, { time });
      mergeDay(day);
      toast("השעה עודכנה");
    } catch (e) {
      toast(e.message);
    }
  }

  // Only weight flows through here now (the weekly weigh-in card); run/abs/
  // status were retired from the UI, though old data still shows in exports.
  // An empty value clears that date's weigh-in (delete from the history list).
  async function setMetric(date, field, value) {
    const day = await api.setMetric(date, field, value);
    mergeDay(day);
    toast(value === "" ? "השקילה נמחקה" : "המשקל נשמר");
  }

  async function addProduct(p) {
    const created = await api.addProduct(p);
    setProducts((prev) => [...prev, created]);
  }
  // Partial product update (name / category / star) — shared by the products
  // panel and the picker popup.
  async function updateProduct(id, patch) {
    const updated = await api.updateProduct(id, patch);
    setProducts((prev) => prev.map((p) => (p._id === id ? updated : p)));
    return updated;
  }
  async function renameProduct(id, key) {
    await updateProduct(id, { key });
    toast("השם עודכן");
  }
  async function deleteProduct(id) {
    await api.deleteProduct(id);
    setProducts((prev) => prev.filter((p) => p._id !== id));
    toast("המוצר נמחק");
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
      toast("אין ארוחות מאתמול לשכפול");
      return;
    }
    try {
      await applyMeals(activeDate, yday.meals);
      toast("הארוחות מאתמול שוכפלו");
    } catch (e) {
      toast(e.message || "השכפול נכשל — נסו שוב");
    }
  }

  async function copyMealToActive(meal) {
    try {
      await applyMeals(activeDate, [meal]);
      toast("הארוחה שוכפלה ליום הנבחר");
    } catch (e) {
      toast(e.message || "השכפול נכשל — נסו שוב");
    }
  }

  // "Name this" dialog (in-app replacement for window.prompt) — set by the
  // save-as-template/product actions below: { title, def, submit(name) }.
  const [namePrompt, setNamePrompt] = useState(null);

  function saveMealAsTemplate(meal) {
    setNamePrompt({
      title: "שמירה כתבנית",
      label: "שם לתבנית",
      def: (meal.desc || meal.cat || "תבנית").slice(0, 30),
      submit: async (name) => {
        const created = await api.addTemplate({ name, ...cleanMeal(meal) });
        setTemplates((prev) => [...prev, created]);
        toast("התבנית נשמרה");
      },
    });
  }

  // Turn a logged meal into a reusable personal product (name + description +
  // macros), the same way "copy to day" / "save as template" work per row.
  function saveMealAsProduct(meal) {
    setNamePrompt({
      title: "הוספה כמוצר",
      label: "שם קצר למוצר חדש",
      def: (meal.desc || meal.cat || "מוצר").slice(0, 30),
      submit: async (name) => {
        await addProduct({
          key: name,
          label: (meal.desc || meal.cat || name).trim(),
          unit: "מנה",
          carbs: Number(meal.carbs) || 0,
          fat: Number(meal.fat) || 0,
          protein: Number(meal.protein) || 0,
        });
        toast("המוצר נוסף לרשימה שלך");
      },
    });
  }

  // Turn a single part of a meal into a reusable product. Its macros are already
  // per-unit, so the product maps onto it 1:1 (the unit becomes the product unit,
  // e.g. one "נקניקיה"), ready to one-click add to future meals.
  function saveItemAsProduct(item) {
    setNamePrompt({
      title: "הוספה כמוצר",
      label: "שם קצר למוצר חדש",
      def: (item.name || "מוצר").slice(0, 30),
      submit: async (name) => {
        await addProduct({
          key: name,
          label: (item.desc || item.name || name).trim(),
          unit: (item.unit || "").trim() || "מנה",
          carbs: Number(item.carbs) || 0,
          fat: Number(item.fat) || 0,
          protein: Number(item.protein) || 0,
        });
        toast("המוצר נוסף לרשימה שלך");
      },
    });
  }

  async function deleteTemplate(id) {
    await api.deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t._id !== id));
    toast("התבנית נמחקה");
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
        email: user?.email || "",
        ketoMonths: user?.ketoGoalMonths || 0,
        generatedAt: todayISO(),
      });
      toast("הדוח יוצא");
    } catch {
      toast("ייצוא הדוח נכשל");
    }
  }

  // Detailed diary Excel workbook (days / meals / items). from/to are inclusive
  // ISO dates; empty = the full log. exceljs is pulled in on demand so it stays
  // out of the main bundle.
  async function exportExcel(from, to) {
    const { downloadExcel } = await import("../lib/exportExcel.js");
    await downloadExcel({
      days,
      target,
      kcalTarget,
      from,
      to,
      generatedAt: todayISO(),
    });
  }

  // ---- summary (persistent header) ----
  const t = todayISO();
  // Average over *past* logged days only — today is still in progress, so
  // counting it would drag the average down (matches the insights tab).
  // "Past" is measured against the effective today, so closing the day pulls
  // today into the averages immediately.
  const pastDays = days.filter(
    (d) => d.date < effectiveToday && (d.meals || []).length > 0,
  );
  const totals = pastDays.map(dayTotal);
  const avg = totals.length
    ? totals.reduce((a, b) => a + b, 0) / totals.length
    : 0;
  // Average daily calories over the same past days (ones with macro detail).
  const kcals = pastDays.map(dayKcal).filter((k) => k != null);
  const avgKcal = kcals.length
    ? Math.round(kcals.reduce((a, b) => a + b, 0) / kcals.length)
    : null;
  const today = days.find((d) => d.date === t);
  const stats = {
    avg: totals.length ? fmt(avg) : "–",
    days: days.length || "–",
    today: today ? fmt(dayTotal(today)) : "0",
    todayNum: today ? dayTotal(today) : 0,
    avgKcal,
    target,
    kcalTarget,
  };

  const activeDay = days.find((d) => d.date === activeDate) || {
    date: activeDate,
    meals: [],
    metrics: {},
  };
  // While the tour runs, EVERYTHING it shows is demo data — same rich view for
  // every account, whatever their real data looks like: a demo meal on the
  // active day, the demo catalog, and two demo weeks for the dashboard. All of
  // it is render-only (the tour overlay blocks interaction) and the real data
  // returns untouched the moment the tour ends.
  const tourActiveDay = needsOnboarding
    ? { ...activeDay, meals: [TOUR_DEMO_MEAL] }
    : activeDay;
  const tourProducts = needsOnboarding ? TOUR_DEMO_PRODUCTS : products;
  const tourDays = useMemo(
    () => (needsOnboarding ? buildTourDays(todayISO()) : days),
    [needsOnboarding, days],
  );
  // The folded journal lists past days; the current day already has its own card
  // above it, so drop it from the "all" view to avoid showing it twice.
  const shown = viewDate
    ? days.filter((d) => d.date === viewDate)
    : days.filter((d) => d.date !== activeDate);
  const journalCount = days.filter((d) => d.date !== activeDate).length;

  const canRepeat =
    (days.find((d) => d.date === prevISO(activeDate))?.meals || []).length > 0;

  // ---- tab contents ----
  const productsPanel = (
    <Products
      products={tourProducts}
      onAdd={addProduct}
      onRename={renameProduct}
      onUpdate={updateProduct}
      onDelete={deleteProduct}
    />
  );

  // From the calendar grid, a day click opens that day's full card in a
  // modal — the grid stays behind it, edits land live via the shared handlers.
  const [modalDate, setModalDate] = useState("");
  useEffect(() => {
    if (!modalDate) return;
    const onKey = (e) => e.key === "Escape" && setModalDate("");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalDate]);
  const modalDay = modalDate
    ? days.find((d) => d.date === modalDate) || {
        date: modalDate,
        meals: [],
        metrics: {},
      }
    : null;
  const dayviewTrapRef = useFocusTrap(!!modalDay);

  const viewToggle = (
    <div
      className="view-toggle"
      role="group"
      aria-label="תצוגת היומן"
      style={{ marginInlineStart: "auto" }}
    >
      <button
        className={"vt-btn" + (diaryView === "list" ? " on" : "")}
        onClick={() => switchDiaryView("list")}
      >
        רשימה
      </button>
      <button
        className={"vt-btn" + (diaryView === "grid" ? " on" : "")}
        onClick={() => switchDiaryView("grid")}
      >
        לוח חודשי
      </button>
    </div>
  );

  const historyContent =
    diaryView === "grid" ? (
      <>
        <div className="toolbar">{viewToggle}</div>
        <DiaryGrid
          days={days}
          target={target}
          kcalTarget={kcalTarget}
          onOpenDay={setModalDate}
        />
      </>
    ) : (
      <>
        <div className="toolbar">
          <label style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            קפיצה ליום:
          </label>
          <input
            type="date"
            value={jump}
            onChange={(e) => setJump(e.target.value)}
          />
          <button
            className="btn ghost mini"
            onClick={() => jump && setViewDate(jump)}
          >
            הצג יום
          </button>
          <button className="btn ghost mini" onClick={() => setViewDate("")}>
            כל הימים
          </button>
          {viewToggle}
        </div>
        <div id="days">
          {!loaded ? null : shown.length === 0 ? (
            <div className="empty">
              {viewDate
                ? "אין רישום ליום שנבחר."
                : "אין עדיין ימים קודמים ביומן."}
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
                onCopyMeal={copyMealToActive}
                onSaveTemplate={saveMealAsTemplate}
                onSaveProduct={saveMealAsProduct}
                onSaveItemProduct={saveItemAsProduct}
                target={target}
                kcalTarget={kcalTarget}
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
      <RecordBanner
        days={days}
        target={target}
        today={effectiveToday}
        email={user?.email || ""}
      />
      <AddMeal
        onLogged={addMeal}
        date={activeDate}
        onDateChange={setActiveDate}
        products={tourProducts}
        templates={templates}
        onUpdateProduct={updateProduct}
        onDeleteProduct={deleteProduct}
        onDeleteTemplate={deleteTemplate}
        onRepeatYesterday={repeatYesterday}
        canRepeat={canRepeat}
        days={days}
        target={target}
        ketoMonths={user?.ketoGoalMonths || 0}
        avg={avg}
      />
      {/* until the first load lands, a skeleton in the day card's slot — an
          empty "אין ארוחות" card would read as data */}
      {!loaded ? (
        <SkeletonCard />
      ) : (
      <DayCard
        iso={activeDate}
        day={tourActiveDay}
        title={dayTitle(activeDate)}
        open={expanded.has(activeDate)}
        onCloseDay={activeDate === t ? closeDay : null}
        closed={dayClosed}
        onToggle={() => toggle(activeDate)}
        onDeleteMeal={deleteMeal}
        onSetMealTime={updateMealTime}
        onCopyMeal={copyMealToActive}
        onSaveTemplate={saveMealAsTemplate}
        onSaveProduct={saveMealAsProduct}
        onSaveItemProduct={saveItemAsProduct}
        target={target}
        kcalTarget={kcalTarget}
      />
      )}

      {/* small reference lines — below the day so the top stays clean */}
      <div className="today-hints">
        <div className="kcal-formula">
          חישוב קק"ל לגרם: שומן = 9 · חלבון = 4 · פחמימות = 4
        </div>
        <div className="keto-balance" title="היעד המאוזן בקיטו — חלוקה קלורית">
          <span className="kb-text">
            איזון קיטו: שומן 70–75% · חלבון 20–25% · פחמ' 5–10%
          </span>
        </div>
      </div>

      <div className={"journal-fold" + (historyOpen ? " open" : "")}>
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

  const tabs = [
    { id: "today", label: "היום", content: todayTab },
    {
      id: "insights",
      label: "תובנות",
      badge: insightsBadge,
      content: (
        <Dashboard
          days={tourDays}
          target={target}
          kcalTarget={kcalTarget}
          lossTarget={user?.monthlyLossTarget ?? 2}
          today={effectiveToday}
          ketoMonths={user?.ketoGoalMonths || 0}
          profile={profile}
        >
          <SmartInsights demo={needsOnboarding} />
        </Dashboard>
      ),
    },
    { id: "products", label: "המוצרים שלי", content: productsPanel },
  ];

  // The active-day calendar (prev/next + date input) sits in the tab row itself,
  // steering the same date the Today tab, AddMeal, quick add and menu use.
  const calNav = (
    <div className="cal-nav">
      <button
        type="button"
        className="date-arrow"
        title="יום הבא"
        disabled={activeDate >= todayISO()}
        onClick={() => setActiveDate(nextISO(activeDate))}
      >
        ‹
      </button>
      <input
        type="date"
        value={activeDate}
        onChange={(e) => setActiveDate(e.target.value)}
      />
      <button
        type="button"
        className="date-arrow"
        title="יום קודם"
        onClick={() => setActiveDate(prevISO(activeDate))}
      >
        ›
      </button>
    </div>
  );

  return (
    <div className="wrap">
      <Header
        stats={stats}
        onExport={exportReport}
        onExportExcel={exportExcel}
        firstDate={days.reduce((m, d) => (!m || d.date < m ? d.date : m), "")}
        days={days}
        onSaveWeight={(date, kg) => setMetric(date, "weight", kg)}
      />

      <TabShell tabs={tabs} extra={calNav} />

      {modalDay && (
        <div className="dayview-scrim" onClick={() => setModalDate("")}>
          <div
            className="dayview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={dayTitle(modalDate)}
            ref={dayviewTrapRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dayview-close"
              title="סגירה"
              onClick={() => setModalDate("")}
            >
              ✕
            </button>
            <DayCard
              key={modalDate}
              iso={modalDate}
              day={modalDay}
              title={dayTitle(modalDate)}
              open
              onToggle={() => {}}
              onDeleteMeal={deleteMeal}
              onSetMealTime={updateMealTime}
              onCopyMeal={copyMealToActive}
              onSaveTemplate={saveMealAsTemplate}
              onSaveProduct={saveMealAsProduct}
              onSaveItemProduct={saveItemAsProduct}
              target={target}
              kcalTarget={kcalTarget}
            />
          </div>
        </div>
      )}

      {namePrompt && (
        <NameDialog
          title={namePrompt.title}
          label={namePrompt.label}
          defaultValue={namePrompt.def}
          onSubmit={namePrompt.submit}
          onClose={() => setNamePrompt(null)}
        />
      )}

      <div className="foot">
        הנתונים נשמרים בענן (MongoDB) ומסונכרנים לחשבון שלך בכל מכשיר.
        <br />
        הערכים הם הערכות (±2–3 גרם למנות בית). היעד היומי שלך הוא מתחת ל-
        {fmt(target)} גרם פחמימות נטו ביום.
      </div>
    </div>
  );
}
