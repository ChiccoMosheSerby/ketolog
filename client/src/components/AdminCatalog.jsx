import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import './AdminCatalog.scss';

// Admin-only "products map": the global learned-product catalog (every food item
// pulled from all users' logged meals, deduped by normalized name, with per-unit
// macros and an app-wide usage score). This is the raw material for the future
// DB-served logging + the /optimize dedup pass, so the table is built for triage:
// smart filtering (plain OR regex), min-usage threshold, a "missing values" lens,
// and click-to-sort on every column.

const fmt = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—';
};

const fmtDate = (d) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('he-IL');
};

// Columns: [key, label, numeric?]. `numeric` drives right-alignment + numeric sort.
const COLS = [
  ['name', 'שם', false],
  ['unit', 'יחידה', false],
  ['carbs', "פחמ'", true],
  ['fat', 'שומן', true],
  ['protein', 'חלבון', true],
  ['usedCount', 'שימושים', true],
  ['updatedAt', 'עודכן', true],
];

export default function AdminCatalog({ open, onClose }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });

  // filters
  const [q, setQ] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [minUses, setMinUses] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  // sort
  const [sort, setSort] = useState({ col: 'usedCount', dir: 'desc' });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ status: 'loading', items: [], error: null });
    api
      .getAdminCatalog()
      .then((d) => alive && setState({ status: 'ready', items: d.items || [], error: null }))
      .catch((e) => alive && setState({ status: 'error', items: [], error: e.message }));
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

  // Compile the query once: a RegExp when regex mode is on (invalid → error flag),
  // otherwise a lowercased substring. `null` matcher means "match everything".
  const matcher = useMemo(() => {
    const term = q.trim();
    if (!term) return { test: null, error: false };
    if (useRegex) {
      try {
        const re = new RegExp(term, 'i');
        return { test: (s) => re.test(s), error: false };
      } catch {
        return { test: () => false, error: true };
      }
    }
    const lc = term.toLowerCase();
    return { test: (s) => s.toLowerCase().includes(lc), error: false };
  }, [q, useRegex]);

  const rows = useMemo(() => {
    const min = Number(minUses) || 0;
    let list = state.items.filter((it) => {
      if (min && (Number(it.usedCount) || 0) < min) return false;
      if (onlyMissing && it.fat != null && it.protein != null) return false;
      if (matcher.test) {
        const hay = `${it.name || ''} ${it.unit || ''}`;
        if (!matcher.test(hay)) return false;
      }
      return true;
    });
    const { col, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      let av = a[col];
      let bv = b[col];
      if (col === 'name' || col === 'unit') {
        return String(av || '').localeCompare(String(bv || ''), 'he') * mul;
      }
      if (col === 'updatedAt') {
        av = new Date(av || 0).getTime();
        bv = new Date(bv || 0).getTime();
      } else {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
      }
      return (av - bv) * mul;
    });
    return list;
  }, [state.items, matcher, minUses, onlyMissing, sort]);

  const totalUses = useMemo(
    () => state.items.reduce((s, it) => s + (Number(it.usedCount) || 0), 0),
    [state.items]
  );

  if (!open) return null;

  const toggleSort = (col) =>
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
    );

  const sortArrow = (col) => (sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const { status, error } = state;

  return (
    <div className="ct-scrim" onClick={onClose}>
      <div className="ct-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="ct-head">
          <h2>מפת מוצרים</h2>
          <button className="ct-close" aria-label="סגור" onClick={onClose}>✕</button>
        </div>

        {status === 'loading' && <div className="ct-note">טוען מפת מוצרים…</div>}
        {status === 'error' && (
          <div className="ct-note">טעינת המפה נכשלה{error ? ` (${error})` : ''}.</div>
        )}

        {status === 'ready' && (
          <>
            <div className="ct-controls">
              <div className="ct-search">
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={useRegex ? 'ביטוי רגולרי… (למשל ^חביתה)' : 'חיפוש בשם / יחידה…'}
                  className={matcher.error ? 'bad' : ''}
                  spellCheck={false}
                />
                {matcher.error && <span className="ct-re-err">regex לא תקין</span>}
              </div>
              <label className="ct-chk" title="פרש את החיפוש כביטוי רגולרי">
                <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
                regex
              </label>
              <label className="ct-chk" title="הצג רק פריטים ללא שומן/חלבון — מועמדים להשלמה">
                <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                חסרי ערכים
              </label>
              <label className="ct-min" title="מינימום שימושים">
                ≥
                <input
                  type="number"
                  min="0"
                  value={minUses}
                  onChange={(e) => setMinUses(e.target.value)}
                  placeholder="0"
                />
                שימושים
              </label>
            </div>

            <div className="ct-summary">
              מציג <b>{rows.length}</b> מתוך {state.items.length} מוצרים · {totalUses.toLocaleString('he-IL')} שימושים בסך הכל
            </div>

            <div className="ct-tablewrap">
              <table className="ct-table">
                <thead>
                  <tr>
                    {COLS.map(([key, label, numeric]) => (
                      <th
                        key={key}
                        className={numeric ? 'num' : ''}
                        onClick={() => toggleSort(key)}
                        aria-sort={sort.col === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {label}
                        {sortArrow(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={COLS.length} className="ct-empty">אין מוצרים תואמים.</td>
                    </tr>
                  ) : (
                    rows.map((it) => (
                      <tr key={it._id} className={it.fat == null || it.protein == null ? 'missing' : ''}>
                        <td className="ct-name">{it.name}</td>
                        <td>{it.unit || '—'}</td>
                        <td className="num">{fmt(it.carbs)}</td>
                        <td className="num">{fmt(it.fat)}</td>
                        <td className="num">{fmt(it.protein)}</td>
                        <td className="num ct-uses">{(Number(it.usedCount) || 0).toLocaleString('he-IL')}</td>
                        <td className="num ct-date">{fmtDate(it.updatedAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="ct-foot">
              ערכים לכל יחידה בודדת. לחיצה על כותרת עמודה ממיינת. שדה החיפוש תומך בביטוי רגולרי כשמסמנים <code>regex</code>.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
