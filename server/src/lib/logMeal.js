import Product from '../models/Product.js';
import Day from '../models/Day.js';
import { estimateMealCached } from './estimateCache.js';
import { captureItemsToCatalog } from './catalog.js';

// Sunday-indexed, matching JS getDay() / the Intl 'short' weekday order below.
const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// The server runs in UTC (Render), but the journal is a personal Israeli diary:
// a meal texted at 00:30 local time must land on the correct local day and carry
// the local clock time — never the UTC day/hour. Both are derived in the
// Asia/Jerusalem zone so WhatsApp logging matches what the in-app form records.
const IL_TZ = 'Asia/Jerusalem';

// Today's date in Israel as 'YYYY-MM-DD'. en-CA formats as ISO, so no reordering.
export function israelDateISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Current wall-clock time in Israel as 'HH:MM' (24h), matching the app's nowHM().
export function israelTimeHM() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

// Hebrew weekday name for an ISO date, computed in the Israel zone.
function weekday(iso) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: IL_TZ, weekday: 'short' }).format(
    new Date(iso + 'T12:00:00Z')
  );
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
  return HE_DAYS[idx] || '';
}

// Estimate a free-text meal and append it to the user's log for `date`, creating
// the day (with an auto label) if it doesn't exist yet. This is the exact path
// the in-app description box drives (estimate → POST /days/:date/meals), factored
// out so the WhatsApp webhook logs meals identically. Returns the AI estimate,
// the meal document as stored, and the updated day.
export async function logMealFromDesc({ userId, desc, date, time }) {
  const day0 = date || israelDateISO();
  const products = await Product.find({ user: userId }).lean();
  const { result } = await estimateMealCached(userId, desc, products);

  const meal = {
    time: time || israelTimeHM(),
    cat: '', // matches the in-app AddMeal form, which sends no category
    desc: desc.trim(),
    carbs: Number(result.net_carbs) || 0,
    fat: result.fat == null ? null : Number(result.fat),
    protein: result.protein == null ? null : Number(result.protein),
    items: Array.isArray(result.items) ? result.items : [],
  };

  const existing = await Day.findOne({ user: userId, date: day0 }).lean();
  const setOnInsert = { user: userId, date: day0 };
  if (!existing) {
    const count = await Day.countDocuments({ user: userId });
    setOnInsert.label = 'יום ' + (count + 1) + ' · ' + weekday(day0);
  }
  const day = await Day.findOneAndUpdate(
    { user: userId, date: day0 },
    { $push: { meals: meal }, $setOnInsert: setOnInsert },
    { new: true, upsert: true }
  );
  // Feed the global learned-product catalog (best-effort; never blocks the log).
  captureItemsToCatalog(meal.items, meal.desc, day0);

  return { result, meal, day, date: day0 };
}
