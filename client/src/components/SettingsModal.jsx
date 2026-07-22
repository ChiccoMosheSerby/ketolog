import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { useTheme } from '../lib/theme.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { todayISO } from '../lib/helpers.js';
import { CHAT_HIDDEN_KEY, isChatHidden } from './ChatWidget.jsx';
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
  const { user, updateProfile, startOnboarding, refreshUser } = useAuth();
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

  // ---- AI features (bring-your-own Anthropic key / owner preview toggle) ----
  const ai = user?.ai || {};
  const [aiKey, setAiKey] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  // own-key spend: fetched when the modal opens, compared to the monthly budget
  const [aiUsage, setAiUsage] = useState(null); // { monthUsd, totalUsd, ... }
  const [budget, setBudget] = useState('');

  useEffect(() => {
    if (!open) return;
    setBudget(user?.ai?.monthlyBudgetUsd ? String(user.ai.monthlyBudgetUsd) : '');
    if (!user?.ai?.hasOwnKey) return;
    api.getMyAiUsage().then(setAiUsage).catch(() => {});
  }, [open, user]);

  async function saveBudget() {
    const usd = budget === '' ? 0 : Number(budget);
    if (!Number.isFinite(usd) || usd < 0 || usd > 10000) return toast('תקציב לא תקין (0–10,000 $)');
    setAiBusy(true);
    try {
      await api.setAiBudget(usd);
      await refreshUser();
      toast(usd ? 'התקציב החודשי נשמר' : 'התקציב הוסר');
    } catch (e) {
      toast(e.message || 'שמירת התקציב נכשלה');
    } finally {
      setAiBusy(false);
    }
  }

  // budget pressure: >= 80% amber warning, >= 100% red
  const budgetUsd = user?.ai?.monthlyBudgetUsd || 0;
  const monthUsd = aiUsage?.monthUsd || 0;
  const budgetRatio = budgetUsd > 0 ? monthUsd / budgetUsd : 0;

  // ---- keto chat bubble: hide from the main screen, open from here instead --
  const [hideChat, setHideChat] = useState(isChatHidden);
  useEffect(() => {
    if (open) setHideChat(isChatHidden());
  }, [open]);

  function toggleHideChat() {
    const next = !hideChat;
    try {
      if (next) localStorage.setItem(CHAT_HIDDEN_KEY, '1');
      else localStorage.removeItem(CHAT_HIDDEN_KEY);
    } catch {
      /* storage unavailable — the widget just keeps its current state */
    }
    setHideChat(next);
    window.dispatchEvent(new Event('ketolog:chatHiddenChanged'));
    toast(next ? 'בועת הצ׳אט הוסתרה — הצ׳אט זמין מכאן' : 'בועת הצ׳אט חזרה למסך');
  }

  function openChat() {
    window.dispatchEvent(new Event('ketolog:openChat'));
    onClose();
  }

  // ---- danger zone: reset the journal and start over from day 1 -------------
  // Guarded by a typed confirmation ("reset <email>") — checked here to enable
  // the button, and re-validated server-side before anything is deleted.
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [resetting, setResetting] = useState(false);
  const resetPhrase = `reset ${user?.email || ''}`;
  const resetMatch = resetText.trim().toLowerCase() === resetPhrase.toLowerCase();

  async function doReset() {
    if (!resetMatch || resetting) return;
    setResetting(true);
    try {
      await api.resetAccount(resetText.trim());
      toast('היומן אופס — מתחילים מחדש מיום 1');
      // full reload: day list, insights cache, badges — everything restarts clean
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast(e.message || 'האיפוס נכשל');
      setResetting(false);
    }
  }

  async function saveAiKey() {
    const k = aiKey.trim();
    if (!k) return toast('הדביקו מפתח API של Anthropic');
    setAiBusy(true);
    try {
      // the server validates the key with a real (minimal) call before saving,
      // so a bad key or an empty-credit account is caught right here
      await api.saveAiKey(k);
      await refreshUser();
      setAiKey('');
      toast('המפתח אומת ונשמר — תכונות ה-AI הופעלו 🎉');
    } catch (e) {
      toast(e.message || 'שמירת המפתח נכשלה');
    } finally {
      setAiBusy(false);
    }
  }

  async function removeAiKey() {
    setAiBusy(true);
    try {
      await api.deleteAiKey();
      await refreshUser();
      toast('המפתח הוסר — תכונות ה-AI כבויות');
    } catch (e) {
      toast(e.message || 'ההסרה נכשלה');
    } finally {
      setAiBusy(false);
    }
  }

  // Owner-only: preview the app with all AI features off.
  async function toggleAi() {
    setAiBusy(true);
    try {
      await api.setAiOptOut(!ai.optOut);
      await refreshUser();
      toast(ai.optOut ? 'תכונות ה-AI הופעלו מחדש' : 'תכונות ה-AI כובו (תצוגה מקדימה)');
    } catch (e) {
      toast(e.message || 'הפעולה נכשלה');
    } finally {
      setAiBusy(false);
    }
  }

  // (Re)seed the form from the current profile whenever the modal opens. The
  // Excel range defaults to the whole log: first logged day → today.
  useEffect(() => {
    if (!open) return;
    setResetOpen(false);
    setResetText('');
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
    // WhatsApp service disabled — the field is hidden and the number isn't
    // sent (existing linked numbers stay stored on the user doc, untouched).
    // const digits = wa.replace(/\D/g, '');
    // if (digits && (digits.length < 8 || digits.length > 15)) return toast('מספר WhatsApp לא תקין');
    setSaving(true);
    try {
      await updateProfile({
        gender,
        dailyCarbTarget: t,
        monthlyLossTarget: w,
        heightCm: Math.round(h),
        birthYear: by,
        ketoGoalMonths: m,
        // whatsappPhone: digits,
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

        <div className="settings-group" data-tour="set-loss">
          <label className="settings-field">
            <span className="settings-lab">יעד ירידה במשקל (ק"ג לחודש · 0 = שימור)</span>
            <input type="number" min="0" max="10" step="0.5" value={loss} onChange={(e) => setLoss(e.target.value)} />
          </label>
          <div className="export-hint">
            יעד הקלוריות היומי מחושב אוטומטית: השריפה שלך (לפי שקילות + ארוחות) פחות הגרעון
            שיעד הירידה דורש — אין צורך להזין אותו.
          </div>
        </div>

        <div className="settings-group" data-tour="set-body">
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
        </div>

        <label className="settings-field" data-tour="set-keto">
          <span className="settings-lab">יעד קיטו (חודשים · 0 = ללא)</span>
          <input type="number" min="0" max="60" value={keto} onChange={(e) => setKeto(e.target.value)} />
        </label>

        {/* WhatsApp service disabled for all users — kept for a possible return.
        <label className="settings-field" data-tour="set-wa">
          <span className="settings-lab">WhatsApp</span>
          <input type="tel" dir="ltr" placeholder="972501234567" value={wa} onChange={(e) => setWa(e.target.value)} />
        </label>
        */}

        <button className="settings-save" onClick={save} disabled={saving}>
          {saving ? 'שומר…' : 'שמור'}
        </button>

        <div className="settings-divider" />

        {/* AI features: status + BYO Anthropic key (or the owner's preview toggle) */}
        <div className="settings-ai" data-tour="set-ai">
          <div className="settings-lab">
            תכונות AI{' '}
            <span style={{ fontWeight: 400 }}>
              {ai.enabled
                ? ai.source === 'env'
                  ? '· 🟢 פעילות (מפתח האפליקציה)'
                  : '· 🟢 פעילות (המפתח שלך)'
                : ai.optOut
                  ? '· ⚪ כבויות (לבחירתך)'
                  : '· ⚪ כבויות — אין מפתח API'}
            </span>
          </div>

          {ai.keyError && (
            <div className="export-hint" style={{ color: '#dc2626' }} role="alert">
              {ai.keyError === 'no_credit'
                ? '⚠️ נגמר הקרדיט במפתח ה-API שלך — תכונות ה-AI לא יפעלו עד שיתווסף קרדיט בחשבון Anthropic (console.anthropic.com).'
                : '⚠️ מפתח ה-API אינו תקין או בוטל — הדביקו מפתח חדש כאן.'}
            </div>
          )}

          {ai.canToggle ? (
            /* the owner rides on the app's key; the only control is the
               "how does the app look without AI" preview toggle */
            <button className="btn ghost mini" onClick={toggleAi} disabled={aiBusy}>
              {aiBusy ? 'רגע…' : ai.optOut ? '🟢 הפעל תכונות AI' : '⚪ כבה תכונות AI (תצוגה מקדימה)'}
            </button>
          ) : (
            <>
              {ai.hasOwnKey && (
                <div className="export-hint">
                  מפתח API שמור ✓{' '}
                  <button className="btn ghost mini" onClick={removeAiKey} disabled={aiBusy}>
                    הסר מפתח
                  </button>
                </div>
              )}
              <label className="settings-field">
                <span className="settings-lab">{ai.hasOwnKey ? 'החלפת מפתח' : 'מפתח Anthropic API'}</span>
                <input
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  placeholder="sk-ant-…"
                  value={aiKey}
                  onChange={(e) => setAiKey(e.target.value)}
                />
              </label>
              <button className="btn ghost mini" onClick={saveAiKey} disabled={aiBusy || !aiKey.trim()}>
                {aiBusy ? 'בודק את המפתח…' : 'אמת ושמור'}
              </button>
              <div className="export-hint">
                תכונות ה-AI (חישוב ארוחה בתוך האפליקציה, צ'אט הקיטו, דוחות תובנות, זיהוי מוצר
                מתמונה, השלמת ערכים בסריקת ברקוד) פועלות על מפתח משלך וירוצו על חשבונך. מנפיקים
                מפתח ב-console.anthropic.com; הוא נבדק מול Anthropic ונשמר מוצפן. בלי מפתח —
                כל שאר האפליקציה עובדת כרגיל.
              </div>

              {/* the user's own spend + optional monthly budget with a warning
                  before it runs out (we can't read the Anthropic balance itself) */}
              {ai.hasOwnKey && (
                <div className="settings-ai-usage">
                  {aiUsage && (
                    <div className="export-hint">
                      💳 שימוש החודש: <b>${monthUsd.toFixed(2)}</b> ({aiUsage.monthCalls} קריאות) ·
                      סה"כ מאז ההתחלה: ${aiUsage.totalUsd.toFixed(2)}
                    </div>
                  )}
                  {budgetUsd > 0 && aiUsage && budgetRatio >= 0.8 && (
                    <div
                      className="export-hint"
                      style={{ color: budgetRatio >= 1 ? '#dc2626' : '#d97706' }}
                      role="alert"
                    >
                      {budgetRatio >= 1
                        ? `⚠️ עברתם את התקציב החודשי שהגדרתם ($${budgetUsd}) — כדאי לבדוק את הקרדיט בחשבון Anthropic.`
                        : `⚠️ ניצלתם ${Math.round(budgetRatio * 100)}% מהתקציב החודשי שהגדרתם ($${budgetUsd}).`}
                    </div>
                  )}
                  <label className="settings-field">
                    <span className="settings-lab">תקציב AI חודשי ($ · ריק = ללא התראה)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      dir="ltr"
                      placeholder="למשל 5"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />
                  </label>
                  <button className="btn ghost mini" onClick={saveBudget} disabled={aiBusy}>
                    שמור תקציב
                  </button>
                  <div className="export-hint">
                    ההתראה מבוססת על השימוש שנרשם באפליקציה — לא על יתרת הקרדיט בפועל בחשבון
                    Anthropic (אין דרך לקרוא אותה). תקבלו התראה כאן ובכניסה לאפליקציה החל מ-80%
                    מהתקציב.
                  </div>
                </div>
              )}
            </>
          )}

          {/* the chat bubble can be tucked away; the chat then opens from here */}
          {ai.enabled && (
            <div className="settings-chat" style={{ marginTop: 10 }}>
              <div className="settings-lab">צ׳אט קֶטוֹ</div>
              <div className="settings-actions">
                <button className="btn ghost mini" onClick={toggleHideChat}>
                  {hideChat ? '💬 הצג את בועת הצ׳אט' : '🙈 הסתר את בועת הצ׳אט'}
                </button>
                {hideChat && (
                  <button className="btn ghost mini" onClick={openChat}>
                    💬 פתח את הצ׳אט
                  </button>
                )}
              </div>
              {hideChat && (
                <div className="export-hint">הבועה מוסתרת מהמסך הראשי — הצ׳אט נפתח מכאן.</div>
              )}
            </div>
          )}
        </div>

        {onSaveWeight && (
          <>
            <div className="settings-divider" />
            <div className="settings-weigh" data-tour="set-weight">
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

        <div className="settings-divider" />

        {/* danger zone: wipe the journal, start over from day 1 */}
        <div className="settings-danger">
          {!resetOpen ? (
            <button
              className="btn ghost mini"
              style={{ color: '#dc2626', borderColor: '#dc2626' }}
              onClick={() => setResetOpen(true)}
            >
              🗑️ איפוס היומן — התחלה חדשה מיום 1
            </button>
          ) : (
            <div className="settings-group">
              <div className="export-hint" style={{ color: '#dc2626' }} role="alert">
                ⚠️ פעולה בלתי הפיכה: כל הימים, הארוחות, השקילות ודוחות התובנות יימחקו
                לצמיתות, והיומן יתחיל מחדש מיום 1. המוצרים, התבניות וההגדרות שלך יישמרו.
                מומלץ לייצא דוח / Excel לפני.
              </div>
              <div className="export-hint">
                לאישור, הקלידו בדיוק: <b dir="ltr">{resetPhrase}</b>
              </div>
              <input
                dir="ltr"
                autoComplete="off"
                placeholder={resetPhrase}
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
              />
              <div className="settings-actions">
                <button
                  className="btn mini"
                  style={{ background: '#dc2626', borderColor: '#dc2626' }}
                  disabled={!resetMatch || resetting}
                  onClick={doReset}
                >
                  {resetting ? 'מאפס…' : 'אפס לצמיתות'}
                </button>
                <button
                  className="btn ghost mini"
                  disabled={resetting}
                  onClick={() => {
                    setResetOpen(false);
                    setResetText('');
                  }}
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
