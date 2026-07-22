import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { useToast } from "../lib/toast.jsx";
import { useSpeech, speechErrorMessage } from "../lib/useSpeech.js";
import {
  fmt,
  heDate,
  macroPct,
  nowHM,
  todayISO,
} from "../lib/helpers.js";
import { parseAppLink, clearAppLink } from "../lib/appLink.js";
import { openClaudeCalc } from "../lib/claudeCalc.js";
import { loadCats } from "../lib/categories.js";
import ProductPicker from "./ProductPicker.jsx";
import "./AddMeal.scss";

export default function AddMeal({
  onLogged,
  date,
  onDateChange,
  products,
  templates,
  onUpdateProduct,
  onDeleteProduct,
  onDeleteTemplate,
  onRepeatYesterday,
  canRepeat,
  // context for the "calc with Claude" popups
  days = [],
  target,
  ketoMonths = 0,
  avg = 0,
}) {
  const toast = useToast();
  // Voice dictation transcribes server-side (a paid AI call), so the mic shows
  // only for accounts whose /me payload says voice is available. `aiOn` gates
  // the in-app AI meal calc — accounts with a working key calc without leaving
  // the app; everyone else goes through the Claude-link flow.
  const { user, needsOnboarding } = useAuth();
  const voiceOn = !!user?.ai?.voice;
  const aiOn = !!user?.ai?.enabled;
  const [carb, setCarb] = useState("");
  const [desc, setDesc] = useState("");
  const [pendingMacro, setPendingMacro] = useState({
    fat: null,
    protein: null,
  });
  const [items, setItems] = useState([]); // per-item breakdown from the last calc
  const [note, setNote] = useState(null); // { html } via structured fields
  const [calcSource, setCalcSource] = useState(""); // 'local' | 'ai' | '' — where the last calc came from
  const [busy, setBusy] = useState(false);
  // which popup is open: '' | 'products'
  const [modal, setModal] = useState("");
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

  // Escape closes whichever composer popup is open (the picker/Claude modals
  // also listen themselves; closing twice is a no-op).
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => e.key === "Escape" && setModal("");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  // "הוסף לתיבת הטקסט" buttons on the day cards (meal / item descriptions)
  // dispatch this event — append their text to the shared description.
  useEffect(() => {
    const onAddText = (e) => {
      const text = String(e.detail || "").trim();
      if (!text) return;
      setDesc((d) => (d.trim() ? d.trim() + ", " + text : text));
      markManual();
      clearNote();
    };
    window.addEventListener("ketolog:addToMeal", onAddText);
    return () => window.removeEventListener("ketolog:addToMeal", onAddText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // How often each saved product was actually logged (by item name across the
  // whole journal) — drives the "לפי שימוש" sort in the products popup.
  const usage = useMemo(() => {
    const m = new Map();
    for (const d of days)
      for (const meal of d.meals || [])
        for (const it of meal.items || []) {
          const k = (it.name || "").trim();
          if (k) m.set(k, (m.get(k) || 0) + 1);
        }
    return m;
  }, [days]);

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
    // Macros may arrive as numbers (from a calc) or as strings — normalize to a
    // number or null either way.
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
    // On failure keep everything the user composed so they can just retry —
    // silently losing a meal is the worst outcome for a logging app.
    try {
      await onLogged(date, meal);
    } catch (e) {
      toast(e.message || "שמירת הארוחה נכשלה — נסו שוב");
      return;
    }
    setDesc("");
    setCarb("");
    setPicked([]);
    setDescIsPure(true);
    clearNote();
    toast(
      src === "local"
        ? "הארוחה נרשמה · 🧮 ללא AI (מהמוצרים שלך)"
        : src === "ai"
          ? "הארוחה נרשמה · 🤖 חושב ב-AI"
          : "הארוחה נרשמה"
    );
  }

  // Free-text calc is no longer done in-app (no server AI call): both submit
  // buttons open claude.ai with the full prompt built from the SAME text box.
  // Claude's reply carries a deep link back — for a meal it prefills this form
  // (confirm with the same ✓), for a product it opens the add-product dialog.
  async function sendToClaude(mode) {
    const clean = desc.trim();
    if (!clean) {
      toast(mode === "product" ? "כתבו קודם את פרטי המוצר בתיבת הטקסט" : "כתוב/י קודם מה אכלת");
      return;
    }
    const { copied } = await openClaudeCalc({
      text: clean,
      days,
      target,
      ketoMonths,
      avg,
      mode,
      // for a product, Claude also picks a category out of the user's own list
      cats: mode === "product" ? loadCats(products) : [],
    });
    setNote({
      info:
        (mode === "product" ? "📦" : "🤖") +
        " נפתח קלוד בטאב חדש" +
        (copied ? " והפרומפט הועתק ללוח" : "") +
        (mode === "product"
          ? ". בסיום החישוב לחצו על הקישור שקלוד יחזיר — ייפתח אישור הוספת המוצר לרשימה שלכם."
          : ". בסיום החישוב לחצו על הקישור שקלוד יחזיר — הטופס כאן יתמלא אוטומטית, ותצטרכו רק לאשר ולרשום."),
    });
    toast(copied ? "נפתח קלוד · הפרומפט הועתק ללוח" : "נפתח קלוד בטאב חדש");
  }

  // Total a pure saved-products meal locally — no AI, no cost. The only
  // in-app calculation left; anything free-text goes through Claude above.
  async function runLocalCalc(thenLog) {
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
  }

  // In-app AI estimation — available only when the account has a working AI
  // key (the server bills that key). Everyone else gets the Claude-link flow.
  async function runAiCalc(thenLog) {
    setBusy(true);
    setNote({ loading: true });
    try {
      const r = await api.estimateMeal(desc.trim());
      const n = Number(r.net_carbs);
      const fat = Number(r.fat);
      const prot = Number(r.protein);
      const mealItems = Array.isArray(r.items) ? r.items : [];
      // 'local' = the server matched the user's own saved products (above all)
      const src = r.source === "local" ? "local" : "ai";
      setCalcSource(src);
      const carbsValue = isNaN(n) ? "" : fmt(n);
      const macro = { fat: isNaN(fat) ? null : fat, protein: isNaN(prot) ? null : prot };
      setCarb(carbsValue);
      setPendingMacro(macro);
      setItems(mealItems);
      const mp = !isNaN(fat) && !isNaN(prot)
        ? macroPct({ carb: isNaN(n) ? 0 : n, fat, protein: prot })
        : null;
      setNote({
        carbs: isNaN(n) ? "?" : fmt(n),
        fat: isNaN(fat) ? "?" : fmt(fat),
        protein: isNaN(prot) ? "?" : fmt(prot),
        mp, items: mealItems, local: src === "local", ai: src === "ai",
      });
      if (thenLog && !isNaN(n)) await doAdd(carbsValue, macro, mealItems, src);
    } catch (e) {
      // key problems (no credit / invalid) arrive with a specific message
      const msg = e?.message && e.message !== "שגיאה" ? e.message : "";
      setNote({ error: msg || "לא הצלחתי לחשב אוטומטית כרגע — נסו שוב בעוד רגע." });
    } finally {
      setBusy(false);
    }
  }

  // One dispatcher for "calculate this meal": saved-products sum (free) →
  // in-app AI (key accounts) → Claude link (everyone else).
  function runCalc(thenLog) {
    if (!desc.trim()) {
      toast("כתוב/י קודם מה אכלת");
      return;
    }
    if (canSumLocally()) return runLocalCalc(thenLog);
    if (aiOn) return runAiCalc(thenLog);
    return sendToClaude("meal");
  }

  function onAddClick() {
    if (desc.trim() && carb === "") runCalc(true);
    else doAdd(carb, pendingMacro, items);
  }

  // Clear the meal being composed: description / picked products / carbs /
  // calc result. Also used by the products popup's "נקה" button.
  function clearComposer() {
    setCarb("");
    setDesc("");
    setPicked([]);
    setDescIsPure(true);
    clearNote();
  }

  // Reset the form back to a clean "log something now" state: date → today,
  // and clear the composed meal. The meal's time is stamped automatically at
  // log time, so there is no time field to reset.
  function resetForm() {
    onDateChange(todayISO());
    clearComposer();
    toast("הטופס אופס");
  }

  const onDescChange = (e) => {
    setDesc(e.target.value);
    markManual();
    clearNote();
  };

  const isToday = date === todayISO();

  return (
    <div className="panel addmeal" data-tour="add-meal">
      {/* the day this composer logs to — the picker itself lives up in the tab
          bar, so without this line a meal can silently land on a past day */}
      {!isToday && (
        <div className="compose-for" role="status">
          <span className="compose-for-warn">⚠️</span>
          הארוחה תירשם ליום אחר: <b>{heDate(date)}</b>
          <button
            type="button"
            className="compose-today"
            onClick={() => onDateChange(todayISO())}
          >
            חזרה להיום
          </button>
        </div>
      )}
      {/* one top row: CTAs · the text box · submit. Every entry point feeds
          the same text box. The calendar lives up in the tab bar (TabShell). */}
      <div className="composer">
        <div className="composer-ctas">
          <button
            type="button"
            className="cta"
            data-tour="shortcuts"
            title="המוצרים שלי"
            onClick={() => setModal("products")}
          >
            <span className="cta-ico">🧺</span>
          </button>
        </div>

        <div className="desc-wrap">
          <textarea
            data-tour="meal-desc"
            rows={1}
            placeholder={
              aiOn
                ? "מה אכלת? תיאור חופשי — המערכת תחשב לבד"
                : "מה אכלת? תיאור חופשי — החישוב ייפתח בקלוד"
            }
            value={desc}
            onChange={onDescChange}
          />
          {voiceOn && speech.supported && (
            <button
              type="button"
              className={"mic-mini" + (speech.listening ? " rec" : "")}
              onClick={toggleMic}
              disabled={speech.transcribing}
              title={
                speech.transcribing
                  ? "מתמלל…"
                  : speech.listening
                    ? "מקליט… הקש/י לעצירה"
                    : "הקלטה קולית"
              }
            >
              🎤
            </button>
          )}
        </div>

        {/* the senders sit side by side and share the text box above: the main
            submit calculates a MEAL — in-app for AI-key accounts, via a Claude
            link otherwise (or logs directly when the values are already known);
            🤖 (key accounts only) forces the Claude-link flow instead; 📦 sends
            the same text as a new PRODUCT */}
        <div className="composer-submits">
          <button
            className="btn composer-submit"
            data-tour="meal-submit"
            disabled={busy || (!desc.trim() && carb === "")}
            title={
              busy
                ? "מחשב…"
                : !desc.trim() && carb === ""
                  ? "כתבו קודם מה אכלתם"
                  : carb !== ""
                    ? "הוסף ארוחה"
                    : canSumLocally()
                      ? "חשב מהמוצרים השמורים והוסף ארוחה"
                      : aiOn
                        ? "חשב והוסף ארוחה"
                        : "חשב ארוחה בקלוד — ייפתח צ'אט שיחזיר קישור למילוי הטופס"
            }
            onClick={onAddClick}
          >
            {busy
              ? "…"
              : desc.trim() && carb === "" && !canSumLocally() && !aiOn
                ? "🤖"
                : "✓"}
          </button>
          {aiOn && (
            <button
              type="button"
              className="btn ghost composer-submit composer-product"
              data-tour="claude-submit"
              disabled={busy || !desc.trim()}
              title={
                desc.trim()
                  ? "חשב ארוחה בקלוד (בצ'אט שלכם, ללא עלות) — יחזיר קישור למילוי הטופס"
                  : "כתבו קודם מה אכלתם"
              }
              onClick={() => sendToClaude("meal")}
            >
              🤖
            </button>
          )}
          <button
            type="button"
            className="btn ghost composer-submit composer-product"
            data-tour="product-submit"
            disabled={busy || !desc.trim()}
            title={
              desc.trim()
                ? "הוסף כמוצר חדש — קלוד יחשב את הערכים מהטקסט שכתבתם ויחזיר קישור לאישור"
                : "כתבו קודם את פרטי המוצר בתיבת הטקסט"
            }
            onClick={() => sendToClaude("product")}
          >
            📦
          </button>
        </div>

        <div className="composer-tools">
          {/* calc without logging — meaningful only when the calc happens
              in-app (AI-key accounts / saved-products sums) */}
          {aiOn && (
            <button
              type="button"
              className="mini-tool"
              data-tour="calc-only"
              title="חשב פחמימות בלבד — בלי לרשום"
              disabled={busy}
              onClick={() => runCalc(false)}
            >
              🧮
            </button>
          )}
          <button
            type="button"
            className="mini-tool"
            data-tour="reset-form"
            title="איפוס: היום, ניקוי שדות"
            disabled={busy}
            onClick={resetForm}
          >
            ↺
          </button>
        </div>
      </div>

      {note && (
        <div className="calc-note">
          {note.loading && "מחשב מאקרו (פחמימות, שומן, חלבון)…"}
          {note.info}
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
                  🔗 מולא מקלוד — בדקו את הערכים ולחצו "הוסף ארוחה".
                </span>
              )}
              {note.local && (
                <span className="bd">
                  <br />
                  🧮 ללא AI — חושב מהמוצרים השמורים שלך.
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
                        {it.desc && it.desc !== it.name && (
                          <>
                            {" — "}
                            <span className="ci-desc">{it.desc}</span>
                          </>
                        )}
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

      {/* ---- CTA popups — all of them feed the same text box above ---- */}
      {modal === "products" && (
        <ProductPicker
          products={products}
          templates={templates}
          usage={usage}
          desc={desc}
          onApplyProduct={applyProduct}
          onApplyTemplate={applyTemplate}
          onClear={() => {
            clearComposer();
            toast("הפירוט נוקה");
          }}
          onUpdateProduct={onUpdateProduct}
          onDeleteProduct={onDeleteProduct}
          onDeleteTemplate={onDeleteTemplate}
          onRepeatYesterday={onRepeatYesterday}
          canRepeat={canRepeat}
          onClose={() => setModal("")}
          tourOpen={needsOnboarding}
        />
      )}

    </div>
  );
}
