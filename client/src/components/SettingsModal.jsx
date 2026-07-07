import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { useTheme } from '../lib/theme.js';
import './SettingsModal.scss';

// One place for all profile settings — gender (Hebrew address), daily net-carb
// target, keto-period goal, and the linked WhatsApp number — saved together with
// a single Save button. Secondary actions (theme, guided tour, export) live
// below a divider. Opened from the gear button in the header.
export default function SettingsModal({ open, onClose, onExport }) {
  const { user, updateProfile, startOnboarding } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();

  const [gender, setGender] = useState('');
  const [target, setTarget] = useState('20');
  const [keto, setKeto] = useState('0');
  const [wa, setWa] = useState('');
  const [saving, setSaving] = useState(false);

  // (Re)seed the form from the current profile whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setGender(user?.gender || '');
    setTarget(String(user?.dailyCarbTarget ?? 20));
    setKeto(String(user?.ketoGoalMonths || 0));
    setWa(user?.whatsappPhone || '');
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    const t = Number(target);
    if (!Number.isFinite(t) || t < 5 || t > 200) return toast('יעד יומי לא תקין (5–200 גרם)');
    const m = Number(keto);
    if (!Number.isInteger(m) || m < 0 || m > 60) return toast('יעד קיטו לא תקין (0–60 חודשים)');
    const digits = wa.replace(/\D/g, '');
    if (digits && (digits.length < 8 || digits.length > 15)) return toast('מספר WhatsApp לא תקין');
    setSaving(true);
    try {
      await updateProfile({ gender, dailyCarbTarget: t, ketoGoalMonths: m, whatsappPhone: digits });
      toast('ההגדרות נשמרו');
      onClose();
    } catch (e) {
      toast(e.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-scrim" onClick={onClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>הגדרות</h2>
          <button className="settings-close" aria-label="סגור" onClick={onClose}>✕</button>
        </div>

        <div className="settings-field">
          <span className="settings-lab">פנייה</span>
          <span className="settings-seg">
            <button className={gender === 'male' ? 'active' : ''} onClick={() => setGender('male')}>זכר</button>
            <button className={gender === 'female' ? 'active' : ''} onClick={() => setGender('female')}>נקבה</button>
          </span>
        </div>

        <label className="settings-field" data-tour="set-target">
          <span className="settings-lab">יעד יומי (גרם נטו)</span>
          <input type="number" min="5" max="200" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>

        <label className="settings-field" data-tour="set-keto">
          <span className="settings-lab">יעד קיטו (חודשים · 0 = ללא)</span>
          <input type="number" min="0" max="60" value={keto} onChange={(e) => setKeto(e.target.value)} />
        </label>

        <label className="settings-field" data-tour="set-wa">
          <span className="settings-lab">WhatsApp</span>
          <input type="tel" dir="ltr" placeholder="972501234567" value={wa} onChange={(e) => setWa(e.target.value)} />
        </label>

        <button className="settings-save" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמור'}
        </button>

        <div className="settings-divider" />

        <div className="settings-actions">
          <button className="btn ghost mini" onClick={toggle}>
            {theme === 'dark' ? '☀️ מצב בהיר' : '🌙 מצב כהה'}
          </button>
          <button className="btn ghost mini" onClick={() => { startOnboarding(); onClose(); }}>
            סיור מודרך
          </button>
          <button className="btn ghost mini" onClick={() => { onExport?.(); onClose(); }}>
            ייצוא דוח
          </button>
        </div>
      </div>
    </div>
  );
}
