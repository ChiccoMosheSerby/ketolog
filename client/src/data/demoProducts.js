// Quick-Add demo product DB — generated from the real log history of
// chiccomoshe@gmail.com (24 days, 189 meals, 27 saved products, 3 templates),
// then lightly curated: obvious spelling variants merged (שרי/עגבניות שרי,
// מלפפון/מלפפון בינוני…), macros are the median of the values actually logged.
// Each row: name, desc (description), unit, per-unit macros, type (UI group),
// uses (times it appeared in the log), hours (how many times it was logged in
// each daypart: [05–11, 11–17, 17–23, 23–05]) and typicalQty (the usual amount
// — first tap adds this many). Curate freely: remove, edit or keep each row.

export const PRODUCT_TYPES = [
  { id: 'coffee', label: 'קפה ושתייה', emoji: '☕' },
  { id: 'veg', label: 'ירקות', emoji: '🥒' },
  { id: 'eggs', label: 'ביצים וחביתות', emoji: '🍳' },
  { id: 'dairy', label: 'גבינות ושמנת', emoji: '🧀' },
  { id: 'meat', label: 'בשר, עוף ודגים', emoji: '🥩' },
  { id: 'nuts', label: 'אגוזים ולחם קיטו', emoji: '🌰' },
  { id: 'sweets', label: 'מתוקים וקינוחים', emoji: '🍫' },
  { id: 'extras', label: 'תוספות ותיבול', emoji: '🫒' },
];

