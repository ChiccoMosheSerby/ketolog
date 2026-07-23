import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { fileToJpegDataUrl } from '../lib/image.js';
import { displayName } from './UserMenu.jsx';
import './BugReportModal.scss';

const MAX_IMAGES = 3;

// "Report a bug" dialog: a free-text description + up to 3 screenshots. The
// account's name/email ride along automatically (attached server-side), and the
// admin's answer comes back to the messages panel (📬 in the user menu).
export default function BugReportModal({ open, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [desc, setDesc] = useState('');
  const [images, setImages] = useState([]); // data URLs
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // the user's previous reports (status + admin reply), shown below the form
  const [mine, setMine] = useState(null);

  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    setDesc('');
    setImages([]);
    setSent(false);
    api.getMyBugReports().then((r) => setMine(r.reports)).catch(() => setMine([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, MAX_IMAGES - images.length);
    if (!files.length) return;
    const urls = await Promise.all(files.map((f) => fileToJpegDataUrl(f)));
    const ok = urls.filter(Boolean);
    if (ok.length < files.length) toast('חלק מהקבצים אינם תמונות תקינות');
    setImages((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
  }

  // Paste a screenshot straight from the clipboard (Cmd/Ctrl+V) anywhere in the
  // dialog — text pastes into the textarea are untouched.
  function onPaste(e) {
    if (sent) return;
    const files = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    if (images.length >= MAX_IMAGES) return toast(`אפשר לצרף עד ${MAX_IMAGES} תמונות`);
    addFiles(files).then(() => toast('צילום המסך צורף מהלוח 📋'));
  }

  async function send() {
    const d = desc.trim();
    if (d.length < 5) return toast('ספרו לנו קצת יותר — מה קרה ואיפה?');
    setSending(true);
    try {
      await api.reportBug(d, images);
      setSent(true);
    } catch (e) {
      toast(e.message || 'שליחת הדיווח נכשלה — נסו שוב');
      setSending(false);
    }
  }

  const STATUS = {
    open: { lab: 'התקבל', cls: 'open' },
    answered: { lab: 'נענה', cls: 'answered' },
    closed: { lab: 'טופל', cls: 'closed' },
  };

  return (
    <div className="bug-scrim" onClick={onClose}>
      <div
        className="bug-modal"
        role="dialog"
        aria-modal="true"
        aria-label="דיווח על תקלה"
        ref={trapRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onPaste={onPaste}
      >
        <div className="bug-head">
          <h2>🐞 דיווח על תקלה</h2>
          <button className="bug-close" aria-label="סגור" onClick={onClose}>✕</button>
        </div>

        {sent ? (
          <div className="bug-sent">
            <div className="bug-sent-emoji">🙏</div>
            <p>הדיווח נשלח — תודה רבה!</p>
            <p className="bug-hint">התשובה תגיע להודעות שלך (📬 בתפריט המשתמש).</p>
            <button className="btn mini" onClick={onClose}>סגירה</button>
          </div>
        ) : (
          <>
            <label className="bug-field">
              <span>מה קרה? (חובה)</span>
              <textarea
                rows={5}
                maxLength={4000}
                data-autofocus
                placeholder="תיאור התקלה: מה ניסיתם לעשות, מה קרה בפועל, ובאיזה מסך…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </label>

            <div className="bug-field">
              <span>צילומי מסך (עד {MAX_IMAGES}, לא חובה) — אפשר גם להדביק מהלוח (Ctrl/Cmd+V)</span>
              <div className="bug-shots">
                {images.map((src, i) => (
                  <span className="bug-shot" key={i}>
                    <img src={src} alt={`צילום מסך ${i + 1}`} />
                    <button
                      type="button"
                      aria-label="הסר תמונה"
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {images.length < MAX_IMAGES && (
                  <label className="bug-add">
                    +
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="bug-hint">
              הדיווח נשלח עם הפרטים שלך: <b>{displayName(user)}</b> · {user?.email}
            </div>

            <button className="btn bug-send" onClick={send} disabled={sending || desc.trim().length < 5}>
              {sending ? 'שולח…' : 'שליחת הדיווח'}
            </button>

            {mine?.length > 0 && (
              <div className="bug-mine">
                <div className="bug-mine-title">הדיווחים הקודמים שלך</div>
                {mine.map((r) => (
                  <div className="bug-prev" key={r._id}>
                    <div className="bug-prev-head">
                      <span className={'bug-status ' + (STATUS[r.status]?.cls || 'open')}>
                        {STATUS[r.status]?.lab || r.status}
                      </span>
                      <span className="bug-prev-date">
                        {new Date(r.createdAt).toLocaleDateString('he-IL')}
                      </span>
                    </div>
                    <div className="bug-prev-desc">{r.description}</div>
                    {r.adminReply && <div className="bug-prev-reply">↩ {r.adminReply}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
