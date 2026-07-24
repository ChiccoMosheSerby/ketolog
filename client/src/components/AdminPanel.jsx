import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import './AdminPanel.scss';

// Admin-only tab ("ניהול"): every account with its activity + AI costs, a
// per-user drill-down (recent days, weigh-ins, inbox), approval control, and
// system messaging (targeted or broadcast) with a sent-history.

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
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('he-IL') : '—');

function statusChip(row) {
  if (row.autoApproved) return { lab: 'אוטומטי', cls: 'auto' };
  if (row.approved) return { lab: 'מאושר', cls: 'ok' };
  return { lab: 'לא מאושר', cls: 'off' };
}

// Compose form for a system message. With a fixed email (inside a user card)
// it targets that user; without one it broadcasts to everyone — targeting a
// specific user happens only from their card.
function MessageCompose({ fixedEmail, onSent }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.sendSystemMessage(title.trim(), body.trim(), fixedEmail || '');
      toast(r.sent === 1 ? 'ההודעה נשלחה' : `ההודעה נשלחה ל-${r.sent} משתמשים`);
      setTitle('');
      setBody('');
      onSent?.();
    } catch (e) {
      toast(e.message || 'שליחת ההודעה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap-compose">
      <input
        type="text"
        maxLength={120}
        placeholder="כותרת"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        rows={3}
        maxLength={4000}
        placeholder="תוכן ההודעה (לא חובה)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button className="btn mini" onClick={send} disabled={busy || !title.trim()}>
        {busy ? 'שולח…' : fixedEmail ? 'שליחה למשתמש' : 'שליחה לכולם'}
      </button>
    </div>
  );
}

function Stat({ lab, val }) {
  return (
    <div className="ap-stat">
      <span className="ap-stat-num">{val}</span>
      <span className="ap-stat-lab">{lab}</span>
    </div>
  );
}

