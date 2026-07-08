import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { parseAppLink, clearAppLink } from '../lib/appLink.js';
import './AppLinkConfirm.scss';

// When the app is opened via a Claude-generated PRODUCT deep link
// (?add=product&…), this pops a pre-filled, editable confirmation dialog.
// Nothing is saved until the user approves. Mounted once at the app root.
// Meal links (?add=meal) are handled by the AddMeal form instead, so they land
// on the existing meal-entry form (see AddMeal.jsx).
export default function AppLinkConfirm() {
  const toast = useToast();
  const [draft, setDraft] = useState(null); // null = no pending product link
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // Read the link once on mount, then strip it from the URL so a refresh or the
  // back button doesn't re-trigger the dialog.
  useEffect(() => {
    const d = parseAppLink(window.location.search);
    if (!d || d.type !== 'product') return; // meal links → AddMeal form
    setDraft(d);
    setForm({
      key: d.key || '',
      desc: d.desc || '',
      unit: d.unit || 'מנה',
      carb: d.carbs != null ? String(d.carbs) : '',
      fat: d.fat != null ? String(d.fat) : '',
      prot: d.protein != null ? String(d.protein) : '',
    });
    clearAppLink();
  }, []);

  useEffect(() => {
    if (!draft) return;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft || !form) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const close = () => setDraft(null);

  async function save() {
    if (!form.key.trim()) return toast('תנו שם למוצר');
    setSaving(true);
    try {
      await api.addProduct({
        key: form.key.trim(),
        label: form.desc.trim() || form.key.trim(),
        unit: form.unit.trim() || 'מנה',
        carbs: Number(form.carb) || 0,
        fat: Number(form.fat) || 0,
        protein: Number(form.prot) || 0,
      });
      // Diary listens for this and reloads its products list.
      window.dispatchEvent(new Event('ketolog:dataChanged'));
      toast('המוצר נוסף לרשימה שלך');
      close();
    } catch (e) {
      toast(e.message || 'ההוספה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="plc-scrim" onClick={close}>
      <div className="plc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plc-head">
          <h2>הוספת מוצר מקלוד</h2>
          <button className="plc-close" aria-label="סגור" onClick={close}>
            ✕
          </button>
        </div>
        <p className="plc-sub">
          קלוד חישב את הערכים הבאים. אפשר לערוך לפני השמירה — המוצר יתווסף רק אחרי אישור.
        </p>

        <div className="plc-field">
          <label>שם / כינוי</label>
          <input value={form.key} onChange={set('key')} placeholder="שם קצר" autoFocus />
        </div>
        <div className="plc-field">
          <label>תיאור מלא</label>
          <input value={form.desc} onChange={set('desc')} placeholder="פירוט" />
        </div>
        <div className="plc-field">
          <label>יחידה</label>
          <input value={form.unit} onChange={set('unit')} placeholder="מנה" />
        </div>

        <div className="plc-macros">
          <div className="plc-field">
            <label>פחמ' נטו</label>
            <input type="number" step="0.1" value={form.carb} onChange={set('carb')} />
          </div>
          <div className="plc-field">
            <label>שומן</label>
            <input type="number" step="0.1" value={form.fat} onChange={set('fat')} />
          </div>
          <div className="plc-field">
            <label>חלבון</label>
            <input type="number" step="0.1" value={form.prot} onChange={set('prot')} />
          </div>
        </div>

        {draft.kcal != null && (
          <div className="plc-kcal">≈ {draft.kcal} קק"ל (לא נשמר, לעיונכם)</div>
        )}

        <div className="plc-btns">
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? 'שומר…' : 'אשר והוסף מוצר'}
          </button>
          <button className="btn ghost" onClick={close} disabled={saving}>
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
