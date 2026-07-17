// The user's product-category catalog. Each product carries its own `cat` in
// the DB (synced across devices); this module only manages the *list of
// choices* offered when adding/moving a product — defaults + names the user
// added on this device (localStorage) + whatever cats existing products use.

const KEY = "ketolog:categories";

export const DEFAULT_CAT = "נשנוש / ביניים";
export const DEFAULT_CATS = [
  "ארוחת בוקר",
  "ארוחת צהריים",
  "ארוחת ערב",
  DEFAULT_CAT,
  "משקאות",
];

function stored() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Full list of category choices: defaults first, then custom (stored + in-use),
// deduped, custom sorted alphabetically after the defaults.
export function loadCats(products = []) {
  const custom = new Set(stored());
  for (const p of products) {
    const c = (p.cat || "").trim();
    if (c && !DEFAULT_CATS.includes(c)) custom.add(c);
  }
  return [...DEFAULT_CATS, ...[...custom].sort((a, b) => a.localeCompare(b, "he"))];
}

export function addCat(name) {
  const n = String(name || "").trim();
  if (!n || DEFAULT_CATS.includes(n)) return n;
  const list = stored();
  if (!list.includes(n)) localStorage.setItem(KEY, JSON.stringify([...list, n]));
  return n;
}

// Forget a custom category name. (Products that still use it should be moved
// to another category by the caller — the name reappears otherwise, since
// in-use cats are always offered.)
export function removeCat(name) {
  const n = String(name || "").trim();
  localStorage.setItem(KEY, JSON.stringify(stored().filter((c) => c !== n)));
}
