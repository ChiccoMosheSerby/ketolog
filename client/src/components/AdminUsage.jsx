import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import './AdminUsage.scss';

// Admin-only dashboard: what each user's AI usage costs me (Anthropic + OpenAI),
// so I know what to charge. Opened from the header (admins only). All-time cost
// per user + a per-feature breakdown, plus a rolling 30-day figure. For now it's
// shown in-app; later this can move to an email digest.

// Human labels for each usage `kind`.
const KIND_LABEL = {
  estimate_meal: 'הערכת ארוחה',
  estimate_image: 'זיהוי תמונה',
  barcode: 'סריקת ברקוד',
  chat: 'צ׳אט קֶטוֹ',
  insight: 'דוחות תובנות',
  transcribe: 'תמלול קולי',
  whatsapp_out: 'WhatsApp — הודעות יוצאות',
  whatsapp_in: 'WhatsApp — הודעות נכנסות',
};

// Costs here are tiny (fractions of a cent up to a few dollars). Show more
// precision for small numbers so a $0.003 call doesn't render as "$0.00".
function usd(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 1) return '$' + v.toFixed(4);
  return '$' + v.toFixed(2);
}

const num = (n) => (Number(n) || 0).toLocaleString('en-US');

function KindRow({ kind, data }) {
  return (
    <div className="au-kind">
      <span className="au-kind-name">{KIND_LABEL[kind] || kind}</span>
      <span className="au-kind-calls">{num(data.calls)} קריאות</span>
      <span className="au-kind-cost">{usd(data.costUsd)}</span>
    </div>
  );
}

function UserCard({ row }) {
  const [open, setOpen] = useState(false);
  const kinds = Object.entries(row.byKind).sort((a, b) => b[1].costUsd - a[1].costUsd);
  return (
    <div className={'au-user' + (open ? ' open' : '')}>
      <button className="au-user-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="au-email">{row.email}</span>
        <span className="au-user-right">
          <span className="au-30d" title="30 הימים האחרונים">{usd(row.cost30d)} / 30 ימים</span>
          <span className="au-total">{usd(row.costUsd)}</span>
          <span className="au-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="au-user-body">
          {kinds.length ? (
            kinds.map(([kind, data]) => <KindRow key={kind} kind={kind} data={data} />)
          ) : (
            <div className="au-empty">אין עדיין שימוש.</div>
          )}
          <div className="au-user-foot">{num(row.calls)} קריאות בסך הכל</div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsage({ open, onClose }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ status: 'loading', data: null, error: null });
    api
      .getAdminUsage()
      .then((data) => alive && setState({ status: 'ready', data, error: null }))
      .catch((e) => alive && setState({ status: 'error', data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const { status, data, error } = state;

  return (
    <div className="au-scrim" onClick={onClose}>
      <div className="au-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="au-head">
          <h2>שימוש ועלויות AI</h2>
          <button className="au-close" aria-label="סגור" onClick={onClose}>✕</button>
        </div>

        {status === 'loading' && <div className="au-note">טוען נתוני שימוש…</div>}
        {status === 'error' && <div className="au-note">טעינת הנתונים נכשלה{error ? ` (${error})` : ''}.</div>}

        {status === 'ready' && data && (
          <>
            <div className="au-totals">
              <div className="au-total-tile">
                <span className="au-total-num">{usd(data.totalUsd)}</span>
                <span className="au-total-lab">עלות כוללת (מאז ומתמיד)</span>
              </div>
              <div className="au-total-tile">
                <span className="au-total-num">{usd(data.total30d)}</span>
                <span className="au-total-lab">30 הימים האחרונים</span>
              </div>
              <div className="au-total-tile">
                <span className="au-total-num">{data.rows.length}</span>
                <span className="au-total-lab">משתמשים פעילים</span>
              </div>
            </div>

            <div className="au-users">
              {data.rows.length ? (
                data.rows.map((row) => <UserCard key={row.userId} row={row} />)
              ) : (
                <div className="au-note">עדיין אין שימוש מתועד.</div>
              )}
            </div>

            <div className="au-foot">
              עלויות ב-USD: Claude Opus 4.8, Whisper, ו-Twilio WhatsApp (הערכה למסר — ניתן לכוונון). לחיצה על משתמש פותחת פירוט לפי סוג שימוש.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
