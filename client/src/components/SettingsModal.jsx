import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { useTheme } from '../lib/theme.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { todayISO } from '../lib/helpers.js';
import WeighIn from './WeighIn.jsx';
import './SettingsModal.scss';

// One place for all profile settings — gender (Hebrew address), daily net-carb
// target, keto-period goal, and the linked WhatsApp number — saved together with
// a single Save button. The weekly weigh-in lives here too (deliberately out of
// the main diary view), and saves immediately, independent of the Save button.
// Secondary actions (theme, guided tour, export) live below a divider. Opened
// from the gear button in the header.
export default function SettingsModal({
  open,
  onClose,
  onExport,
  onExportExcel,
  firstDate,
  days,
  onSaveWeight,
}) {
  const { user, updateProfile, startOnboarding } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();

  const [gender, setGender] = useState('');
  const [target, setTarget] = useState('20');
  const [loss, setLoss] = useState('2');
  const [height, setHeight] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [keto, setKeto] = useState('0');
  const [wa, setWa] = useState('');
  const [saving, setSaving] = useState(false);
  const [xFrom, setXFrom] = useState('');
  const [xTo, setXTo] = useState('');
  const [exporting, setExporting] = useState(false);

  // (Re)seed the form from the current profile whenever the modal opens. The
  // Excel range defaults to the whole log: first logged day → today.
  useEffect(() => {
    if (!open) return;
    setGender(user?.gender || '');
    setTarget(String(user?.dailyCarbTarget ?? 20));
    setLoss(String(user?.monthlyLossTarget ?? 2));
    setHeight(user?.heightCm ? String(user.heightCm) : '');
    setBirthYear(user?.birthYear ? String(user.birthYear) : '');
    setKeto(String(user?.ketoGoalMonths || 0));
    setWa(user?.whatsappPhone || '');
    setXFrom(firstDate || todayISO());
    setXTo(todayISO());
  }, [open, user, firstDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // the component only renders while open, so the trap is simply always active
  const trapRef = useFocusTrap(open);

  if (!open) return null;

  async function save() {
    const t = Number(target);
    if (!Number.isFinite(t) || t < 5 || t > 200) return toast('יעד יומי לא תקין (5–200 גרם)');
    const w = Number(loss);
    if (!Number.isFinite(w) || w < 0 || w > 10) return toast('יעד ירידה חודשי לא תקין (0–10 ק"ג)');
    const h = height === '' ? 0 : Number(height);
    if (!Number.isFinite(h) || (h !== 0 && (h < 100 || h > 250))) return toast('גובה לא תקין (100–250 ס"מ)');
    const nowYear = new Date().getFullYear();
    const by = birthYear === '' ? 0 : Number(birthYear);
    if (!Number.isInteger(by) || (by !== 0 && (by < nowYear - 120 || by > nowYear - 10)))
      return toast('שנת לידה לא תקינה');
    const m = Number(keto);
    if (!Number.isInteger(m) || m < 0 || m > 60) return toast('יעד קיטו לא תקין (0–60 חודשים)');
    const digits = wa.replace(/\D/g, '');
    if (digits && (digits.length < 8 || digits.length > 15)) return toast('מספר WhatsApp לא תקין');
    setSaving(true);
    try {
      await updateProfile({
        gender,
        dailyCarbTarget: t,
        monthlyLossTarget: w,
        heightCm: Math.round(h),
        birthYear: by,
        ketoGoalMonths: m,
        whatsappPhone: digits,
      });
      toast('ההגדרות נשמרו');
      onClose();
    } catch (e) {
      toast(e.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  }

  async function exportExcel() {
    if (xFrom && xTo && xFrom > xTo) return toast('טווח תאריכים לא תקין');
    setExporting(true);
    try {
      await onExportExcel?.(xFrom, xTo);
      toast('קובץ ה-Excel יוצא');
      onClose();
    } catch {
      toast('ייצוא ה-Excel נכשל');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="settings-scrim" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        ref={trapRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
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

        <label className="settings-field">
          <span className="settings-lab">יעד ירידה במשקל (ק"ג לחודש · 0 = שימור)</span>
          <input type="number" min="0" max="10" step="0.5" value={loss} onChange={(e) => setLoss(e.target.value)} />
        </label>
        <div className="export-hint">
          יעד הקלוריות היומי מחושב אוטומטית: השריפה שלך (לפי שקילות + ארוחות) פחות הגרעון
          שיעד הירידה דורש — אין צורך להזין אותו.
        </div>

        <label className="settings-field">
          <span className="settings-lab">גובה (ס"מ)</span>
          <input type="number" min="100" max="250" placeholder="למשל 172" value={height} onChange={(e) => setHeight(e.target.value)} />
        </label>

        <label className="settings-field">
          <span className="settings-lab">שנת לידה</span>
          <input type="number" min="1900" max="2020" placeholder="למשל 1980" value={birthYear} onChange={(e) => setBirthYear(e.target.value)} />
        </label>
        <div className="export-hint">
          גובה ושנת לידה (יחד עם המין והמשקל) משמשים להערכה ראשונית של שריפת הקלוריות —
          עד שיצטברו מספיק שקילות לחישוב מדויק מהנתונים שלך.
        </div>

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

        {onSaveWeight && (
          <>
            <div className="settings-divider" />
            <div className="settings-weigh">
              <div className="settings-lab">שקילה</div>
              <WeighIn days={days} today={todayISO()} onSave={onSaveWeight} />
              <div className="export-hint">
                אפשר לשקול בכל עת; מומלץ פעמיים בשבוע, באותו בוקר. נשמר מיידית על היום
                הנוכחי ומזין את חישוב שריפת הקלוריות בלשונית "תובנות".
              </div>
            </div>
          </>
        )}

        <div className="settings-divider" />

        <div className="settings-export">
          <div className="settings-lab">ייצוא היומן ל-Excel</div>
          <div className="export-range">
            <label>
              <span>מתאריך</span>
              <input type="date" value={xFrom} max={xTo || undefined} onChange={(e) => setXFrom(e.target.value)} />
            </label>
            <label>
              <span>עד תאריך</span>
              <input type="date" value={xTo} min={xFrom || undefined} onChange={(e) => setXTo(e.target.value)} />
            </label>
            <button className="btn ghost mini export-xlsx" onClick={exportExcel} disabled={exporting}>
              {exporting ? 'מייצא…' : '📊 ייצוא ל-Excel'}
            </button>
          </div>
          <div className="export-hint">ברירת המחדל: כל היומן — מהיום הראשון ועד היום (כולל).</div>
        </div>

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
