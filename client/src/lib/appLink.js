// Deep-link contract for "confirm this in the app" links.
//
// The keto-calc tab asks Claude to reply with a link in one of these shapes;
// when the user opens it, the app parses it on load and pops a confirmation
// dialog so nothing is saved without the user's approval. Both ends live here so
// the param names stay in sync.
//
//   product → {origin}/?add=product&name=…&desc=…&unit=…&carbs=…&fat=…&protein=…&kcal=…
//   meal    → {origin}/?add=meal&desc=…&carbs=…&fat=…&protein=…&kcal=…&items=<JSON>&date=…
//
// `date` is optional on a meal link (defaults to today). `items` is an optional
// URL-encoded JSON array of the per-ingredient breakdown
// ([{name, desc, carbs, fat, protein}]), which renders as the meal's itemized
// rows — `desc` is the item's fuller description, shown next to the short name
// the way catalog products show theirs. Per-item fat/protein matter: the journal
// derives each row's קק"ל from them (macroKcal), so carbs-only items render
// without calories. `kcal` is informational on both and is never persisted
// (neither model stores calories).

const ALL_PARAMS = [
  "add",
  "name",
  "desc",
  "unit",
  "cat",
  "date",
  "carbs",
  "fat",
  "protein",
  "kcal",
  "items",
];

// The product-link template we hand Claude — origin filled in, values as
// <placeholders>. `cat` is the category Claude picks out of the user's own
// list (sent alongside in the prompt); the confirm dialog shows it, editable.
export function productLinkTemplate(origin) {
  return (
    `${origin}/?add=product` +
    `&name=<שם קצר>` +
    `&desc=<פירוט מלא>` +
    `&unit=<יחידה, למשל מנה>` +
    `&cat=<קטגוריה מהרשימה>` +
    `&carbs=<פחמימות נטו>` +
    `&fat=<שומן>` +
    `&protein=<חלבון>` +
    `&kcal=<קלוריות>`
  );
}

// The meal-link template we hand Claude — leads to the main screen with the meal
// ready to write to the log on approval. `items` is a URL-encoded JSON array of
// the per-ingredient breakdown so the logged meal shows its itemized rows.
export function mealLinkTemplate(origin) {
  return (
    `${origin}/?add=meal` +
    `&desc=<פירוט הארוחה>` +
    `&carbs=<פחמימות נטו>` +
    `&fat=<שומן>` +
    `&protein=<חלבון>` +
    `&kcal=<קלוריות>` +
    `&items=<מערך JSON של הפריטים, לדוגמה [{"name":"חביתה","desc":"חביתה מ-3 ביצים בחמאה","carbs":1.2,"fat":21,"protein":19},{"name":"קפה שחור","desc":"קפה שחור ללא סוכר","carbs":0,"fat":0,"protein":0}]>`
  );
}

// Parse an app deep link out of a location.search string. Returns a draft tagged
// with its `type` ('product' | 'meal'), or null when the link isn't one of ours.
export function parseAppLink(search) {
  const q = new URLSearchParams(search || "");
  const type = q.get("add");
  if (type !== "product" && type !== "meal") return null;

  const numOrNull = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  };
  const str = (k) => (q.get(k) || "").trim();

  const common = {
    type,
    desc: str("desc"),
    carbs: numOrNull(q.get("carbs")),
    fat: numOrNull(q.get("fat")),
    protein: numOrNull(q.get("protein")),
    kcal: numOrNull(q.get("kcal")),
  };

  if (type === "product") {
    return { ...common, key: str("name"), unit: str("unit"), cat: str("cat") };
  }
  // meal — parse the optional per-ingredient breakdown (URL-decoded JSON array).
  return {
    ...common,
    cat: str("cat"),
    date: str("date"),
    items: parseItems(q.get("items")),
  };
}

// Parse the `items` param (a JSON array) into clean meal-item objects. Returns []
// on missing/invalid JSON, so a malformed link still logs a valid single meal.
function parseItems(raw) {
  if (!raw) return [];
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const numOr = (v, d) => {
    const n = Number(v);
    return v != null && v !== "" && !isNaN(n) ? n : d;
  };
  return arr
    .filter((it) => it && (it.name != null || it.carbs != null))
    .map((it) => ({
      name: String(it.name || "").trim(),
      desc: String(it.desc || "").trim(),
      qty: numOr(it.qty, 1) > 0 ? numOr(it.qty, 1) : 1,
      unit: String(it.unit || "").trim(),
      carbs: numOr(it.carbs, 0),
      fat: numOr(it.fat, null),
      protein: numOr(it.protein, null),
    }));
}

// Strip the deep-link params from the current URL without a reload, so a refresh
// (or the back button) doesn't re-open the confirmation dialog.
export function clearAppLink() {
  const url = new URL(window.location.href);
  ALL_PARAMS.forEach((k) => url.searchParams.delete(k));
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}
