import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useSpeech, speechErrorMessage } from '../lib/useSpeech.js';
import { fmt, macroPct, nowHM } from '../lib/helpers.js';
import MealShortcuts from './MealShortcuts.jsx';
import './AddMeal.scss';

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
  const [time, setTime] = useState(nowHM());
  const [carb, setCarb] = useState('');
  const [desc, setDesc] = useState('');
  const [pendingMacro, setPendingMacro] = useState({ fat: null, protein: null });
  const [items, setItems] = useState([]); // per-item breakdown from the last calc
  const [note, setNote] = useState(null); // { html } via structured fields
  const [busy, setBusy] = useState(false);

  // Voice dictation: append the recognized speech to whatever was typed before recording.
  const baseDescRef = useRef('');
  const speech = useSpeech({
    onTranscript: (text) => {
      const base = baseDescRef.current;
      setDesc(base + (base && text ? ' ' : '') + text);
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

  // A product chip (ingredient) is appended to the description; the carbs reset
  // so the whole meal gets recalculated.
  function applyProduct(p) {
    const chunk = p.unit + ' ' + p.key;
    setDesc((d) => (d.trim() ? d.trim() + ', ' + chunk : chunk));
    setCarb('');
    clearNote();
    toast(p.key + ' נוסף לפירוט');
  }

  // A template (full meal) fills the form with its saved macros when the
  // description is empty (ready to log); if combined with text, it appends and
  // forces a recalc.
  function applyTemplate(t) {
    const text = (t.desc || t.name || '').trim();
    const had = desc.trim();
    if (had) {
      setDesc(had + ', ' + text);
      setCarb('');
      setPendingMacro({ fat: null, protein: null });
    } else {
      setDesc(text);
      setCarb(t.carbs != null && t.carbs !== '' ? String(t.carbs) : '');
      setPendingMacro({ fat: t.fat ?? null, protein: t.protein ?? null });
    }
    setNote(null);
    toast('התבנית נוספה לפירוט');
  }

  async function doAdd(carbsValue, macro, mealItems) {
    if (!date) {
      toast('בחר/י תאריך');
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
    setDesc('');
    setCarb('');
    clearNote();
    toast('הארוחה נרשמה');
  }

  async function runCalc(thenLog) {
    const d = desc.trim();
    if (!d) {
      toast('כתוב/י קודם מה אכלת');
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
      const carbsValue = isNaN(n) ? '' : fmt(n);
      const macro = { fat: isNaN(fat) ? null : fat, protein: isNaN(prot) ? null : prot };
      setCarb(carbsValue);
      setPendingMacro(macro);
      setItems(mealItems);
      const mp =
        !isNaN(fat) && !isNaN(prot) ? macroPct({ carb: isNaN(n) ? 0 : n, fat, protein: prot }) : null;
      setNote({
        carbs: isNaN(n) ? '?' : fmt(n),
        fat: isNaN(fat) ? '?' : fmt(fat),
        protein: isNaN(prot) ? '?' : fmt(prot),
        mp,
        items: mealItems,
      });
      if (thenLog && !isNaN(n)) await doAdd(carbsValue, macro, mealItems);
    } catch {
      setNote({ error: 'לא הצלחתי לחשב אוטומטית כרגע — אפשר להזין מספר פחמימות ידנית ולרשום.' });
    } finally {
      setBusy(false);
    }
  }

  function onAddClick() {
    if (desc.trim() && carb === '') runCalc(true);
    else doAdd(carb, pendingMacro, items);
  }

  return (
    <div className="panel" data-tour="add-meal">
      <h2>הוספת ארוחה</h2>
      <div className="row">
        <div className="fld">
          <label>תאריך</label>
          <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
        </div>
        <div className="fld">
          <label>שעה</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="fld">
          <label>פחמימות נטו (גרם)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="חישוב אוטומטי"
            value={carb}
            onChange={(e) => setCarb(e.target.value)}
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
                className={'mic' + (speech.listening ? ' rec' : '')}
                onClick={toggleMic}
                disabled={speech.transcribing}
                title={speech.listening ? 'עצור הקלטה' : 'הקלט במקום להקליד'}
              >
                <span className="mic-dot">🎤</span>
                {speech.transcribing
                  ? 'מתמלל…'
                  : speech.listening
                    ? 'מקליט… הקש/י לעצירה'
                    : 'הקלטה קולית'}
              </button>
            )}
          </label>
          <textarea
            placeholder="לדוגמה: חביתה מ-3 ביצים, פרוסת גאודה, מלפפון לא קלוף, חופן שרי"
            value={desc}
            onChange={(e) => {
              setDesc(e.target.value);
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
          {note.loading && 'מחשב מאקרו (פחמימות, שומן, חלבון)…'}
          {note.error}
          {note.carbs && (
            <>
              <strong>
                {note.carbs} ג' פחמימות נטו · {note.fat} ג' שומן · {note.protein} ג' חלבון
              </strong>
              {note.mp && (
                <span className="bd">
                  <br />
                  חלוקה קלורית: שומן {note.mp.fat}% · חלבון {note.mp.protein}% · פחמ' {note.mp.carb}% (~
                  {note.mp.kcal} קק"ל)
                </span>
              )}
              {note.items && note.items.length > 0 && (
                <ul className="calc-items">
                  {note.items.map((it, i) => (
                    <li key={i}>
                      <span className="ci-name">
                        {it.qty > 1 && <b className="ci-qty">{fmt(it.qty)}×</b>} {it.name}
                      </span>
                      <span className="ci-carb">{fmt((Number(it.carbs) || 0) * (it.qty || 1))} ג' פחמ'</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
        <button className="btn" disabled={busy} onClick={onAddClick}>
          {busy ? 'מחשב…' : 'חשב ורשום ארוחה'}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => runCalc(false)}>
          חשב פחמימות בלבד
        </button>
      </div>
    </div>
  );
}
