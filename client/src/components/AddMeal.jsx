import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [time, setTime] = useState(nowHM());
  const [carb, setCarb] = useState("");
  const [desc, setDesc] = useState("");
  const [pendingMacro, setPendingMacro] = useState({
    fat: null,
    protein: null,
  });
  const [items, setItems] = useState([]); // per-item breakdown from the last calc
  const [note, setNote] = useState(null); // { html } via structured fields
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

  function clearNote() {
    setNote(null);
    setPendingMacro({ fat: null, protein: null });
    setItems([]);
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
    toast(t("addMeal.addedToBreakdown", { name: p.key }));
  }

  // A template (full meal) fills the form with its saved macros when the
  // description is empty (ready to log); if combined with text, it appends and
  // forces a recalc. Either way the meal is no longer a pure product sum.
  function applyTemplate(tpl) {
    const text = (tpl.desc || tpl.name || "").trim();
    const had = desc.trim();
    if (had) {
      setDesc(had + ", " + text);
      setCarb("");
      setPendingMacro({ fat: null, protein: null });
    } else {
      setDesc(text);
      setCarb(tpl.carbs != null && tpl.carbs !== "" ? String(tpl.carbs) : "");
      setPendingMacro({ fat: tpl.fat ?? null, protein: tpl.protein ?? null });
    }
    markManual();
    setNote(null);
    toast(t("addMeal.templateAddedToBreakdown"));
  }

  async function doAdd(carbsValue, macro, mealItems) {
    if (!date) {
      toast(t("addMeal.pickDate"));
      return;
    }
    const meal = {
      time,
      desc: desc.trim(),
      carbs: Number(carbsValue) || 0,
      fat: macro?.fat ?? null,
      protein: macro?.protein ?? null,
      items: mealItems ?? items,
    };
    await onLogged(date, meal);
    setDesc("");
    setCarb("");
    setPicked([]);
    setDescIsPure(true);
    clearNote();
    toast(t("addMeal.mealLogged"));
  }

  async function runCalc(thenLog) {
    const d = desc.trim();
    if (!d) {
      toast(t("addMeal.writeWhatYouAte"));
      return;
    }
    // Pure saved-products meal → total it locally, no AI call, no cost.
    if (canSumLocally()) {
      const tot = sumPicked(picked);
      setCarb(fmt(tot.carbs));
      setPendingMacro({ fat: tot.fat, protein: tot.protein });
      setItems(tot.items);
      setNote({
        carbs: fmt(tot.carbs),
        fat: tot.fat == null ? "?" : fmt(tot.fat),
        protein: tot.protein == null ? "?" : fmt(tot.protein),
        mp:
          tot.fat != null && tot.protein != null
            ? macroPct({ carb: tot.carbs, fat: tot.fat, protein: tot.protein })
            : null,
        items: tot.items,
        local: true,
      });
      if (thenLog) await doAdd(tot.carbs, { fat: tot.fat, protein: tot.protein }, tot.items);
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
      });
      if (thenLog && !isNaN(n)) await doAdd(carbsValue, macro, mealItems);
    } catch {
      setNote({
        error: t("addMeal.calcFailed"),
      });
    } finally {
      setBusy(false);
    }
  }

  function onAddClick() {
    if (desc.trim() && carb === "") runCalc(true);
    else doAdd(carb, pendingMacro, items);
  }

  // Reset the form back to a clean "log something now" state: time → now,
  // date → today, and clear the description / carbs / calc result.
  function resetForm() {
    setTime(nowHM());
    onDateChange(todayISO());
    setCarb("");
    setDesc("");
    setPicked([]);
    setDescIsPure(true);
    clearNote();
    toast(t("addMeal.formReset"));
  }

  return (
    <div className="panel" data-tour="add-meal">
      <h2>{t("addMeal.title")}</h2>
      <div className="row">
        <div className="fld">
          <label>{t("addMeal.date")}</label>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
          />
          <div className="date-nav">
            <button
              type="button"
              className="date-arrow"
              title={t("addMeal.nextDay")}
              disabled={date >= todayISO()}
              onClick={() => onDateChange(nextISO(date))}
            >
              ‹
            </button>
            <button
              type="button"
              className="date-arrow"
              title={t("addMeal.prevDay")}
              onClick={() => onDateChange(prevISO(date))}
            >
              ›
            </button>
          </div>
        </div>
        <div className="fld">
          <label>{t("addMeal.time")}</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="fld">
          <label>{t("addMeal.netCarbsGrams")}</label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder={t("addMeal.autoCalc")}
            value={carb}
            onChange={(e) => setCarb(e.target.value)}
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="fld wide">
          <label className="desc-label">
            <span>{t("addMeal.breakdownLabel")}</span>
            {speech.supported && (
              <button
                type="button"
                className={"mic" + (speech.listening ? " rec" : "")}
                onClick={toggleMic}
                disabled={speech.transcribing}
                title={speech.listening ? t("addMeal.stopRecording") : t("addMeal.recordInstead")}
              >
                <span className="mic-dot">🎤</span>
                {speech.transcribing
                  ? t("addMeal.transcribing")
                  : speech.listening
                    ? t("addMeal.recordingTapToStop")
                    : t("addMeal.voiceRecording")}
              </button>
            )}
          </label>
          <textarea
            placeholder={t("addMeal.descPlaceholder")}
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
          {note.loading && t("addMeal.calculatingMacros")}
          {note.error}
          {note.carbs && (
            <>
              <strong>
                {t("addMeal.macroSummary", {
                  carbs: note.carbs,
                  fat: note.fat,
                  protein: note.protein,
                })}
              </strong>
              {note.mp && (
                <span className="bd">
                  <br />
                  {t("addMeal.calorieBreakdown", {
                    fat: note.mp.fat,
                    protein: note.mp.protein,
                    carb: note.mp.carb,
                    kcal: note.mp.kcal,
                  })}
                </span>
              )}
              {note.local && (
                <span className="bd">
                  <br />
                  {t("addMeal.computedFromSaved")}
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
                        {t("addMeal.itemCarbs", {
                          carbs: fmt((Number(it.carbs) || 0) * (it.qty || 1)),
                        })}
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
        <button className="btn" disabled={busy} onClick={onAddClick}>
          {busy ? t("addMeal.calculating") : t("addMeal.calcAndLog")}
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => runCalc(false)}
        >
          {t("addMeal.calcCarbsOnly")}
        </button>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={resetForm}
          title={t("addMeal.resetTitle")}
        >
          {t("addMeal.reset")}
        </button>
      </div>
    </div>
  );
}