export const DEMO_PRODUCTS = [
  // ---- קפה ושתייה ----
  { id: 'black-coffee-truvia', type: 'coffee', emoji: '☕', name: 'קפה שחור עם טרוביה', desc: 'קפה שחור עם ממתיק טרוביה — המשקה הנפוץ ביומן (22 פעמים)', unit: 'מנה', carbs: 0, fat: 0, protein: 0, uses: 22, hours: [11, 6, 4, 1] },
  { id: 'black-coffee-cream', type: 'coffee', emoji: '☕', name: 'קפה שחור, טרוביה וכף שמנת', desc: 'קפה שחור עם 1 טרוביה וכף שמנת מתוקה', unit: 'מנה', carbs: 0.6, fat: 5.5, protein: 0.5, uses: 3, hours: [0, 0, 2, 1] },
  { id: 'double-espresso-truvia', type: 'coffee', emoji: '☕', name: 'דאבל אספרסו עם טרוביה', desc: 'אספרסו כפול עם טרוביה, בלי חלב', unit: 'מנה', carbs: 0, fat: 0, protein: 0, uses: 10, hours: [0, 6, 4, 0] },
  { id: 'espresso-cream-truvia', type: 'coffee', emoji: '☕', name: 'אספרסו כפול + שמנת + טרוביה', desc: 'אספרסו כפול עם שמנת מתוקה 38% וטרוביה', unit: 'מנה', carbs: 0.8, fat: 11, protein: 1, uses: 1, hours: [0, 1, 0, 0] },
  { id: 'espresso-cream-tnuva', type: 'coffee', emoji: '☕', name: 'דאבל אספרסו עם שמנת תנובה 30%', desc: 'אספרסו עם כף שמנת תנובה 30% ("פחות טובה" לפי ההערה שלך)', unit: 'מנה', carbs: 1, fat: 4.8, protein: 0.3, uses: 2, hours: [0, 1, 1, 0] },
  { id: 'nescafe-cream', type: 'coffee', emoji: '☕', name: 'נס קפה עם כף שמנת', desc: 'נס קפה עם כף שמנת מתוקה', unit: 'מנה', carbs: 0.6, fat: 5.5, protein: 0.5, uses: 2, hours: [0, 1, 1, 0] },
  { id: 'nescafe-cream38-sweet', type: 'coffee', emoji: '☕', name: 'נס קפה עם שמנת 38% וסוויטנגו', desc: 'נס קפה עם שמנת 38% וממתיק סוויטנגו', unit: 'מנה', carbs: 0.9, fat: 11.4, protein: 0.6, uses: 1, hours: [0, 0, 1, 0] },
  { id: 'tiger-tea', type: 'coffee', emoji: '🍵', name: 'תה טיגריס', desc: 'תה בנגל ספייס (Bengal Spice) — שקיק, בלי תוספות', unit: 'כוס', carbs: 0.5, fat: 0, protein: 0, uses: 7, hours: [0, 0, 5, 2] },
  { id: 'tiger-tea-cream', type: 'coffee', emoji: '🍵', name: 'תה טיגריס + שמנת 38% + סוויטנגו', desc: 'תה בנגל ספייס עם כף שמנת 38% ו-1 סוויטנגו', unit: 'מנה', carbs: 0.9, fat: 5.5, protein: 0.5, uses: 3, hours: [0, 0, 2, 1] },
  { id: 'cola-zero', type: 'coffee', emoji: '🥤', name: 'קולה זירו', desc: 'פחית/כוס קולה זירו', unit: 'מנה', carbs: 0, fat: 0, protein: 0, uses: 1, hours: [0, 1, 0, 0] },

  // ---- ירקות ----
  { id: 'cherry-tomato', type: 'veg', emoji: '🍅', name: 'עגבניית שרי', desc: 'עגבניית שרי אחת — בד"כ נאכלות 5-6 בארוחת הבוקר', unit: 'יחידה', carbs: 0.5, fat: 0, protein: 0.1, uses: 19, hours: [12, 5, 2, 0], typicalQty: 5 },
  { id: 'cucumber', type: 'veg', emoji: '🥒', name: 'מלפפון בינוני', desc: 'מלפפון אחד בינוני (~150 גרם, לא קלוף)', unit: 'יחידה', carbs: 2.5, fat: 0, protein: 1, uses: 11, hours: [4, 4, 3, 0] },
  { id: 'pickle', type: 'veg', emoji: '🥒', name: 'מלפפון חמוץ', desc: 'מלפפון קטן בחומץ', unit: 'יחידה', carbs: 1, fat: 0, protein: 0.2, uses: 7, hours: [4, 1, 2, 0] },
  { id: 'lettuce-leaf', type: 'veg', emoji: '🥬', name: 'עלה חסה', desc: 'עלה חסה אחד — בד"כ 5-6 עלים בסלט', unit: 'עלה', carbs: 0.15, fat: 0, protein: 0.1, uses: 6, hours: [1, 3, 2, 0], typicalQty: 5 },
  { id: 'lettuce-handful', type: 'veg', emoji: '🥬', name: 'חופן חסה', desc: 'חופן עלי חסה קצוצים', unit: 'חופן', carbs: 1, fat: 0.2, protein: 0.8, uses: 5, hours: [1, 3, 1, 0] },
  { id: 'parsley', type: 'veg', emoji: '🌿', name: 'פטרוזיליה', desc: 'חופן פטרוזיליה טרייה', unit: 'חופן', carbs: 0.4, fat: 0, protein: 0.3, uses: 4, hours: [2, 2, 0, 0] },
  { id: 'lemon', type: 'veg', emoji: '🍋', name: 'חצי לימון', desc: 'חצי לימון סחוט (על סלט או עם ממתיק)', unit: 'יחידה', carbs: 1.3, fat: 0.1, protein: 0.3, uses: 6, hours: [0, 1, 5, 0] },
  { id: 'avocado-half', type: 'veg', emoji: '🥑', name: 'חצי אבוקדו', desc: 'חצי אבוקדו בינוני', unit: 'חצי', carbs: 1.5, fat: 11, protein: 1.3, uses: 5, hours: [1, 0, 4, 0] },
  { id: 'chard-leaf', type: 'veg', emoji: '🥬', name: 'עלה מנגולד', desc: 'עלה מנגולד טרי', unit: 'עלה', carbs: 0.3, fat: 0, protein: 0.3, uses: 1, hours: [1, 0, 0, 0], typicalQty: 4 },
  { id: 'olives', type: 'veg', emoji: '🫒', name: 'זית', desc: 'זית אחד — בד"כ כ-5 זיתים', unit: 'יחידה', carbs: 0.1, fat: 0.7, protein: 0.1, uses: 2, hours: [1, 1, 0, 0], typicalQty: 5 },
  { id: 'cabbage-butter', type: 'veg', emoji: '🥬', name: 'כרוב מוקפץ בחמאה', desc: 'חופן כרוב מוקפץ בחמאה', unit: 'מנה', carbs: 3, fat: 11, protein: 1, uses: 1, hours: [0, 1, 0, 0] },

  // ---- ביצים וחביתות ----
  { id: 'egg', type: 'eggs', emoji: '🥚', name: 'ביצה', desc: 'ביצה קשה/מבושלת — בד"כ 2', unit: 'ביצה', carbs: 0.4, fat: 5, protein: 6, uses: 6, hours: [5, 0, 1, 0], typicalQty: 2 },
  { id: 'omelet-1', type: 'eggs', emoji: '🍳', name: 'חביתה מביצה אחת', desc: 'חביתה מביצה אחת בשמן זית או חמאה', unit: 'מנה', carbs: 0.4, fat: 10, protein: 6, uses: 2, hours: [2, 0, 0, 0] },
  { id: 'omelet-2', type: 'eggs', emoji: '🍳', name: 'חביתה מ-2 ביצים', desc: 'חביתה מ-2 ביצים בשמן זית או חמאה', unit: 'מנה', carbs: 0.8, fat: 20, protein: 12, uses: 5, hours: [5, 0, 0, 0] },
  { id: 'omelet-3', type: 'eggs', emoji: '🍳', name: 'חביתה מ-3 ביצים', desc: 'חביתה מ-3 ביצים בשמן זית או חמאה', unit: 'מנה', carbs: 1.2, fat: 30, protein: 18, uses: 0, hours: [0, 0, 0, 0] },

  // ---- גבינות ושמנת ----
  { id: 'gush-halav-slice', type: 'dairy', emoji: '🧀', name: 'גוש חלב — פרוסה', desc: 'גוש חלב תנובה, פרוסת גבינה חצי קשה 28% (~25 גרם)', unit: 'פרוסה', carbs: 0, fat: 7, protein: 5.8, uses: 9, hours: [4, 3, 2, 0] },
  { id: 'gouda-slice', type: 'dairy', emoji: '🧀', name: 'פרוסת גאודה', desc: 'פרוסת גבינת גאודה', unit: 'פרוסה', carbs: 0.2, fat: 6, protein: 5, uses: 4, hours: [2, 1, 1, 0] },
  { id: 'camembert', type: 'dairy', emoji: '🧀', name: 'גבינת קממבר', desc: 'גבינת קממבר 33% — רבע גבינה', unit: 'רבע', carbs: 0.3, fat: 12, protein: 5.7, uses: 0, hours: [0, 0, 0, 0] },
  { id: 'cream-spoon', type: 'dairy', emoji: '🥛', name: 'כף שמנת מתוקה 38%', desc: 'כף שמנת מתוקה 38% (~15 מ"ל)', unit: 'כף', carbs: 0.4, fat: 5.5, protein: 0.3, uses: 2, hours: [0, 0, 2, 0] },
  { id: 'cream-cheese', type: 'dairy', emoji: '🧀', name: 'גבינת שמנת 30%', desc: 'כף גבינת שמנת 30% (רגילה או עם זיתים)', unit: 'כף', carbs: 0.5, fat: 5, protein: 1, uses: 2, hours: [1, 0, 1, 0] },
  { id: 'butter', type: 'dairy', emoji: '🧈', name: 'חמאה', desc: 'כף חמאה', unit: 'כף', carbs: 0, fat: 12, protein: 0, uses: 1, hours: [1, 0, 0, 0] },

  // ---- בשר, עוף ודגים ----
  { id: 'shawarma-salad-200', type: 'meat', emoji: '🥙', name: 'סלט שווארמה 200 ג\'', desc: 'בשר שווארמה 200 ג\' + כף שמן זית + כף טחינה + 6 עלי חסה', unit: 'מנה', carbs: 3.5, fat: 42, protein: 48, uses: 2, hours: [0, 2, 0, 0] },
  { id: 'shawarma-salad-150', type: 'meat', emoji: '🥙', name: 'סלט שווארמה 150 ג\'', desc: 'בשר שווארמה ~150 ג\' + כף שמן זית + כף טחינה + 6 עלי חסה', unit: 'מנה', carbs: 3.2, fat: 37, protein: 36.6, uses: 1, hours: [0, 1, 0, 0] },
  { id: 'shawarma', type: 'meat', emoji: '🥙', name: 'שווארמה', desc: 'מנת בשר שווארמה (~200 גרם, בלי תוספות)', unit: 'מנה', carbs: 2, fat: 25, protein: 30, uses: 4, hours: [0, 4, 0, 0] },
  { id: 'sausage', type: 'meat', emoji: '🌭', name: 'נקניקיית בקר', desc: 'נקניקיית בקר אורגני טחון מתובל (גרס-פד)', unit: 'נקניקיה', carbs: 0, fat: 7, protein: 5, uses: 5, hours: [0, 5, 0, 0] },
  { id: 'chicken-thigh', type: 'meat', emoji: '🍗', name: 'כרע עוף', desc: 'כרע עוף (עם העור) — בד"כ 2', unit: 'כרע', carbs: 0, fat: 18, protein: 28, uses: 2, hours: [0, 2, 0, 0], typicalQty: 2 },
  { id: 'chicken-drumstick', type: 'meat', emoji: '🍗', name: 'שוק עוף', desc: 'שוק עוף', unit: 'שוק', carbs: 0, fat: 7.5, protein: 13, uses: 2, hours: [0, 2, 0, 0], typicalQty: 2 },
  { id: 'chicken-skewer', type: 'meat', emoji: '🍢', name: 'שיפוד פרגית', desc: 'שיפוד פרגית', unit: 'שיפוד', carbs: 0, fat: 10, protein: 22, uses: 1, hours: [0, 0, 1, 0] },
  { id: 'minute-steak', type: 'meat', emoji: '🥩', name: 'מינוט סטייק (100 גרם)', desc: 'מינוט סטייק — כל יחידה 100 גרם, בד"כ 300 גרם', unit: '100 גרם', carbs: 0, fat: 8, protein: 27, uses: 1, hours: [0, 1, 0, 0], typicalQty: 3 },
  { id: 'sirloin-300', type: 'meat', emoji: '🥩', name: 'סינטה 300 גרם', desc: 'מנת סינטה 300 גרם', unit: 'מנה', carbs: 0, fat: 36, protein: 81, uses: 1, hours: [0, 1, 0, 0] },
  { id: 'tuna', type: 'meat', emoji: '🐟', name: 'טונה במים', desc: 'טונה בהירה במים (Starkist) — 100 גרם', unit: '100 גרם', carbs: 0, fat: 0.6, protein: 24.8, uses: 2, hours: [1, 0, 1, 0] },
  { id: 'salami-slice', type: 'meat', emoji: '🥓', name: 'פרוסת סלמי', desc: 'פרוסת סלמי — בד"כ כ-5 פרוסות', unit: 'פרוסה', carbs: 0.3, fat: 3.5, protein: 3.5, uses: 2, hours: [0, 0, 1, 1], typicalQty: 5 },
  { id: 'pastrami-slice', type: 'meat', emoji: '🥓', name: 'פרוסת פסטרמה', desc: 'פרוסת פסטרמה — בד"כ כ-3 פרוסות', unit: 'פרוסה', carbs: 0.3, fat: 1, protein: 4.5, uses: 2, hours: [0, 0, 1, 1], typicalQty: 3 },
  { id: 'meatballs', type: 'meat', emoji: '🍖', name: 'ארוחת קציצות בשר טחון', desc: 'ארוחה: קציצות מבשר טחון (מהתבנית השמורה שלך)', unit: 'מנה', carbs: 7.5, fat: 70, protein: 5, uses: 1, hours: [0, 1, 0, 0] },

  // ---- אגוזים ולחם קיטו ----
  { id: 'pecans', type: 'nuts', emoji: '🌰', name: 'חופן פקאן', desc: 'חופן אגוזי פקאן — הנשנוש הקבוע של הערב', unit: 'חופן', carbs: 1.5, fat: 20, protein: 2.5, uses: 9, hours: [0, 1, 8, 0] },
  { id: 'walnuts', type: 'nuts', emoji: '🌰', name: 'חופן אגוזי מלך', desc: 'חופן אגוזי מלך', unit: 'חופן', carbs: 2, fat: 18, protein: 4, uses: 2, hours: [0, 0, 1, 1] },
  { id: 'almond-butter', type: 'nuts', emoji: '🥜', name: 'שקדיה (חמאת שקדים)', desc: 'חמאת שקדים טבעית "שקד תבור" — כפית', unit: 'כפית', carbs: 0.46, fat: 2.7, protein: 1.1, uses: 0, hours: [0, 0, 0, 0] },
  { id: 'keto-bread', type: 'nuts', emoji: '🍞', name: 'פרוסת לחם קיטו', desc: 'לחם קיטו ביתי מקמח שקדים — פרוסה', unit: 'פרוסה', carbs: 1.5, fat: 19, protein: 5.5, uses: 4, hours: [0, 0, 4, 0] },

  // ---- מתוקים וקינוחים ----
  { id: 'gumo-cube', type: 'sweets', emoji: '🍫', name: 'קוביית שוקולד גומו', desc: 'קוביית שוקולד ג\'ומו (ללא סוכר)', unit: 'קוביה', carbs: 0.25, fat: 3.5, protein: 0.75, uses: 9, hours: [0, 3, 6, 0] },
  { id: 'choc-cube', type: 'sweets', emoji: '🍫', name: 'קוביית שוקולד', desc: 'קוביית שוקולד מריר — בד"כ 2 קוביות', unit: 'קוביה', carbs: 0.65, fat: 4, protein: 0.85, uses: 7, hours: [0, 2, 3, 2], typicalQty: 2 },
  { id: 'gumo-row', type: 'sweets', emoji: '🍫', name: 'שורת שוקולד גומו', desc: 'שורה משוקולד ג\'ומו', unit: 'שורה', carbs: 0.1, fat: 3.6, protein: 0.8, uses: 3, hours: [0, 2, 0, 1] },
  { id: 'icecream-cocoa-blueberry', type: 'sweets', emoji: '🍨', name: 'גלידת שמנת קקאו ואוכמניות', desc: 'גלידת שמנת ביתית עם קקאו ואוכמניות — מנה', unit: 'מנה', carbs: 3.3, fat: 24, protein: 1.4, uses: 4, hours: [0, 1, 2, 1] },
  { id: 'icecream-blueberry', type: 'sweets', emoji: '🍨', name: 'גלידת שמנת אוכמניות', desc: 'גלידת שמנת אוכמניות — מנה אישית', unit: 'מנה', carbs: 4.3, fat: 32, protein: 1.8, uses: 3, hours: [0, 2, 1, 0] },

  // ---- תוספות ותיבול ----
  { id: 'olive-oil', type: 'extras', emoji: '🫒', name: 'שמן זית', desc: 'כף שמן זית', unit: 'כף', carbs: 0, fat: 14, protein: 0, uses: 4, hours: [0, 3, 1, 0] },
  { id: 'tahini', type: 'extras', emoji: '🥣', name: 'טחינה', desc: 'כף טחינה גולמית', unit: 'כף', carbs: 1.5, fat: 8, protein: 2.5, uses: 5, hours: [0, 4, 1, 0] },
  { id: 'truvia', type: 'extras', emoji: '🍬', name: 'טרוביה', desc: 'ממתיק טרוביה — מנה/טבליה', unit: 'יחידה', carbs: 0, fat: 0, protein: 0, uses: 1, hours: [0, 0, 1, 0] },
  { id: 'sweetango', type: 'extras', emoji: '🍬', name: 'סוויטנגו', desc: 'ממתיק סוויטנגו — טבליה', unit: 'טבליה', carbs: 0, fat: 0, protein: 0, uses: 7, hours: [0, 0, 7, 0] },
  { id: 'cocoa', type: 'extras', emoji: '🍫', name: 'קקאו ללא סוכר', desc: 'כפית אבקת קקאו ללא סוכר', unit: 'כפית', carbs: 0.4, fat: 0.3, protein: 0.4, uses: 1, hours: [0, 0, 1, 0] },
];

