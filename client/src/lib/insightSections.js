// The sections of the "תובנות" tab (Dashboard), in their default order.
// Shared by the Dashboard (render order, drag-to-reorder, fold) and the
// settings modal (per-section show/hide checkboxes) so both stay in sync.
export const INSIGHT_SECTIONS = [
  { id: 'summary', title: 'ממוצע יומי ורצפים' },
  { id: 'ai', title: 'תובנות חכמות (AI)' },
  { id: 'keto', title: 'תקופת הקיטו' },
  { id: 'trend', title: 'התקדמות' },
  { id: 'kcal', title: 'קלוריות יומיות' },
  { id: 'energy', title: 'מאזן אנרגיה ושריפת קלוריות' },
  { id: 'macro', title: 'איזון מאקרו ממוצע' },
  { id: 'records', title: 'שיאים' },
  { id: 'hours', title: 'השעות העתירות בפחמימות' },
  { id: 'coffee', title: 'ממוצע קפה ליום' },
];

const KNOWN = new Set(INSIGHT_SECTIONS.map((s) => s.id));

// Saved order → a full, valid render order: keep the saved ids we still know,
// then append any sections the saved list doesn't mention (e.g. sections added
// after the user last reordered) in their default position.
export function normalizeInsightsOrder(saved) {
  const kept = (Array.isArray(saved) ? saved : []).filter((id) => KNOWN.has(id));
  const seen = new Set(kept);
  return [...kept, ...INSIGHT_SECTIONS.map((s) => s.id).filter((id) => !seen.has(id))];
}
