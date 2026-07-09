import { useMemo, useRef, useState } from 'react';
import { dayTotal, fmt, todayISO } from '../lib/helpers.js';
import { productLinkTemplate, mealLinkTemplate } from '../lib/appLink.js';
import { KETO_PROMPT_RULES } from '../lib/ketoPromptRules.js';
import { useToast } from '../lib/toast.jsx';
import './KetoCalc.scss';

// Open the user's Claude web chat with a prefilled prompt.
const CLAUDE_URL = 'https://claude.ai/new?q=';

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? '–' : fmt(Number(v)));

// "Day N in keto": calendar days from the earliest logged day to today (inclusive).
// Falls back to 1 when nothing is logged yet.
function ketoDayNumber(days) {
  if (!days.length) return 1;
  const earliest = days.reduce((min, d) => (d.date < min ? d.date : min), days[0].date);
  const [ey, em, ed] = earliest.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(ey, em - 1, ed);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Assemble the full prompt that gets URL-encoded into the Claude link.
// Only the summary metrics travel — no per-day journal detail. The keto
// calculation rules (trimmed from the server estimators' system prompt) ride
// along so the web chat computes net carbs the same way the app does. Claude
// is asked to reply with a ketolog deep link (see lib/appLink.js) followed by
// a readable breakdown of the values. `mode` chooses which link Claude
// returns: a new saved product, or a meal to write to the log.
function buildPrompt({ text, days, target, ketoMonths, avg, origin, mode }) {
  const context = [
    // claude.ai titles a chat from its first message; there's no URL param or
    // in-chat way to set it. Leading with "ketolog" as the headline biases the
    // auto-title toward it (best effort, not guaranteed).
    'ketolog',
    '',
    `תזונת קיטו. אלו פרטיה לגבי: יום מספר ${ketoDayNumber(days)} בקיטו`,
    '',
    ketoMonths ? `יעד קיטו: ${ketoMonths} חודשים` : null,
    `יעד פחמימות יומי (נטו): ${num(target)} גרם`,
    `ממוצע פחמימות נטו יומי עד כה: ${num(avg)} גרם`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const template = mode === 'meal' ? mealLinkTemplate(origin) : productLinkTemplate(origin);
  const encodeNote =
    mode === 'meal'
      ? 'ומקודד (URL-encode) את הטקסט בעברית שבשדה desc וגם את כל ערך items (שהוא JSON עם עברית):'
      : 'ומקודד (URL-encode) את הטקסט בעברית שבשדות name/desc/unit:';

  const mealExtra =
    mode === 'meal'
      ? [
          '',
          'ב-items פרק את הארוחה למרכיביה (פריט לכל מרכיב) עם הפחמימות נטו של כל פריט;',
          'ודא שסכום הפחמימות בפריטים שווה לערך carbs הכללי.',
        ]
      : [];

  const request = [
    'חשב לי מדדים: פחמימות נטו, חלבון, שומן (גם קק"ל)',
    'ל:',
    text.trim(),
    '',
    'החזר את התשובה בפורמט הבא, ללא הקדמות:',
    'שורה ראשונה — קישור אחד בלבד, בפורמט המדויק שלהלן, כשאתה ממלא את',
    `הערכים המחושבים ${encodeNote}`,
    '',
    template,
    ...mealExtra,
    '',
    'אחרי הקישור הוסף פירוט קצר וקריא: תיאור המוצר/הארוחה, הערכים שחישבת',
    '(פחמימות נטו, שומן, חלבון, קק"ל) והסבר קצר של החישוב.',
  ].join('\n');

  return `${context}\n\n${KETO_PROMPT_RULES}\n\n${request}`;
}

export default function KetoCalc({ days = [], target, ketoMonths = 0 }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false); // reveals the "if Claude asked you to log in" fallback
  const lastPrompt = useRef(''); // kept so the fallback can re-copy on demand

  // Average net carbs over past logged days only (matches the header / insights).
  const avg = useMemo(() => {
    const t = todayISO();
    const totals = days
      .filter((d) => d.date < t && (d.meals || []).length > 0)
      .map(dayTotal);
    return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
  }, [days]);

  // Copy text to the clipboard, tolerating older/locked-down browsers.
  async function copy(str) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch {
      return false;
    }
  }

  async function calc(mode) {
    const clean = text.trim();
    if (!clean) return;
    const prompt = buildPrompt({
      text: clean,
      days,
      target,
      ketoMonths,
      avg,
      origin: window.location.origin,
      mode,
    });
    lastPrompt.current = prompt;
    // Copy the prompt up front: if the user isn't logged into claude.ai, the new
    // tab lands on Claude's login page and the prefilled ?q= text can be dropped
    // in the redirect — so they can just paste it after signing in.
    const copied = await copy(prompt);
    window.open(CLAUDE_URL + encodeURIComponent(prompt), '_blank', 'noopener');
    setSent(true);
    toast(copied ? 'נפתח קלוד · הפרומפט הועתק ללוח' : 'נפתח קלוד בטאב חדש');
  }

  async function recopy() {
    const ok = await copy(lastPrompt.current);
    toast(ok ? 'הפרומפט הועתק ללוח' : 'ההעתקה נכשלה — סמנו והעתיקו ידנית');
  }

  return (
    <div className="ketocalc">
      <div className="kc-card">
        <h2 className="kc-title">חישוב מדדים עם קלוד</h2>
        <p className="kc-sub">
          כתבו פירוט ארוחה או מוצר, ובחרו כפתור. ייפתח צ׳אט קלוד עם המדדים שלכם, שיחשב פחמימות
          נטו, חלבון, שומן וקלוריות ויחזיר קישור יחד עם פירוט הערכים. לחיצה על הקישור תפתח את
          האפליקציה עם המוצר או הארוחה מוכנים — ותצטרכו רק לאשר.
        </p>

        <textarea
          className="kc-input"
          placeholder="לדוגמה: 2 ביצים מקושקשות בחמאה, חצי אבוקדו וקפה עם שמנת מתוקה"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
        />

        <div className="kc-btns">
          <button className="kc-btn" onClick={() => calc('product')} disabled={!text.trim()}>
            הוסף כמוצר ↗
          </button>
          <button className="kc-btn ghost" onClick={() => calc('meal')} disabled={!text.trim()}>
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
