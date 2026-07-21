import { useState } from "react";
import { useToast } from "../lib/toast.jsx";
import {
  dayTotal,
  dayMacroGrams,
  dayKcal,
  kcalZone,
  macroPct,
  macroKcal,
  hasMacros,
  fmt,
  heDate,
  zoneInfo,
  maxRange,
  TARGET,
} from "../lib/helpers.js";
import "./DayCard.scss";

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Tiny "add to the meal text box" button, next to each meal's description and
// each item's description. Dispatches a window event the composer (AddMeal)
// listens for, so it works from the journal and the calendar modal too.
// Stops propagation so it works inside clickable rows/headers.
function AddToTextBtn({ text }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="addto-btn"
      title="הוסף לתיבת הטקסט"
      aria-label="הוסף לתיבת הטקסט"
      onClick={(e) => {
        e.stopPropagation();
        const t = String(text ?? "").trim();
        if (!t) return;
        window.dispatchEvent(
          new CustomEvent("ketolog:addToMeal", { detail: t }),
        );
        toast("נוסף לתיבת הטקסט");
      }}
    >
      +
    </button>
  );
}

// Keep only digits and lay them out as HH:MM (a colon after the 2nd digit).
// Typing "0930" yields "09:30"; anything non-numeric is dropped.
function formatHM(raw) {
  const d = String(raw).replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : d.slice(0, 2) + ":" + d.slice(2);
}

