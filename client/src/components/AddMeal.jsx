import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useToast } from "../lib/toast.jsx";
import { useSpeech, speechErrorMessage } from "../lib/useSpeech.js";
import {
  fmt,
  macroPct,
  nowHM,
  prevISO,
  nextISO,
  todayISO,
} from "../lib/helpers.js";
import { parseAppLink, clearAppLink } from "../lib/appLink.js";
import MealShortcuts from "./MealShortcuts.jsx";
import "./AddMeal.scss";

export default function AddMeal({
  onLogged,
  date,
  onDateChange,
  products,
  templates,
  onDeleteTemplate,
  onRepeatYesterday,
  canRepeat,
}) {
  const toast = useToast();
  const [carb, setCarb] = useState("");
  const [desc, setDesc] = useState("");
  const [pendingMacro, setPendingMacro] = useState({
    fat: null,
    protein: null,
  });
  const [items, setItems] = useState([]); // per-item breakdown from the last calc
  const [note, setNote] = useState(null); // { html } via structured fields
  const [calcSource, setCalcSource] = useState(""); // 'catalog' | 'ai' | '' — where the last calc came from
  const [busy, setBusy] = useState(false);
  // Structured list of saved products the user tapped in, kept alongside the free
  // text. `descIsPure` stays true only while the description was built *solely*
  // from those taps (no manual typing / dictation / template). When it holds, the
  // meal is just a sum of known values, so we log it locally with no AI call.
  const [picked, setPicked] = useState([]);
  const [descIsPure, setDescIsPure] = useState(true);

  // Voice dictation: append the recognized speech to whatever was typed before recording.
  const baseDescRef = useRef("");
  const speech = useSpeech({
    onTranscript: (text) => {
      const base = baseDescRef.current;
      setDesc(base + (base && text ? " " : "") + text);
      markManual();
      clearNote();
    },
    onError: (err) => toast(speechErrorMessage(err)),
  });

  function toggleMic() {
    if (speech.listening) {
      speech.stop();
    } else {
      baseDescRef.current = desc.trim();
      speech.start();
    }
  }

  // Opened via a Claude meal deep link (?add=meal&…): prefill this form with the
  // computed values so the meal lands on the existing entry form, ready to log on
  // the user's approval. Because carbs is filled, logging won't trigger an AI
  // call. Product links (?add=product) are handled by AppLinkConfirm instead.
  useEffect(() => {
    const d = parseAppLink(window.location.search);
    if (!d || d.type !== "meal") return;
    clearAppLink();
    if (d.date) onDateChange(d.date);
    markManual(); // not a pure saved-products sum
    setDesc(d.desc || "");
    setCarb(d.carbs != null ? fmt(d.carbs) : "");
    setPendingMacro({ fat: d.fat ?? null, protein: d.protein ?? null });
    setItems(d.items || []);
    setNote({
      carbs: d.carbs != null ? fmt(d.carbs) : "?",
      fat: d.fat != null ? fmt(d.fat) : "?",
      protein: d.protein != null ? fmt(d.protein) : "?",
      mp:
        d.carbs != null && d.fat != null && d.protein != null
          ? macroPct({ carb: d.carbs, fat: d.fat, protein: d.protein })
          : null,
      items: d.items || [],
      claude: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearNote() {
    setNote(null);
    setPendingMacro({ fat: null, protein: null });
    setItems([]);
    setCalcSource("");
  }

  // Any hand-typed / dictated / template text means the description is no longer
  // a clean sum of saved products, so drop the structured list and fall back to
  // the AI path for this meal.
  function markManual() {
    setDescIsPure(false);
    setPicked([]);
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const unitKey = (p) => `${p.unit ? p.unit + " " : ""}${p.key}`.trim();
  // Human-readable description composed purely from the tapped products.
  const pickedToText = (list) =>
    list.map((p) => (p.qty > 1 ? `${fmt(p.qty)} ${unitKey(p)}` : unitKey(p))).join(", ");

  // Local (no-AI) total for a pure-products meal: sum each product's known macros
  // × quantity. Mirrors the server's item-derived totals, so the numbers match
  // exactly what the AI would have returned for the same saved products.
  function sumPicked(list) {
    const items = list.map((p) => ({
      name: p.key,
      qty: p.qty,
      unit: p.unit || "",
      carbs: p.carbs,
      fat: p.fat,
      protein: p.protein,
    }));
    const sum = (key) => round2(list.reduce((s, p) => s + (Number(p[key]) || 0) * p.qty, 0));
    return {
      carbs: sum("carbs"),
      fat: list.every((p) => p.fat != null) ? sum("fat") : null,
      protein: list.every((p) => p.protein != null) ? sum("protein") : null,
      items,
    };
  }

  const canSumLocally = () => descIsPure && picked.length > 0 && carb === "";

  // A product chip (ingredient). While the description is still a pure list of
  // taps, keep it structured (so we can total it locally with no AI). Once the
  // user has typed free text, just append it and let the AI parse the whole meal.
  function applyProduct(p) {
    clearNote();
    setCarb("");
    if (descIsPure) {
      const i = picked.findIndex((x) => x.key === p.key);
      const next =
        i >= 0
          ? picked.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x))
          : [
              ...picked,
              {
                key: p.key,
                label: p.label,
                unit: p.unit || "",
                carbs: Number(p.carbs) || 0,
                fat: p.fat ?? null,
                protein: p.protein ?? null,
                qty: 1,
              },
            ];
      setPicked(next);
      setDesc(pickedToText(next));
    } else {
      const chunk = unitKey(p);
      setDesc((d) => (d.trim() ? d.trim() + ", " + chunk : chunk));
    }
    toast(p.key + " נוסף לפירוט");
  }

  // A template (full meal) fills the form with its saved macros when the
  // description is empty (ready to log); if combined with text, it appends and
  // forces a recalc. Either way the meal is no longer a pure product sum.
  function applyTemplate(t) {
    const text = (t.desc || t.name || "").trim();
    const had = desc.trim();
    if (had) {
      setDesc(had + ", " + text);
      setCarb("");
      setPendingMacro({ fat: null, protein: null });
    } else {
      setDesc(text);
      setCarb(t.carbs != null && t.carbs !== "" ? String(t.carbs) : "");
      setPendingMacro({ fat: t.fat ?? null, protein: t.protein ?? null });
    }
    markManual();
    setNote(null);
    toast("התבנית נוספה לפירוט");
  }

  // `source` must be passed explicitly when doAdd runs right after a calc —
  // the calcSource state set moments earlier isn't visible yet in this closure.
  async function doAdd(carbsValue, macro, mealItems, source) {
    if (!date) {
      toast("בחר/י תאריך");
      return;
    }
    const src = source ?? calcSource;
    // Macros may arrive as numbers (from a calc) or as strings (hand-typed into
    // the fat/protein fields) — normalize to a number or null either way.
    const toNum = (v) => (v == null || v === "" ? null : Number(v));
    const meal = {
      time: nowHM(),
      desc: desc.trim(),
      carbs: Number(carbsValue) || 0,
      fat: toNum(macro?.fat),
      protein: toNum(macro?.protein),
      items: mealItems ?? items,
      source: src,
    };
    await onLogged(date, meal);
    setDesc("");
    setCarb("");
    setPicked([]);
    setDescIsPure(true);
    clearNote();
    toast(
      src === "catalog"
        ? "הארוחה נרשמה · 📖 ללא AI (מהקטלוג)"
        : src === "local"
          ? "הארוחה נרשמה · 🧮 ללא AI (מהמוצרים שלך)"
          : src === "ai"
            ? "הארוחה נרשמה · 🤖 חושב ב-AI"
            : "הארוחה נרשמה"
    );
  }

  async function runCalc(thenLog) {
    const d = desc.trim();
    if (!d) {
      toast("כתוב/י קודם מה אכלת");
      return;
    }
    // Pure saved-products meal → total it locally, no AI call, no cost.
    if (canSumLocally()) {
      const t = sumPicked(picked);
      setCarb(fmt(t.carbs));
      setPendingMacro({ fat: t.fat, protein: t.protein });
      setItems(t.items);
      setCalcSource("local");
      setNote({
        carbs: fmt(t.carbs),
        fat: t.fat == null ? "?" : fmt(t.fat),
        protein: t.protein == null ? "?" : fmt(t.protein),
        mp:
          t.fat != null && t.protein != null
            ? macroPct({ carb: t.carbs, fat: t.fat, protein: t.protein })
            : null,
        items: t.items,
        local: true,
      });
      if (thenLog) await doAdd(t.carbs, { fat: t.fat, protein: t.protein }, t.items, "local");
      return;
    }
    setBusy(true);
    setNote({ loading: true });
    try {
      const r = await api.estimateMeal(d);
      const n = Number(r.net_carbs);
      const fat = Number(r.fat);
      const prot = Number(r.protein);
      const mealItems = Array.isArray(r.items) ? r.items : [];
      const fromCatalog = r.source === "catalog";
      setCalcSource(fromCatalog ? "catalog" : "ai");
      const carbsValue = isNaN(n) ? "" : fmt(n);
      const macro = {
        fat: isNaN(fat) ? null : fat,
        protein: isNaN(prot) ? null : prot,
      };
      setCarb(carbsValue);
      setPendingMacro(macro);
      setItems(mealItems);
      const mp =
        !isNaN(fat) && !isNaN(prot)
          ? macroPct({ carb: isNaN(n) ? 0 : n, fat, protein: prot })
          : null;
      setNote({
        carbs: isNaN(n) ? "?" : fmt(n),
        fat: isNaN(fat) ? "?" : fmt(fat),
        protein: isNaN(prot) ? "?" : fmt(prot),
        mp,
        items: mealItems,
        catalog: fromCatalog,
        ai: !fromCatalog,
      });
      if (thenLog && !isNaN(n)) await doAdd(carbsValue, macro, mealItems, fromCatalog ? "catalog" : "ai");
    } catch {
      setNote({
        error:
          "לא הצלחתי לחשב אוטומטית כרגע — אפשר להזין מספר פחמימות ידנית ולרשום.",
      });
    } finally {
      setBusy(false);
    }
  }

  function onAddClick() {
    if (desc.trim() && carb === "") runCalc(true);
    else doAdd(carb, pendingMacro, items);
  }

  // Reset the form back to a clean "log something now" state: date → today,
  // and clear the description / carbs / calc result. The meal's time is stamped
  // automatically at log time, so there is no time field to reset.
  function resetForm() {
    onDateChange(todayISO());
    setCarb("");
    setDesc("");
    setPicked([]);
    setDescIsPure(true);
    clearNote();
    toast("הטופס אופס");
  }

  return (
    <div className="panel" data-tour="add-meal">
      <h2>הוספת ארוחה</h2>
      <div className="row">
        <div className="fld">
          <label>תאריך</label>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
          />
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
      </div>

      <div className="row macros" style={{ marginTop: 10 }}>
        <div className="fld">
          <label>פחמימות נטו <span className="unit">(גרם)</span></label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="חישוב אוטומטי"
            value={carb}
            onChange={(e) => setCarb(e.target.value)}
          />
        </div>
        <div className="fld">
          <label>חלבון <span className="unit">(גרם)</span></label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="—"
            value={pendingMacro.protein ?? ""}
            onChange={(e) =>
              setPendingMacro((m) => ({
                ...m,
                protein: e.target.value === "" ? null : e.target.value,
              }))
            }
          />
        </div>
        <div className="fld">
          <label>שומן <span className="unit">(גרם)</span></label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="—"
            value={pendingMacro.fat ?? ""}
            onChange={(e) =>
              setPendingMacro((m) => ({ ...m, fat: e.target.value === "" ? null : e.target.value }))
            }
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="fld wide">
          <label className="desc-label">
            <span>פירוט (מה אכלת) — תיאור חופשי, המערכת תחשב לבד</span>
            {speech.supported && (
              <button
                type="button"
                className={"mic" + (speech.listening ? " rec" : "")}
                onClick={toggleMic}
                disabled={speech.transcribing}
                title={speech.listening ? "עצור הקלטה" : "הקלט במקום להקליד"}
              >
                <span className="mic-dot">🎤</span>
                {speech.transcribing
                  ? "מתמלל…"
                  : speech.listening
                    ? "מקליט… הקש/י לעצירה"
                    : "הקלטה קולית"}
              </button>
            )}
          </label>
          <textarea
            data-tour="meal-desc"
            placeholder="לדוגמה: חביתה מ-3 ביצים, פרוסת גאודה, מלפפון לא קלוף, חופן שרי"
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
              markManual();
              clearNote();
            }}
          />
        </div>
      </div>

      <MealShortcuts
        products={products}
        templates={templates}
        onApplyProduct={applyProduct}
        onApplyTemplate={applyTemplate}
        onDeleteTemplate={onDeleteTemplate}
        onRepeatYesterday={onRepeatYesterday}
        canRepeat={canRepeat}
      />

      {note && (
        <div className="calc-note">
          {note.loading && "מחשב מאקרו (פחמימות, שומן, חלבון)…"}
          {note.error}
          {note.carbs && (
            <>
              <strong>
                {note.carbs} ג' פחמימות נטו · {note.fat} ג' שומן ·{" "}
                {note.protein} ג' חלבון
              </strong>
              {note.mp && (
                <span className="bd">
                  <br />
                  חלוקה קלורית: שומן {note.mp.fat}% · חלבון {note.mp.protein}% ·
                  פחמ' {note.mp.carb}% (~
                  {note.mp.kcal} קק"ל)
                </span>
              )}
              {note.claude && (
                <span className="bd">
                  <br />
                  🔗 מולא מקלוד — בדקו את הערכים ולחצו "חשב ורשום ארוחה".
                </span>
              )}
              {note.local && (
                <span className="bd">
                  <br />
                  🧮 ללא AI — חושב מהמוצרים השמורים שלך.
                </span>
              )}
              {note.catalog && (
                <span className="bd">
                  <br />
                  📖 ללא AI — חושב מקטלוג המוצרים הנלמד.
                </span>
              )}
              {note.ai && (
                <span className="bd">
                  <br />
                  🤖 חושב באמצעות AI.
                </span>
              )}
              {note.items && note.items.length > 0 && (
                <ul className="calc-items">
                  {note.items.map((it, i) => (
                    <li key={i}>
                      <span className="ci-name">
                        {it.qty > 1 && <b className="ci-qty">{fmt(it.qty)}×</b>}{" "}
                        {it.name}
                      </span>
                      <span className="ci-carb">
                        {fmt((Number(it.carbs) || 0) * (it.qty || 1))} ג' פחמ'
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
        <button className="btn" data-tour="meal-submit" disabled={busy} onClick={onAddClick}>
          {busy ? "מחשב…" : "חשב ורשום ארוחה"}
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => runCalc(false)}
        >
          חשב פחמימות בלבד
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={resetForm}
          title="איפוס: היום, ניקוי שדות"
        >
          איפוס
        </button>
      </div>
    </div>
  );
}
