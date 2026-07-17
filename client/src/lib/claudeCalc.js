// Shared "calc with Claude" flow: build the prefilled claude.ai prompt and
// open it in a new tab. Used by the חישוב מדדים tab (KetoCalc) and by the
// composer popups on the main tab — one prompt builder keeps the two entry
// points identical.
import { todayISO } from "./helpers.js";
import { productLinkTemplate, mealLinkTemplate } from "./appLink.js";
import { KETO_PROMPT_RULES } from "./ketoPromptRules.js";
import { fmt } from "./helpers.js";

// Open the user's Claude web chat with a prefilled prompt.
export const CLAUDE_URL = "https://claude.ai/new?q=";

const num = (v) =>
  v == null || v === "" || isNaN(Number(v)) ? "–" : fmt(Number(v));

// "Day N in keto": calendar days from the earliest logged day to today (inclusive).
// Falls back to 1 when nothing is logged yet.
export function ketoDayNumber(days) {
  if (!days.length) return 1;
  const earliest = days.reduce(
    (min, d) => (d.date < min ? d.date : min),
    days[0].date,
  );
  const [ey, em, ed] = earliest.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(ey, em - 1, ed);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Average net carbs over past logged days only (matches the header / insights).
// `today` is the effective today, so a manually closed day counts here too.
export function avgNetCarbs(days, today) {
  const t = today || todayISO();
  const totals = days
    .filter((d) => d.date < t && (d.meals || []).length > 0)
    .map((d) =>
      (d.meals || []).reduce((s, m) => s + (Number(m.carbs) || 0), 0),
    );
  return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
}

// Assemble the full prompt that gets URL-encoded into the Claude link.
// Only the summary metrics travel — no per-day journal detail. The keto
// calculation rules (trimmed from the server estimators' system prompt) ride
// along so the web chat computes net carbs the same way the app does. Claude
// is asked to reply with a ketolog deep link (see lib/appLink.js) followed by
// a readable breakdown of the values. `mode` chooses which link Claude
// returns: a new saved product, or a meal to write to the log.
export function buildPrompt({ text, days, target, ketoMonths, avg, origin, mode }) {
  const context = [
    // claude.ai titles a chat from its first message; there's no URL param or
    // in-chat way to set it. Leading with "ketolog" as the headline biases the
    // auto-title toward it (best effort, not guaranteed).
    "ketolog",
    "",
    `תזונת קיטו. אלו פרטיה לגבי: יום מספר ${ketoDayNumber(days)} בקיטו`,
    "",
    ketoMonths ? `יעד קיטו: ${ketoMonths} חודשים` : null,
    `יעד פחמימות יומי (נטו): ${num(target)} גרם`,
    `ממוצע פחמימות נטו יומי עד כה: ${num(avg)} גרם`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const template =
    mode === "meal" ? mealLinkTemplate(origin) : productLinkTemplate(origin);
  const encodeNote =
    mode === "meal"
      ? "ומקודד (URL-encode) את הטקסט בעברית שבשדה desc וגם את כל ערך items (שהוא JSON עם עברית):"
      : "ומקודד (URL-encode) את הטקסט בעברית שבשדות name/desc/unit:";

  const mealExtra =
    mode === "meal"
      ? [
          "",
          "ב-items פרק את הארוחה למרכיביה (פריט לכל מרכיב) עם פחמימות נטו, שומן וחלבון של כל פריט;",
          "לכל פריט תן name קצר וגם desc עם התיאור המלא (כמות, גודל, אופן הכנה).",
          "ודא שסכום כל מדד בפריטים (carbs, fat, protein) שווה לערך הכללי המתאים.",
        ]
      : [];

  const request = [
    'חשב לי מדדים: פחמימות נטו, חלבון, שומן (גם קק"ל)',
    "ל:",
    text.trim(),
    "",
    "החזר את התשובה בפורמט הבא, ללא הקדמות:",
    "שורה ראשונה — קישור אחד בלבד, בפורמט המדויק שלהלן, כשאתה ממלא את",
    `הערכים המחושבים ${encodeNote}`,
    "",
    template,
    ...mealExtra,
    "",
    "אחרי הקישור הוסף פירוט קצר וקריא: תיאור המוצר/הארוחה, הערכים שחישבת",
    '(פחמימות נטו, שומן, חלבון, קק"ל) והסבר קצר של החישוב.',
  ].join("\n");

  return `${context}\n\n${KETO_PROMPT_RULES}\n\n${request}`;
}

// Copy text to the clipboard, tolerating older/locked-down browsers.
export async function copyText(str) {
  try {
    await navigator.clipboard.writeText(str);
    return true;
  } catch {
    return false;
  }
}

// Build the prompt, copy it (login-redirect fallback) and open claude.ai.
// Returns { prompt, copied } so callers can toast + offer a re-copy.
export async function openClaudeCalc({ text, days, target, ketoMonths, avg, mode }) {
  const prompt = buildPrompt({
    text: text.trim(),
    days,
    target,
    ketoMonths,
    avg,
    origin: window.location.origin,
    mode,
  });
  // Copy the prompt up front: if the user isn't logged into claude.ai, the new
  // tab lands on Claude's login page and the prefilled ?q= text can be dropped
  // in the redirect — so they can just paste it after signing in.
  const copied = await copyText(prompt);
  window.open(CLAUDE_URL + encodeURIComponent(prompt), "_blank", "noopener");
  return { prompt, copied };
}
