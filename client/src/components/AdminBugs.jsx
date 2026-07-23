import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import './AdminBugs.scss';

// Full-size screenshot viewer. Screenshots are data: URLs, which browsers
// refuse to open in a new tab — so we enlarge them in an in-app overlay
// instead. Click anywhere or press Escape to close.
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="abug-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="צילום מסך">
      <img src={src} alt="צילום מסך בגודל מלא" />
      <button className="abug-lightbox-close" aria-label="סגור" onClick={onClose}>✕</button>
    </div>,
    document.body
  );
}

// Admin-only: every bug report users filed — description, screenshots, status —
// with a reply box. Sending a reply stores it on the report and delivers it to
// the reporter's messages (📬). A small broadcast form at the top sends a
// system message to one user or to everyone.

const STATUS = {
  open: { lab: 'פתוח', cls: 'open' },
  answered: { lab: 'נענה', cls: 'answered' },
  closed: { lab: 'טופל', cls: 'closed' },
};

function Report({ report, open, onToggle, onReplied }) {
  const toast = useToast();
  const [reply, setReply] = useState(report.adminReply || '');
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(''); // data URL of the enlarged screenshot

  // (Re)seed the reply box each time this report is expanded — after a send the
  // parent collapses it, so it never sits there holding the message just sent.
  useEffect(() => {
    if (open) {
      setReply(report.adminReply || '');
      setClose(false);
    }
  }, [open, report.adminReply]);

  async function send() {
    if (!reply.trim() || busy) return;
    setBusy(true);
    try {
      await api.replyToBug(report._id, reply.trim(), close ? 'closed' : 'answered');
      toast('התשובה נשלחה להודעות של המשתמש');
      onReplied(report._id);
    } catch (e) {
      toast(e.message || 'שליחת התשובה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  const st = STATUS[report.status] || STATUS.open;

  return (
    <div className={'abug' + (open ? ' open' : '')}>
      <button className="abug-head" onClick={onToggle} aria-expanded={open}>
        <span className={'bug-status ' + st.cls}>{st.lab}</span>
        <span className="abug-who">{report.name ? `${report.name} · ` : ''}{report.email}</span>
        <span className="abug-date">{new Date(report.createdAt).toLocaleDateString('he-IL')}</span>
        <span className="abug-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="abug-body">
          <div className="abug-desc">{report.description}</div>

          {report.images?.length > 0 && (
            <div className="abug-shots">
              {report.images.map((src, i) => (
                <button key={i} type="button" title="הגדלה" onClick={() => setZoom(src)}>
                  <img src={src} alt={`צילום מסך ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
          {zoom && <Lightbox src={zoom} onClose={() => setZoom('')} />}

          {report.userAgent && <div className="abug-ua" dir="ltr">{report.userAgent}</div>}

          <textarea
            rows={3}
            maxLength={4000}
            placeholder="תשובה למשתמש… (תישלח להודעות שלו באפליקציה)"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="abug-acts">
            <label className="abug-close-check">
              <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
              סמן כטופל
            </label>
            <button className="btn mini" onClick={send} disabled={busy || !reply.trim()}>
              {busy ? 'שולח…' : 'שליחת תשובה'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminBugs({ open, onClose }) {
  const toast = useToast();
  const [state, setState] = useState({ status: 'loading', reports: [] });
  // which report is expanded — parent-owned so a sent reply can advance it
  const [expandedId, setExpandedId] = useState(null);

  // broadcast form
  const [bcTitle, setBcTitle] = useState('');
  const [bcBody, setBcBody] = useState('');
  const [bcEmail, setBcEmail] = useState('');
  const [bcBusy, setBcBusy] = useState(false);
  const [bcOpen, setBcOpen] = useState(false);

  function load() {
    setState((s) => ({ ...s, status: 'loading' }));
    api
      .getAdminBugs()
      .then((r) => setState({ status: 'ready', reports: r.reports }))
      .catch(() => setState({ status: 'error', reports: [] }));
  }

  useEffect(() => {
    if (open) {
      setExpandedId(null);
      load();
    }
  }, [open]);

  // After a reply: collapse the answered report and jump to the next one still
  // waiting (continuing downward, wrapping to the top). Nothing waiting → all
  // collapsed. Then refresh the list so statuses update.
  function handleReplied(repliedId) {
    const idx = state.reports.findIndex((r) => r._id === repliedId);
    const rest = [...state.reports.slice(idx + 1), ...state.reports.slice(0, Math.max(idx, 0))];
    const next = rest.find((r) => r.status === 'open');
    setExpandedId(next ? next._id : null);
    load();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function broadcast() {
    if (!bcTitle.trim() || bcBusy) return;
    setBcBusy(true);
    try {
      const r = await api.sendSystemMessage(bcTitle.trim(), bcBody.trim(), bcEmail.trim());
      toast(`ההודעה נשלחה ל-${r.sent} משתמשים`);
      setBcTitle('');
      setBcBody('');
      setBcEmail('');
      setBcOpen(false);
    } catch (e) {
      toast(e.message || 'שליחת ההודעה נכשלה');
    } finally {
      setBcBusy(false);
    }
  }

  const { status, reports } = state;

  return (
    <div className="abugs-scrim" onClick={onClose}>
      <div
        className="abugs-modal"
        role="dialog"
        aria-modal="true"
        aria-label="דיווחי תקלות"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="abugs-head">
          <h2>🐞 דיווחי תקלות</h2>
          <button className="abugs-close" aria-label="סגור" onClick={onClose}>✕</button>
        </div>

        {/* system message to one user / everyone */}
        <div className="abugs-bc">
          <button className="btn ghost mini" onClick={() => setBcOpen((o) => !o)}>
            📢 הודעת מערכת {bcOpen ? '▾' : '▸'}
          </button>
          {bcOpen && (
            <div className="abugs-bc-form">
              <input
                type="text"
                maxLength={120}
                placeholder="כותרת"
                value={bcTitle}
                onChange={(e) => setBcTitle(e.target.value)}
              />
              <textarea
                rows={3}
                maxLength={4000}
                placeholder="תוכן ההודעה (לא חובה)"
                value={bcBody}
                onChange={(e) => setBcBody(e.target.value)}
              />
              <input
                type="email"
                dir="ltr"
                placeholder="אימייל של משתמש ספציפי — ריק = לכולם"
                value={bcEmail}
                onChange={(e) => setBcEmail(e.target.value)}
              />
              <button className="btn mini" onClick={broadcast} disabled={bcBusy || !bcTitle.trim()}>
                {bcBusy ? 'שולח…' : bcEmail.trim() ? 'שליחה למשתמש' : 'שליחה לכולם'}
              </button>
            </div>
          )}
        </div>

        {status === 'loading' && <div className="abugs-note">טוען דיווחים…</div>}
        {status === 'error' && <div className="abugs-note">טעינת הדיווחים נכשלה.</div>}
        {status === 'ready' && reports.length === 0 && (
          <div className="abugs-note">אין דיווחי תקלות. 🎉</div>
        )}

        {reports.map((r) => (
          <Report
            key={r._id}
            report={r}
            open={expandedId === r._id}
            onToggle={() => setExpandedId(expandedId === r._id ? null : r._id)}
            onReplied={handleReplied}
          />
        ))}
      </div>
    </div>
  );
}
