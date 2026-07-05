import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { heDate } from '../lib/helpers.js';
import { renderText } from '../lib/markdown.jsx';
import {
  getCache,
  isFresh,
  setFromResponse,
  patchReports,
  loadInsights,
} from '../lib/insightsStore.js';
import './SmartInsights.scss';

// Auto-generated weekly/monthly insight reports. The user never triggers a run:
// opening the panel loads the report history and, in the background, the server
// generates any just-completed period that's due. The latest report is shown by
// default; older ones are browsable; unseen reports are highlighted as "new".
//
// Data is cached at module scope so switching tabs re-shows it instantly without
// a refetch — a new fetch only happens when the cache is stale or a generation
// is still pending.

const DIR = { up: '↑', down: '↓', flat: '→' };
const PRIORITY_TONE = { high: 'red', med: 'amber', low: 'olive' };
const SEVERITY_TONE = { alert: 'red', watch: 'amber', info: 'olive' };
const OUTLOOK_TONE = { positive: 'olive', neutral: 'soft', negative: 'red' };

const POLL_MS = 20000;
const POLL_MAX = 5;

// The report cache lives in ../lib/insightsStore.js so the insights nav-tab badge
// can read the same data without a second fetch.

// Sections are collapsible on both desktop and mobile, and collapsed by default
// so the panel opens compact (just the headline + section headers) and you
// expand only what you want to read.
function Section({ icon, title, children, collapsible, previewTitles }) {
  const [open, setOpen] = useState(false);
  const head = (
    <>
      {icon && <span className="si-h-ico" aria-hidden="true">{icon}</span>}
      {title}
    </>
  );
  if (!collapsible) {
    return (
      <div className="si-section">
        <h3 className="si-h">{head}</h3>
        {children}
      </div>
    );
  }
  return (
    <div className={'si-section si-collapsible' + (open ? ' open' : '')}>
      <button className="si-h si-h-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="si-h-left">{head}</span>
        <span className="si-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {/* collapsed: preview the titles of the items inside, so you know what's
          in the section without expanding it */}
      {!open && previewTitles && previewTitles.length > 0 && (
        <div className="si-preview">
          {previewTitles.map((t, i) => (
            <span key={i} className="si-preview-item">{t}</span>
          ))}
        </div>
      )}
      {open && <div className="si-collapsible-body">{children}</div>}
    </div>
  );
}

function Card({ title, body, tone, badge }) {
  return (
    <div className={'si-card' + (tone ? ' tone-' + tone : '')}>
      <div className="si-card-head">
        {title && <span className="si-card-title">{title}</span>}
        {badge && <span className="si-badge">{badge}</span>}
      </div>
      {body && <div className="si-body">{renderText(body)}</div>}
    </div>
  );
}