function UserCard({ row, onApproval, onSent }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // drill-down lists, fetched once on first expand and cached here
  const [detail, setDetail] = useState({ status: 'idle', data: null });
  const [approvalBusy, setApprovalBusy] = useState(false);

  function loadDetail() {
    setDetail((d) => ({ status: 'loading', data: d.data }));
    api
      .getAdminUser(row.id)
      .then((data) => setDetail({ status: 'ready', data }))
      .catch(() => setDetail({ status: 'error', data: null }));
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && detail.status === 'idle') loadDetail();
  }

  async function setApproval(approved) {
    if (approvalBusy) return;
    if (!approved && !window.confirm(`לבטל את האישור של ${row.email}? המשתמש ינותק ולא יוכל להתחבר.`)) return;
    setApprovalBusy(true);
    try {
      await api.setUserApproval(row.id, approved);
      toast(approved ? 'המשתמש אושר' : 'האישור בוטל');
      onApproval(row.id, approved);
    } catch (e) {
      toast(e.message || 'עדכון האישור נכשל');
    } finally {
      setApprovalBusy(false);
    }
  }

  const chip = statusChip(row);
  const kinds = Object.entries(row.byKind || {}).sort((a, b) => b[1].costUsd - a[1].costUsd);
  const d = detail.data;

  return (
    <div className={'ap-user' + (open ? ' open' : '')}>
      <button className="ap-user-head" onClick={toggle} aria-expanded={open}>
        <span className={'ap-chip ' + chip.cls}>{chip.lab}</span>
        <span className="ap-who">
          {row.name ? `${row.name} · ` : ''}
          <span dir="ltr">{row.email}</span>
        </span>
        <span className="ap-head-stats">
          <span title="ימים מתועדים">📅 {num(row.days)}</span>
          <span title="פעילות אחרונה">🕐 {fmtDate(row.lastActive)}</span>
          <span className="ap-cost" title="עלות AI כוללת">{usd(row.costUsd)}</span>
        </span>
        <span className="ap-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="ap-user-body">
          <div className="ap-stats">
            <Stat lab="ארוחות" val={num(row.meals)} />
            <Stat lab="שקילות" val={num(row.weighIns)} />
            <Stat lab="ימים סגורים" val={num(row.closedDays)} />
            <Stat lab="מוצרים" val={num(row.products)} />
            <Stat lab="תבניות" val={num(row.templates)} />
            <Stat lab="שיחות AI" val={num(row.conversations)} />
            <Stat lab="דיווחים פתוחים" val={num(row.openBugs)} />
            <Stat lab="הצטרפות" val={fmtDate(row.createdAt)} />
          </div>

          {kinds.length > 0 && (
            <div className="ap-block">
              <div className="ap-block-title">עלויות AI — {usd(row.costUsd)} סה"כ · {usd(row.cost30d)} ב-30 הימים האחרונים</div>
              {kinds.map(([kind, data]) => (
                <div className="ap-kind" key={kind}>
                  <span className="ap-kind-name">{KIND_LABEL[kind] || kind}</span>
                  <span className="ap-kind-calls">{num(data.calls)} קריאות</span>
                  <span className="ap-kind-cost">{usd(data.costUsd)}</span>
                </div>
              ))}
            </div>
          )}

          {detail.status === 'loading' && !d && <div className="ap-note">טוען פירוט…</div>}
          {detail.status === 'error' && <div className="ap-note">טעינת הפירוט נכשלה.</div>}

          {d && (
            <>
              <div className="ap-block">
                <div className="ap-block-title">ימים אחרונים</div>
                {d.recentDays.length ? (
                  <div className="ap-days">
                    {d.recentDays.map((day) => (
                      <div className="ap-day" key={day.date}>
                        <span className="ap-day-date" dir="ltr">{day.date}</span>
                        <span className="ap-day-meals">{day.mealsCount} ארוחות</span>
                        {day.weight && <span className="ap-day-weight">⚖ {day.weight}</span>}
                        {day.closed && <span className="ap-day-closed">✓ נסגר</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ap-note">אין ימים מתועדים.</div>
                )}
              </div>

              {d.messages.length > 0 && (
                <div className="ap-block">
                  <div className="ap-block-title">הודעות אחרונות למשתמש</div>
                  {d.messages.map((m) => (
                    <div className="ap-msg" key={m._id}>
                      <div className="ap-msg-row">
                        <span className={'ap-read-dot' + (m.read ? ' read' : '')} title={m.read ? 'נקראה' : 'לא נקראה'} />
                        <span className="ap-msg-title">{m.title}</span>
                        <span className="ap-msg-date">{fmtDate(m.createdAt)}</span>
                      </div>
                      {m.body && <div className="ap-msg-body">{m.body}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="ap-block">
            <div className="ap-block-title">שליחת הודעה למשתמש</div>
            {/* a send refreshes this card's message list (so it shows up under
                "הודעות אחרונות למשתמש") and the global sent-history */}
            <MessageCompose
              fixedEmail={row.email}
              onSent={() => {
                loadDetail();
                onSent();
              }}
            />
          </div>

          <div className="ap-approval">
            {row.autoApproved ? (
              <span className="ap-note">חשבון באישור אוטומטי — תמיד מחובר.</span>
            ) : row.approved ? (
              <button className="btn ghost mini danger" onClick={() => setApproval(false)} disabled={approvalBusy}>
                {approvalBusy ? 'מעדכן…' : 'ביטול אישור'}
              </button>
            ) : (
              <button className="btn mini" onClick={() => setApproval(true)} disabled={approvalBusy}>
                {approvalBusy ? 'מעדכן…' : 'אישור משתמש'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const [overview, setOverview] = useState({ status: 'loading', data: null });
  const [history, setHistory] = useState({ status: 'loading', groups: [] });

  function loadHistory() {
    api
      .getAdminMessages()
      .then((r) => setHistory({ status: 'ready', groups: r.groups }))
      .catch(() => setHistory({ status: 'error', groups: [] }));
  }

  useEffect(() => {
    api
      .getAdminUsers()
      .then((data) => setOverview({ status: 'ready', data }))
      .catch(() => setOverview({ status: 'error', data: null }));
    loadHistory();
  }, []);

  // Flip a row's approval locally after the server confirmed it.
  function handleApproval(id, approved) {
    setOverview((o) =>
      o.data
        ? { ...o, data: { ...o.data, users: o.data.users.map((u) => (u.id === id ? { ...u, approved } : u)) } }
        : o
    );
  }

  const { data } = overview;

  return (
    <div className="ap">
      {overview.status === 'loading' && <div className="ap-note center">טוען נתוני ניהול…</div>}
      {overview.status === 'error' && <div className="ap-note center">טעינת נתוני הניהול נכשלה.</div>}

      {overview.status === 'ready' && data && (
        <>
          <div className="ap-totals">
            <div className="ap-tile">
              <span className="ap-tile-num">{num(data.totals.users)}</span>
              <span className="ap-tile-lab">משתמשים</span>
            </div>
            <div className="ap-tile">
              <span className="ap-tile-num">{usd(data.totals.totalUsd)}</span>
              <span className="ap-tile-lab">עלות AI כוללת</span>
            </div>
            <div className="ap-tile">
              <span className="ap-tile-num">{usd(data.totals.total30d)}</span>
              <span className="ap-tile-lab">30 הימים האחרונים</span>
            </div>
          </div>

          <h3 className="ap-section">משתמשים</h3>
          <div className="ap-users">
            {data.users.map((row) => (
              <UserCard key={row.id} row={row} onApproval={handleApproval} onSent={loadHistory} />
            ))}
          </div>

          <h3 className="ap-section">הודעות מערכת</h3>
          <div className="ap-block">
            <MessageCompose onSent={loadHistory} />
          </div>

          {history.status === 'error' && <div className="ap-note">טעינת ההיסטוריה נכשלה.</div>}
          {history.status === 'ready' && history.groups.length === 0 && (
            <div className="ap-note">עוד לא נשלחו הודעות מערכת.</div>
          )}
          {history.groups.length > 0 && (
            <div className="ap-history">
              {history.groups.map((g, i) => (
                <div className="ap-hist-row" key={i}>
                  <div className="ap-hist-main">
                    <span className="ap-hist-title">{g.title}</span>
                    {g.body && <span className="ap-hist-body">{g.body}</span>}
                  </div>
                  <div className="ap-hist-meta">
                    <span>{fmtDate(g.createdAt)}</span>
                    <span>לכולם ({g.sent})</span>
                    <span title="נקראו מתוך נשלחו">נקראו {g.read}/{g.sent}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
