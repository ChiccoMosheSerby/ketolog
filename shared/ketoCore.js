// The keto nutrition core — the single source of truth for how net carbs are
// computed, shared verbatim by BOTH sides of the app:
//
//   server/src/lib/anthropic.js  → ketoRules(): system prompt for the in-app
//                                  estimators (meal / image / barcode)
//   client/src/lib/ketoPromptRules.js → the claude.ai redirect prompt (KetoCalc)
//
// Edit here and both flows stay in agreement. Keep it prompt-shaped (plain
// Hebrew instructions) and reasonably compact: the client embeds it in a
// claude.ai/new?q= URL where Hebrew inflates ~6× when percent-encoded.
//
// Deliberately NOT here: the server persona/task framing and each estimator's
// output format (server-side), and the deep-link reply format (client-side).
export const KETO_CORE_RULES =
  'בסס/י על ידע תזונתי מעמיק (כמו USDA ותוויות יצרן ישראליות), חשב/י לפי המרכיבים והכמויות בפועל, ושקלל/י את שיטת ההכנה. ' +
  'אם הכמות לא ברורה — הנח/י מנה בינונית סבירה, ועדיף לדייק בהיגיון מאשר להמציא דיוק מזויף. ' +
  'פחמימות נטו = סך הפחמימות, פחות סיבים תזונתיים (אינם הופכים לגלוקוז), פחות אריתריטול, אלולוז ומניטול (אינם מעלים סוכר בדם). ' +
  'ממתיקים סטיביה/טרוביה = 0 פחמימות. קסיליטול — ספור כ-60% מערכו; מלטיטול, סורביטול או כוהל סוכר אחר/לא מזוהה שמעלה סוכר חלקית — ספור כמחצית מערכו. ' +
  // Label conventions differ: Israel's nutrition-labeling regulations (2017,
  // like the EU's) define the label's "פחמימות" line as metabolizable carbs
  // including polyols and EXCLUDING fiber — so subtracting fiber again
  // double-deducts. Only US-style "Total Carbohydrates" folds fiber in.
  'שים לב לתווית: בתווית ישראלית או אירופית שורת "פחמימות" כבר אינה כוללת סיבים (אך כן כוללת רב-כוהליים) — אל תחסיר סיבים שוב, החסר רק רב-כוהליים לפי הכללים; ' +
  'בתווית אמריקאית Total Carbohydrates כולל סיבים — החסר אותם. ' +
  // Real Israeli labels are not always regulation-compliant: older labels
  // still print carbs WITH fiber inside. A mass-balance check catches it
  // (fat+protein+carbs+fiber can't exceed ~100g per 100g), as does comparing
  // against the known USDA composition of a similar food.
  'אבל אל תסמוך על אזור התווית בעיוורון — בדוק מאזן מסה: אם שומן+חלבון+פחמימות+סיבים עולים בבירור על 100 גרם ל-100 גרם, ' +
  'שורת הפחמימות בפועל כוללת את הסיבים והחסר אותם; והשווה להרכב הידוע של מזון דומה (USDA) לפני שאתה קובע. ' +
  'בשר/דג/ביצים = 0 פחמימות; שמן וחמאה = 0 פחמימות וגם 0 חלבון; גבינות קשות מיושנות ≈ 0 פחמימות; ' +
  'אם כמות לא צוינה, הנח מנה בינונית סבירה. ' +
  // Consistency + portion scaling: the same base food must always map to the same
  // per-unit reference, and size/fraction words scale it linearly — so "half" can
  // never come out larger than the "whole" of the same food.
  'עקביות מחייבת: לאותו מאכל בסיסי השתמש/י תמיד באותו ערך ייחוס קבוע ליחידה שלמה (למשל מלפפון בינוני, ביצה L), ' +
  'ללא תלות בארוחה או בניסוח. מילות כמות וגודל משנות את הערך באופן ליניארי מתוך אותו ערך בסיס: ' +
  '"חצי" = מחצית הערך, "רבע" = רבע, "שלם"/"שלמה" = יחידה מלאה, "גדול" / "קטן" ביחס למנה בינונית. ' +
  'לכן מנה חלקית של מאכל לעולם אינה יכולה להיות גדולה ממנה שלמה של אותו מאכל — בדוק/י זאת לפני התשובה.';