function Report({ ins, collapsible }) {
  const { t } = useTranslation();
  const trends = ins.trends || [];
  const recs = ins.recommendations || [];
  const points = ins.pointsToWatch || [];
  const anomalies = ins.anomalies || [];
  return (
    <>
      {ins.highlight && (
        <div className="si-highlight">
          <span className="si-highlight-tag">{t('insights.highlightTag')}</span>
          <div className="si-highlight-body">{renderText(ins.highlight)}</div>
        </div>
      )}
      {ins.summary && (
        <Section icon="📊" title={t('insights.summary')} collapsible={collapsible}>
          <div className="si-body si-summary">{renderText(ins.summary)}</div>
        </Section>
      )}

      {trends.length > 0 && (
        <Section
          icon="📈"
          title={t('insights.trends')}
          collapsible={collapsible}
          previewTitles={trends.map((t) => t.title).filter(Boolean)}
        >
          <div className="si-grid">
            {trends.map((t, i) => (
              <Card key={i} title={`${DIR[t.direction] || ''} ${t.title}`.trim()} body={t.body} badge={t.metric || null} />
            ))}
          </div>
        </Section>
      )}

      {ins.forecast?.body && (
        <Section icon="🔮" title={t('insights.forecast')} collapsible={collapsible}>
          <Card body={ins.forecast.body} tone={OUTLOOK_TONE[ins.forecast.outlook] || 'soft'} />
        </Section>
      )}

      {recs.length > 0 && (
        <Section
          icon="🎯"
          title={t('insights.recommendations')}
          collapsible={collapsible}
          previewTitles={recs.map((r) => r.title).filter(Boolean)}
        >
          <div className="si-grid">
            {recs.map((r, i) => (
              <Card key={i} title={r.title} body={r.body} tone={PRIORITY_TONE[r.priority]} badge={r.priority ? t(`insights.priority.${r.priority}`, { defaultValue: '' }) : ''} />
            ))}
          </div>
        </Section>
      )}

      {points.length > 0 && (
        <Section
          icon="👀"
          title={t('insights.pointsToWatch')}
          collapsible={collapsible}
          previewTitles={points.map((p) => p.title).filter(Boolean)}
        >
          <div className="si-grid">
            {points.map((p, i) => (
              <Card key={i} title={p.title} body={p.body} tone="amber" />
            ))}
          </div>
        </Section>
      )}

      {anomalies.length > 0 && (
        <Section
          icon="⚠️"
          title={t('insights.anomalies')}
          collapsible={collapsible}
          previewTitles={anomalies.map((a) => a.title).filter(Boolean)}
        >
          <div className="si-grid">
            {anomalies.map((a, i) => (
              <Card key={i} title={a.title} body={a.body} tone={SEVERITY_TONE[a.severity]} badge={a.date ? heDate(a.date) : (a.severity ? t(`insights.severity.${a.severity}`, { defaultValue: '' }) : '')} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

export default function SmartInsights() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const key = user?.email || '';
  const seed = getCache();
  const seeded = seed && seed.key === key;

  const [status, setStatus] = useState(seeded ? 'ready' : 'loading');
  const [reports, setReports] = useState(seeded ? seed.reports : []);
  const [generating, setGenerating] = useState(seeded ? seed.generating : []);
  const [aiOff, setAiOff] = useState(seeded ? seed.aiOff : false);
  const [selectedId, setSelectedId] = useState(seeded && seed.reports[0] ? seed.reports[0].id : null);
  const [error, setError] = useState(null);
  const poll = useRef({ count: 0, timer: null, alive: true });

  const applyResponse = useCallback((res) => {
    const c = setFromResponse(key, res);
    setAiOff(c.aiOff);
    if (!c.enoughData) {
      setReports([]);
      setGenerating([]);
      setStatus('enough-no');
      return res;
    }
    setReports(c.reports);
    setGenerating(c.generating);
    setSelectedId((cur) => cur || (c.reports[0] ? c.reports[0].id : null));
    setStatus('ready');
    return res;
  }, [key]);

  const fetchOnce = useCallback(async () => {
    const res = await loadInsights(key);
    return applyResponse(res);
  }, [key, applyResponse]);

  // Load / revalidate. Reuses module cache across tab switches; only fetches
  // when there's no fresh cache, or a generation is pending (so it can land).
  useEffect(() => {
    const p = poll.current;
    p.alive = true;
    p.count = 0;

    const startPolling = () => {
      const tick = async () => {
        try {
          const res = await fetchOnce();
          if (p.alive && (res.generating || []).length > 0 && p.count < POLL_MAX) {
            p.count += 1;
            p.timer = setTimeout(tick, POLL_MS);
          }
        } catch (e) {
          if (p.alive && !getCache()) {
            setError(e.message || t('insights.genericError'));
            setStatus('error');
          }
        }
      };
      tick();
    };

    const c = getCache();
    const fresh = isFresh(key);
    const pending = c && c.key === key && (c.generating || []).length > 0;

    if (fresh && !pending) {
      // cached & fresh & nothing generating → show as-is, no fetch
      setStatus('ready');
    } else {
      if (!c || c.key !== key) setStatus('loading');
      startPolling();
    }

    return () => {
      p.alive = false;
      if (p.timer) clearTimeout(p.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Mark the shown report seen after a short dwell (clears its "new" highlight).
  useEffect(() => {
    if (!selectedId) return;
    const r = reports.find((x) => x.id === selectedId);
    if (!r || r.seen) return;
    const t = setTimeout(async () => {
      try {
        await api.markInsightSeen(selectedId);
        const upd = (rs) => rs.map((x) => (x.id === selectedId ? { ...x, seen: true } : x));
        setReports(upd);
        patchReports(key, upd);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearTimeout(t);
  }, [selectedId, reports, key]);

  if (status === 'loading') {
    return (
      <div className="panel si-panel">
        <div className="si-loading">{t('insights.loading')}</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="panel si-panel">
        <div className="si-note">{error ? t('insights.unavailableWithError', { error }) : t('insights.unavailable')}</div>
      </div>
    );
  }

  if (status === 'enough-no') {
    return (
      <div className="panel si-panel">
        <div className="si-note">{t('insights.notEnoughData')}</div>
      </div>
    );
  }

  const isGenerating = generating.length > 0;

  if (reports.length === 0) {
    return (
      <div className="panel si-panel">
        <h2 className="si-title">{t('insights.title')}</h2>
        {aiOff ? (
          <div className="si-note">{t('insights.aiOff')}</div>
        ) : isGenerating ? (
          <div className="si-loading">{t('insights.generatingFirst')}</div>
        ) : (
          <div className="si-note">{t('insights.firstReportSoon')}</div>
        )}
      </div>
    );
  }

  const selected = reports.find((r) => r.id === selectedId) || reports[0];
  const anyUnseen = reports.some((r) => !r.seen);

  return (
    <div className="panel si-panel">
      <div className="si-top">
        <h2 className="si-title">
          {t('insights.title')}
          {anyUnseen && <span className="si-new-dot" title={t('insights.newReportTitle')}>{t('insights.new')}</span>}
        </h2>
        {isGenerating && <span className="si-gen">{t('insights.updating')}</span>}
      </div>

      {/* report history — newest first; "new" reports badged */}
      <div className="si-reports" role="tablist">
        {reports.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={r.id === selected.id}
            className={'si-chip' + (r.id === selected.id ? ' active' : '') + (!r.seen ? ' unseen' : '')}
            onClick={() => setSelectedId(r.id)}
          >
            <span className="si-chip-period">{r.period ? t(`insights.period.${r.period}`, { defaultValue: '' }) : ''}</span>
            <span className="si-chip-label">{r.label}</span>
            {!r.seen && <span className="si-chip-new">•</span>}
          </button>
        ))}
      </div>

      <Report ins={selected.result || {}} collapsible />

      {selected.generatedAt && (
        <div className="si-foot">
          {t('insights.footer', {
            period: t(`insights.period.${selected.period}`, { defaultValue: '' }),
            label: selected.label,
            date: heDate(String(selected.generatedAt).slice(0, 10)),
          })}
        </div>
      )}
    </div>
  );
}
