import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import './AdminUsage.scss';

// Admin-only dashboard: what each user's AI usage costs me (Anthropic + OpenAI),
// so I know what to charge. Opened from the header (admins only). All-time cost
// per user + a per-feature breakdown, plus a rolling 30-day figure. For now it's
// shown in-app; later this can move to an email digest.

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
  const { t } = useTranslation();
  return (
    <div className="au-kind">
      <span className="au-kind-name">{t(`adminUsage.kinds.${kind}`, { defaultValue: kind })}</span>
      <span className="au-kind-calls">{t('adminUsage.callsCount', { value: num(data.calls) })}</span>
      <span className="au-kind-cost">{usd(data.costUsd)}</span>
    </div>
  );
}

function UserCard({ row }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const kinds = Object.entries(row.byKind).sort((a, b) => b[1].costUsd - a[1].costUsd);
  return (
    <div className={'au-user' + (open ? ' open' : '')}>
      <button className="au-user-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="au-email">{row.email}</span>
        <span className="au-user-right">
          <span className="au-30d" title={t('adminUsage.last30Days')}>{t('adminUsage.per30Days', { value: usd(row.cost30d) })}</span>
          <span className="au-total">{usd(row.costUsd)}</span>
          <span className="au-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && (
        <div className="au-user-body">
          {kinds.length ? (
            kinds.map(([kind, data]) => <KindRow key={kind} kind={kind} data={data} />)
          ) : (
            <div className="au-empty">{t('adminUsage.noUsageYet')}</div>
          )}
          <div className="au-user-foot">{t('adminUsage.totalCalls', { value: num(row.calls) })}</div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsage({ open, onClose }) {
  const { t } = useTranslation();
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
          <h2>{t('adminUsage.title')}</h2>
          <button className="au-close" aria-label={t('common.close')} onClick={onClose}>✕</button>
        </div>

        {status === 'loading' && <div className="au-note">{t('common.loading')}</div>}
        {status === 'error' && <div className="au-note">{error ? t('adminUsage.loadFailedWithError', { error }) : t('adminUsage.loadFailed')}</div>}

        {status === 'ready' && data && (
          <>
            <div className="au-totals">
              <div className="au-total-tile">
                <span className="au-total-num">{usd(data.totalUsd)}</span>
                <span className="au-total-lab">{t('adminUsage.totalCostAllTime')}</span>
              </div>
              <div className="au-total-tile">
                <span className="au-total-num">{usd(data.total30d)}</span>
                <span className="au-total-lab">{t('adminUsage.last30Days')}</span>
              </div>
              <div className="au-total-tile">
                <span className="au-total-num">{data.rows.length}</span>
                <span className="au-total-lab">{t('adminUsage.activeUsers')}</span>
              </div>
            </div>

            <div className="au-users">
              {data.rows.length ? (
                data.rows.map((row) => <UserCard key={row.userId} row={row} />)
              ) : (
                <div className="au-note">{t('adminUsage.noUsageRecorded')}</div>
              )}
            </div>

            <div className="au-foot">
              {t('adminUsage.footnote')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
