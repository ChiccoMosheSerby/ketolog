// Open Food Facts lookup: barcode -> raw product + nutriments (per 100g).
// OFF is a real crowd-sourced database (free, no API key). A barcode is just a
// number (EAN/UPC), so the database does the data lookup; Claude later turns the
// raw numbers into keto "net carbs". See lib/anthropic.js -> interpretBarcode.

const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';

// Ask only for the fields we use — keeps the response small.
const FIELDS = [
  'product_name',
  'product_name_he',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'nutriments',
].join(',');

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

// Fetch a product by barcode. Returns a normalized object, or null when the
// barcode is not in the database (the caller treats that as "not found").
// Throws on network / unexpected HTTP errors so the route can log + degrade.
export async function fetchProductByBarcode(barcode) {
  const code = String(barcode || '').replace(/\D/g, '');
  if (!code) return null;

  const url = `${OFF_URL}/${code}.json?fields=${FIELDS}`;
  let res;
  try {
    res = await fetch(url, {
      // OFF asks every client to identify itself with a User-Agent.
      headers: { 'User-Agent': 'KetoLog/1.0 (keto diary; contact: app)' },
    });
  } catch (err) {
    throw new Error('off-network: ' + err.message);
  }

  if (res.status === 404) return null;
  if (!res.ok) throw new Error('off-status: ' + res.status);

  const data = await res.json().catch(() => null);
  if (!data || data.status === 0 || !data.product) return null;

  const p = data.product;
  const n = p.nutriments || {};

  return {
    barcode: code,
    name: p.product_name_he || p.product_name || '',
    brands: p.brands || '',
    quantity: p.quantity || '',
    servingSize: p.serving_size || '',
    servingQuantity: num(p.serving_quantity),
    per100: {
      carbs: num(n.carbohydrates_100g),
      fiber: num(n.fiber_100g),
      sugars: num(n.sugars_100g),
      // sugar alcohols (erythritol/maltitol/etc.) — often absent
      polyols: num(n['polyols_100g']),
      erythritol: num(n['erythritol_100g']),
      fat: num(n.fat_100g),
      protein: num(n.proteins_100g),
      energyKcal: num(n['energy-kcal_100g']),
    },
  };
}

// Degraded keto net-carb estimate (used only when no AI key is configured):
// net = carbs - fiber - polyols, per 100g. Coarser than the Claude path because
// it can't distinguish erythritol (0) from maltitol (half), and assumes fiber=0
// when missing. Returns null fields when the base data is unavailable.
export function rawKeto(off) {
  const { carbs, fiber, polyols, fat, protein } = off.per100;
  const net =
    carbs == null ? null : Math.max(0, carbs - (fiber || 0) - (polyols || 0));
  return { net_carbs: net, fat, protein };
}