// The meal time, shown as a tap-to-edit chip. Editing accepts digits only,
// formatted as HH:MM; a valid, changed value is saved on blur / Enter, and the
// parent re-sorts the meal into its new slot.
function MealTime({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");

  if (!onSave) return <div className="time">{value || "--:--"}</div>;

  function commit() {
    setEditing(false);
    const v = val.trim();
    if (HM_RE.test(v) && v !== value) onSave(v);
    else setVal(value || "");
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="time time-btn"
        data-tour="meal-time"
        title="הקש/י לעריכת השעה"
        onClick={(e) => {
          e.stopPropagation(); // the meal row behind toggles its fold
          setVal(value || "");
          setEditing(true);
        }}
      >
        {value || "--:--"}
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
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(formatHM(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setVal(value || "");
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
  onCopyMeal,
  onSaveTemplate,
  onSaveProduct,
  onSaveItemProduct,
  onCloseDay,
  closed = false,
  target = TARGET,
  kcalTarget = 0,
}) {
  const total = dayTotal(day);
  const zi = zoneInfo(total, target);
  const maxr = maxRange(target);
  const meals = [...(day.meals || [])].sort((a, b) =>
    (a.time || "").localeCompare(b.time || ""),
  );
  const g = dayMacroGrams(day);
  const mp = macroPct(g);
  const kcal = dayKcal(day);
  const kz = kcalZone(kcal, kcalTarget);

  // Per-meal fold: rows show only time · title · carbs; tapping a row reveals
  // the item breakdown, macro split and the row actions.
  const [openMeals, setOpenMeals] = useState(() => new Set());
  const toggleMeal = (id) =>
    setOpenMeals((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  const allOpen =
    meals.length > 0 && meals.every((m) => openMeals.has(m._id));
  const toggleAllMeals = () =>
    setOpenMeals(allOpen ? new Set() : new Set(meals.map((m) => m._id)));

  return (
    <div className={"day" + (open ? " open" : "")}>
      <div
        className="day-head"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="day-htext">
          <span className="day-title">{title || day.label || iso}</span>
          <span className="day-date">{heDate(iso)}</span>
        </span>
        <span className="day-hright">
          <span className="day-hnums">
            <span className="day-total" style={{ color: zi.color }}>
              {fmt(total)} <small>ג' נטו</small>
            </span>
            {(kcal != null || (onCloseDay && !closed && kcalTarget > 0)) && (
              <span className="day-kcal-row">
                {kcal != null && (
                  <span
                    className="day-kcal"
                    style={kz ? { color: kz.color } : undefined}
                    title={kz ? kz.cap : 'סה"כ קלוריות ליום (לפי המאקרו שתועד)'}
                  >
                    ~{kcal} <small>קק"ל</small>
                  </span>
                )}
                {/* live kcal budget — inline next to the day's kcal, current
                    open day only: room left up to the goal-pace bound, or overshoot */}
                {onCloseDay && !closed && kcalTarget > 0 && (
                  <span
                    className={'day-kcal-left ' + ((kcal || 0) <= kcalTarget ? 'good' : 'over')}
                    title={`גבול קצב היעד: ${kcalTarget.toLocaleString()} קק"ל ליום`}
                  >
                    {(kcal || 0) <= kcalTarget
                      ? `· נותרו ~${Math.round(kcalTarget - (kcal || 0)).toLocaleString()}`
                      : `· ~${Math.round((kcal || 0) - kcalTarget).toLocaleString()} מעל היעד`}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="chev"></span>
        </span>
      </div>

      <div className="meter">
        <span style={{ width: zi.pct + "%", background: zi.color }}></span>
        <i
          className="meter-mark"
          title={"גבול היעד: " + fmt(target) + " גרם"}
        ></i>
      </div>
      <div className="meter-scale">
        <span className="s0">0</span>
        <span className="s20">יעד {fmt(target)}</span>
        <span className="s50">{fmt(maxr)}</span>
      </div>
      <div className="meter-cap">{zi.cap}</div>

      {/* "close the day" — only the current day gets this (onCloseDay prop).
          Closing counts today in the insights immediately, instead of waiting
          for midnight; it's reversible until the real day actually changes. */}
      {onCloseDay && (
        <div className="day-close">
          {closed ? (
            <>
              <span className="day-close-note">✓ היום נסגר ונכלל בתובנות</span>
              <button className="dc-undo" onClick={() => onCloseDay(false)}>
                ביטול סגירה
              </button>
            </>
          ) : (
            <button
              className="dc-btn"
              title="סיום היום — הנתונים ייכללו בתובנות מיד, בלי לחכות לחצות"
              onClick={() => onCloseDay(true)}
            >
              🌙 סגירת היום
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="day-body">
          {hasMacros(day) && mp ? (
            <div className="macro">
              <div className="macro-bar">
                <span className="seg" style={{ width: mp.fat + "%" }}>
                  <b>{mp.fat}%</b>
                  <i style={{ background: "var(--olive)" }}></i>
                </span>
                <span className="seg" style={{ width: mp.protein + "%" }}>
                  <b>{mp.protein}%</b>
                  <i style={{ background: "var(--protein)" }}></i>
                </span>
                <span className="seg" style={{ width: mp.carb + "%" }}>
                  <b>{mp.carb}%</b>
                  <i style={{ background: "var(--amber)" }}></i>
                </span>
              </div>
              <div className="macro-legend">
                <span>
                  <span
                    className="dot"
                    style={{ background: "var(--olive)" }}
                  ></span>
                  שומן <b>{mp.fat}%</b> · {fmt(g.fat)} ג'
                </span>
                <span>
                  <span
                    className="dot"
                    style={{ background: "var(--protein)" }}
                  ></span>
                  חלבון <b>{mp.protein}%</b> · {fmt(g.protein)} ג'
                </span>
                <span>
                  <span
                    className="dot"
                    style={{ background: "var(--amber)" }}
                  ></span>
                  פחמ' <b>{mp.carb}%</b> · {fmt(g.carb)} ג'
                </span>
                <span style={{ marginInlineStart: "auto" }}>
                  ~{mp.kcal} קק"ל
                </span>
              </div>
            </div>
          ) : (
            <div className="macro-na">מאקרו (שומן/חלבון) לא תועד ליום זה</div>
          )}

          {meals.length > 1 && (
            <div className="meals-tools">
              <button
                type="button"
                className="fold-all"
                onClick={toggleAllMeals}
              >
                {allOpen ? "כווץ הכל" : "פתח הכל"}
                <span
                  className={"chev fold-all-chev" + (allOpen ? " up" : "")}
                ></span>
              </button>
            </div>
          )}
          <div className="meals">
            {meals.length === 0 ? (
              <div
                className="desc"
                style={{ padding: "10px 0", color: "var(--ink-soft)" }}
              >
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
                const mopen = openMeals.has(m._id);
                return (
                  <div className={"meal" + (mopen ? " open" : "")} key={m._id}>
                    <div
                      className="meal-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={mopen}
                      onClick={() => toggleMeal(m._id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleMeal(m._id);
                        }
                      }}
                    >
                      <MealTime
                        value={m.time}
                        onSave={
                          onSetMealTime
                            ? (t) => onSetMealTime(iso, m._id, t)
                            : null
                        }
                      />
                      <div className="desc">
                        {m.desc || m.cat}
                        <AddToTextBtn text={m.desc || m.cat} />
                        {onSaveProduct && (
                          <button
                            type="button"
                            className="mini-act"
                            title="הוסף כמוצר"
                            aria-label="הוסף כמוצר"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSaveProduct(m);
                            }}
                          >
                            📦
                          </button>
                        )}
                        {m.source === "local" && (
                          <span
                            className="meal-src"
                            title="חושב מהמוצרים השמורים שלך — ללא AI"
                          >
                            🧮
                          </span>
                        )}
                        {m.source === "ai" && (
                          <span className="meal-src" title="חושב באמצעות AI">
                            🤖
                          </span>
                        )}
                      </div>
                      <div className="carb">
                        {fmt(Number(m.carbs) || 0)} ג'
                        {mkcal != null && (
                          <span
                            className="carb-kcal"
                            title="קלוריות לארוחה (לפי המאקרו שתועד)"
                          >
                            ~{mkcal} קק"ל
                          </span>
                        )}
                      </div>
                      <span className="chev meal-chev"></span>
                    </div>
                    {mopen && (
                    <div className="meal-more">
                      {items.length > 0 && (
                        <ul className="meal-items">
                          <li className="mi-head">
                            <span>קק״ל</span>
                            <span>ג׳ פחמימות</span>
                          </li>
                          {items.map((it, i) => {
                            const ikcal = macroKcal(it, it.qty || 1);
                            return (
                              <li key={i}>
                                <span className="mi-name">
                                  {it.qty > 1 && (
                                    <b className="mi-qty">{fmt(it.qty)}×</b>
                                  )}{" "}
                                  {it.name}
                                  {it.desc && it.desc !== it.name && (
                                    <>
                                      {" — "}
                                      <span className="mi-desc">{it.desc}</span>
                                    </>
                                  )}
                                  <AddToTextBtn text={it.desc || it.name} />
                                  {onSaveItemProduct && (
                                    <button
                                      type="button"
                                      className="mini-act"
                                      title="הוסף כמוצר"
                                      aria-label="הוסף כמוצר"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onSaveItemProduct(it);
                                      }}
                                    >
                                      📦
                                    </button>
                                  )}
                                </span>
                                {/* always rendered — each row must fill its
                                    grid column even when kcal is unknown */}
                                <span
                                  className="mi-kcal"
                                  title={ikcal != null ? "קלוריות לפריט (לפי המאקרו שלו)" : undefined}
                                >
                                  {ikcal != null && <>~{ikcal}</>}
                                </span>
                                <span className="mi-carb">
                                  {fmt((Number(it.carbs) || 0) * (it.qty || 1))}
                                </span>
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
                          <span
                            className="seg"
                            style={{ width: mmp.fat + "%" }}
                          >
                            <b>{mmp.fat}%</b>
                            <i style={{ background: "var(--olive)" }}></i>
                          </span>
                          <span
                            className="seg"
                            style={{ width: mmp.protein + "%" }}
                          >
                            <b>{mmp.protein}%</b>
                            <i style={{ background: "var(--protein)" }}></i>
                          </span>
                          <span
                            className="seg"
                            style={{ width: mmp.carb + "%" }}
                          >
                            <b>{mmp.carb}%</b>
                            <i style={{ background: "var(--amber)" }}></i>
                          </span>
                        </div>
                      )}
                    <div className="meal-acts">
                      {onSaveTemplate && (
                        <button
                          className="mact"
                          title="שמור כתבנית"
                          onClick={() => onSaveTemplate(m)}
                        >
                          ★
                        </button>
                      )}
                      {onCopyMeal && (
                        <button
                          className="mact"
                          title="שכפל ליום הנבחר"
                          onClick={() => onCopyMeal(m)}
                        >
                          ⧉
                        </button>
                      )}
                      <button
                        className="del"
                        title="מחק"
                        onClick={() => onDeleteMeal(iso, m._id)}
                      >
                        ✕
                      </button>
                    </div>
                    </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
