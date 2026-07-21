import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openClaudeCalc, copyText } from "../lib/claudeCalc.js";
import { useToast } from "../lib/toast.jsx";
import { useFocusTrap } from "../lib/useFocusTrap.js";
import "./ClaudeCalcModal.scss";

// "Calc with Claude" popup, opened from the composer's 🤖 CTA. A meal/product
// toggle picks what Claude's reply link does:
// meal — the deep link prefills the meal form; product — it opens the
// add-product confirmation. Both open claude.ai in a new tab with the prompt
// prefilled.
export default function ClaudeCalcModal({
  initialMode = "meal",
  initialText = "",
  days,
  target,
  ketoMonths,
  avg,
  onClose,
}) {
  const toast = useToast();
  const [mode, setMode] = useState(initialMode);
  const [text, setText] = useState(initialText);
  const [sent, setSent] = useState(false);
  const lastPrompt = useRef("");
  const trapRef = useFocusTrap();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isMeal = mode === "meal";

  async function send() {
    const clean = text.trim();
    if (!clean) return;
    const { prompt, copied } = await openClaudeCalc({
      text: clean,
      days,
      target,
      ketoMonths,
      avg,
      mode,
    });
    lastPrompt.current = prompt;
    setSent(true);
    toast(copied ? "נפתח קלוד · הפרומפט הועתק ללוח" : "נפתח קלוד בטאב חדש");
  }

  async function recopy() {
    const ok = await copyText(lastPrompt.current);
    toast(ok ? "הפרומפט הועתק ללוח" : "ההעתקה נכשלה — סמנו והעתיקו ידנית");
  }

  // Portaled to <body>: on mobile the composer lives inside the Embla carousel,
  // whose transformed track would otherwise hijack position:fixed.
  return createPortal(
    <div className="ccm-scrim" onClick={onClose}>
      <div
        className="ccm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="חישוב עם קלוד"
        ref={trapRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ccm-head">
          <div className="ccm-htext">
            <span className="ccm-title">🤖 חישוב עם קלוד</span>
            <span className="ccm-sub">
              {isMeal
                ? "ייפתח צ׳אט קלוד שיחשב את המאקרו ויחזיר קישור — לחיצה עליו תמלא את טופס הארוחה כאן, ותצטרכו רק לאשר ולרשום."
                : "ייפתח צ׳אט קלוד שיחשב את הערכים ויחזיר קישור — לחיצה עליו תפתח אישור הוספת מוצר לרשימה שלכם."}
            </span>
          </div>
          <button className="ccm-close" title="סגירה" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="ccm-seg" role="tablist" aria-label="מה לחשב">
          <button
            type="button"
            role="tab"
            aria-selected={isMeal}
            className={"ccm-seg-btn" + (isMeal ? " on" : "")}
            onClick={() => setMode("meal")}
          >
            🍽️ ארוחה ליומן
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isMeal}
            className={"ccm-seg-btn" + (!isMeal ? " on" : "")}
            onClick={() => setMode("product")}
          >
            📦 מוצר חדש
          </button>
        </div>

        <textarea
          className="ccm-input"
          autoFocus
          rows={4}
          placeholder={
            isMeal
              ? "לדוגמה: 2 ביצים מקושקשות בחמאה, חצי אבוקדו וקפה עם שמנת מתוקה"
              : "לדוגמה: יוגורט יווני 5% של יופלה, גביע 150 גרם"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <div className="ccm-btns">
          <button className="btn" disabled={!text.trim()} onClick={send}>
            פתח בקלוד ↗
          </button>
          <button className="btn ghost" onClick={onClose}>
            סגירה
          </button>
        </div>

        {sent && (
          <div className="ccm-hint" role="status">
            אם קלוד ביקש מכם להתחבר תחילה — אין בעיה: הפרומפט כבר הועתק ללוח.
            התחברו, הדביקו אותו בצ׳אט (Ctrl/⌘ + V) ושלחו.
            <button type="button" className="ccm-link" onClick={recopy}>
              העתק שוב
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
