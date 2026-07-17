import { useMemo, useRef, useState } from "react";
import { openClaudeCalc, copyText, avgNetCarbs } from "../lib/claudeCalc.js";
import { useToast } from "../lib/toast.jsx";
import "./KetoCalc.scss";

export default function KetoCalc({ days = [], target, ketoMonths = 0, today }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false); // reveals the "if Claude asked you to log in" fallback
  const lastPrompt = useRef(""); // kept so the fallback can re-copy on demand

  // Average net carbs over past logged days only (matches the header / insights).
  const avg = useMemo(() => avgNetCarbs(days, today), [days, today]);

  async function calc(mode) {
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

  return (
    <div className="ketocalc">
      <div className="kc-card">
        <h2 className="kc-title">חישוב מדדים עם קלוד</h2>
        <p className="kc-sub">
          כתבו פירוט ארוחה או מוצר, ובחרו כפתור. ייפתח צ׳אט קלוד עם המדדים שלכם,
          שיחשב פחמימות נטו, חלבון, שומן וקלוריות ויחזיר קישור יחד עם פירוט
          הערכים. לחיצה על הקישור תפתח את האפליקציה עם המוצר או הארוחה מוכנים —
          ותצטרכו רק לאשר.
        </p>

        <textarea
          className="kc-input"
          placeholder="לדוגמה: 2 ביצים מקושקשות בחמאה, חצי אבוקדו וקפה עם שמנת מתוקה"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
        />

        <div className="kc-btns">
          <button
            className="kc-btn"
            onClick={() => calc("product")}
            disabled={!text.trim()}
          >
            הוסף כמוצר ↗
          </button>
          <button
            className="kc-btn ghost"
            onClick={() => calc("meal")}
            disabled={!text.trim()}
          >
            רשום כארוחה ליומן ↗
          </button>
        </div>

        {sent && (
          <div className="kc-hint" role="status">
            אם קלוד ביקש מכם להתחבר תחילה — אין בעיה: הפרומפט כבר הועתק ללוח.
            התחברו, הדביקו אותו בצ׳אט (Ctrl/⌘ + V) ושלחו.
            <button type="button" className="kc-link" onClick={recopy}>
              העתק שוב
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