// Recurring meal combinations found in the log — the "returning templates"
// behind the autocomplete: one tap fills the cart with the whole combination.
export const MEAL_COMBOS = [
  {
    id: 'two-choc-cubes',
    name: '2 קוביות שוקולד',
    desc: 'הנשנוש החוזר — נרשם 8 פעמים',
    uses: 8,
    hours: [1, 4, 2, 1],
    items: [{ id: 'choc-cube', qty: 2 }],
  },
  {
    id: 'choc-pecan',
    name: 'שוקולד גומו + חופן פקאן',
    desc: 'שילוב הערב הקבוע — קוביית גומו עם חופן פקאן',
    uses: 3,
    hours: [0, 1, 2, 0],
    items: [
      { id: 'gumo-cube', qty: 1 },
      { id: 'pecans', qty: 1 },
    ],
  },
  {
    id: 'lemon-sweetango',
    name: 'חצי לימון עם סוויטנגו',
    desc: 'חצי לימון סחוט עם טבליית סוויטנגו',
    uses: 2,
    hours: [0, 0, 2, 0],
    items: [
      { id: 'lemon', qty: 1 },
      { id: 'sweetango', qty: 1 },
    ],
  },
  {
    id: 'minute-steak-salad',
    name: 'מינוט סטייק 300 ג\' + סלט ירוק',
    desc: 'מינוט סטייק 300 ג\', 4 עלי חסה, כף שמן זית, מעט לימון וחופן פטרוזיליה',
    uses: 1,
    hours: [0, 1, 0, 0],
    items: [
      { id: 'minute-steak', qty: 3 },
      { id: 'lettuce-leaf', qty: 4 },
      { id: 'olive-oil', qty: 1 },
      { id: 'lemon', qty: 1 },
      { id: 'parsley', qty: 1 },
    ],
  },
];

// Daypart index into a product's `hours` histogram: [05–11, 11–17, 17–23, 23–05].
export function daypartIndex(hour) {
  if (hour >= 5 && hour < 11) return 0;
  if (hour >= 11 && hour < 17) return 1;
  if (hour >= 17 && hour < 23) return 2;
  return 3;
}

// Data-driven cold-start suggestions: the products this user actually logged
// most in the current daypart (before the live localStorage patterns kick in).
export function historicalSuggestions(hour, limit = 4) {
  const di = daypartIndex(hour);
  return [...DEMO_PRODUCTS]
    .filter((p) => p.hours[di] > 0)
    .sort((a, b) => b.hours[di] - a.hours[di] || b.uses - a.uses)
    .slice(0, limit)
    .map((p) => p.id);
}
