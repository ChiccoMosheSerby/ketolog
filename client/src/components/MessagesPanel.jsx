import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import './MessagesPanel.scss';

// The user's inbox: admin replies to bug reports, system announcements and
// update notes. Opening the panel marks everything read (clears the badge via
// onRead). Read-only — there is no composing from here.

const TYPE_ICON = { bug_reply: '🐞', system: '📢', update: '✨' };

function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MessagesPanel({ open, onClose, onRead }) {
  const [state, setState] = useState({ status: 'loading', messages: [] });
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ status: 'loading', messages: [] });
    api
      .getMessages()
      .then((r) => {
        if (!alive) return;
        setState({ status: 'ready', messages: r.messages });
        // clear the badge once the panel actually shows the messages
        if (r.unread > 0) {
          api.markMessagesRead().then(() => onRead?.()).catch(() => {});
        }
      })
      .catch(() => alive && setState({ status: 'error', messages: [] }));
    return () => {
      alive = false;
    };
  }, [open, onRead]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const { status, messages } = state;

  return (
    <div className="msgs-scrim" onClick={onClose}>
      <div
        className="msgs-modal"
        role="dialog"
        aria-modal="true"
        aria-label="הודעות"
        ref={trapRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="msgs-head">
          <h2>📬 הודעות</h2>
          <button className="msgs-close" aria-label="סגור" onClick={onClose}>✕</button>
        </div>

        {status === 'loading' && <div className="msgs-note">טוען הודעות…</div>}
        {status === 'error' && <div className="msgs-note">טעינת ההודעות נכשלה — נסו שוב.</div>}
        {status === 'ready' && messages.length === 0 && (
          <div className="msgs-note">
            אין הודעות עדיין. כאן יופיעו תשובות לדיווחי תקלות, עדכונים והודעות מערכת.
          </div>
        )}

        {messages.map((m) => (
          <div className={'msg' + (m.read ? '' : ' unread')} key={m._id}>
            <div className="msg-top">
              <span className="msg-title">
                <span aria-hidden="true">{TYPE_ICON[m.type] || '📢'}</span> {m.title}
              </span>
              <span className="msg-when">{when(m.createdAt)}</span>
            </div>
            {m.body && <div className="msg-body">{m.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
