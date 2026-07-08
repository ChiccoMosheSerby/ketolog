import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import './AdminCatalog.scss';

// Admin-only "products map": the global learned-product catalog (every food item
// pulled from all users' logged meals, deduped by normalized name, with per-unit
// macros and an app-wide usage score), now with the optimization toolset:
// - "scan now" — the AI duplicate scan (manual-only; it never runs by itself)
//   that files merge REQUESTS. Nothing merges without the admin's approval.
// - merge requests panel — each request shows the phrase that would fold under
//   a main item; the admin approves (optionally flipping which side is the
//   main), or rejects (which teaches future scans a negative example).
// - manual curation — create a merge/rephrase directly, or create a whole
//   catalog product with hand-calculated values; both survive backfills.
// - each item's folded rephrasings show as read-only chips right in its row;
//   a match on any of them makes the meal resolver pick that item with no AI
//   call. Editing them = editing the phrases field in the item's product card.

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
  ['lastUsed', 'שימוש אחרון', true],
];

// Days since a date, for the "old vs still useful" read. Infinity if unknown.
function ageDays(d) {
  if (!d) return Infinity;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}
const STALE_DAYS = 120; // not logged in ~4 months → visibly stale

const EMPTY_ITEM_FORM = { name: '', label: '', unit: '', carbs: '', fat: '', protein: '', phrases: '' };

// Renders as a modal (open/onClose) or, with `page`, as the standalone /admin
// route — same content, no scrim, full width.
export default function AdminCatalog({ open = true, onClose, page = false }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });
  const [optimize, setOptimize] = useState({ running: false, lastRun: null, pendingCount: 0 });
  const [resolverOn, setResolverOn] = useState(false);
  const [merges, setMerges] = useState([]);

  // filters
  const [q, setQ] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [minUses, setMinUses] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  // sort
  const [sort, setSort] = useState({ col: 'usedCount', dir: 'desc' });

  // optimization UI state
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { t, bad? } — inline status line
  const [showMerges, setShowMerges] = useState(false);
  const [flipped, setFlipped] = useState(() => new Set()); // merge ids where the admin flipped the main item
  const [selected, setSelected] = useState(() => new Set()); // item keys checked for a multi-select merge
  // form: null | { type: 'merge', canonical } | { type: 'item', editKey? , ...fields }
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    const d = await api.getAdminCatalog();
    setState({ status: 'ready', items: d.items || [], error: null });
    setOptimize(d.optimize || { running: false, lastRun: null, pendingCount: 0 });
    setResolverOn(!!d.resolverEnabled);
    const m = await api.getCatalogMerges('pending');
    setMerges(m.merges || []);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState({ status: 'loading', items: [], error: null });
    setMsg(null);
    setForm(null);
    load().catch((e) => alive && setState({ status: 'error', items: [], error: e.message }));
    return () => {
      alive = false;
    };
  }, [open, load]);

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
        const hay = `${it.name || ''} ${it.label || ''} ${it.unit || ''} ${(it.aliases || []).join(' ')}`;
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
      if (col === 'lastUsed') {
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
  const itemByKey = useMemo(() => new Map(state.items.map((it) => [it.key, it])), [state.items]);

  if (!open && !page) return null;

  const toggleSort = (col) =>
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
    );

  const sortArrow = (col) => (sort.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const { status, error } = state;

  // ---- optimization actions -------------------------------------------------

  async function toggleResolver() {
    const next = !resolverOn;
    setBusy(true);
    try {
      await api.setCatalogResolver(next);
      setResolverOn(next);
      setMsg({
        t: next
          ? 'חישוב מהקטלוג הופעל — ארוחה שכל חלקיה מזוהים תחושב בלי AI'
          : 'חישוב מהקטלוג כובה — האפליקציה מתנהגת בדיוק כמו לפני הפיצ׳ר',
      });
    } catch (e) {
      setMsg({ t: 'שינוי המתג נכשל: ' + e.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function doScan() {
    setBusy(true);
    setMsg({ t: 'סורק כפילויות… (עשוי לקחת עד דקה)' });
    try {
      const r = await api.scanCatalog();
      if (r.running) setMsg({ t: 'סריקה כבר רצה — נסו שוב עוד רגע' });
      else setMsg({ t: `נבדקו ${r.clusters} אשכולות · ${r.proposed} בקשות חדשות · ${r.flagged} פריטים סומנו` });
      await load();
      setShowMerges(true);
    } catch (e) {
      setMsg({ t: 'הסריקה נכשלה: ' + e.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function decide(m, decision) {
    setBusy(true);
    try {
      const isFlipped = flipped.has(m._id);
      await api.resolveCatalogMerge(m._id, decision, decision === 'approve' && isFlipped ? m.aliasKey : undefined);
      setMsg({ t: decision === 'approve' ? 'המיזוג אושר והוחל' : 'הבקשה נדחתה (תשמש כדוגמה שלילית)' });
      await load();
    } catch (e) {
      setMsg({ t: 'הפעולה נכשלה: ' + e.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitMerge(e) {
    e.preventDefault();
    const canonical = String(form.canonical || '').trim();
    const phrases = String(form.phrases || '')
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!canonical || !phrases.length) return;
    setBusy(true);
    try {
      await api.createCatalogMerge(canonical, phrases);
      setMsg({ t: `נוספו ${phrases.length} ניסוחים תחת "${canonical}"` });
      setForm(null);
      setSelected(new Set());
      await load();
    } catch (err) {
      setMsg({ t: 'המיזוג נכשל: ' + err.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitItem(e) {
    e.preventDefault();
    const f = form;
    if (!String(f.name || '').trim()) return;
    setBusy(true);
    try {
      const macros = {
        carbs: f.carbs === '' ? 0 : Number(f.carbs),
        fat: f.fat === '' ? null : Number(f.fat),
        protein: f.protein === '' ? null : Number(f.protein),
      };
      if (f.editKey) {
        await api.updateCatalogItem(f.editKey, { name: f.name, label: f.label, unit: f.unit, ...macros, reviewNote: '' });
        // the phrases input IS the rephrase manager: diff it against the item's
        // current aliases — removed ones detach, new ones fold under the item
        const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
        const prev = itemByKey.get(f.editKey)?.aliases || [];
        const next = String(f.phrases || '').split(/[,\n]/).map(norm).filter(Boolean);
        const nextSet = new Set(next);
        const prevSet = new Set(prev);
        const toRemove = prev.filter((a) => !nextSet.has(a));
        const toAdd = next.filter((a) => !prevSet.has(a));
        for (const a of toRemove) await api.removeCatalogAlias(a);
        if (toAdd.length) await api.createCatalogMerge(f.editKey, toAdd);
        setMsg({ t: `"${f.name}" עודכן וסומן כמאומת` });
      } else {
        await api.createCatalogItem({
          name: f.name,
          label: f.label,
          unit: f.unit,
          ...macros,
          phrases: String(f.phrases || '')
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        });
        setMsg({ t: `"${f.name}" נוסף לקטלוג` });
      }
      setForm(null);
      await load();
    } catch (err) {
      setMsg({ t: 'השמירה נכשלה: ' + err.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  const toggleSelected = (key) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Multi-select → merge: the checked items become the phrases; the main-name
  // field is pre-filled with the most-used of them, but the admin defines it
  // freely — including a brand-new name (the server seeds it from the top
  // donor's values and folds the rest under it).
  function mergeSelected() {
    const keys = [...selected];
    const best = keys
      .map((k) => itemByKey.get(k))
      .filter(Boolean)
      .sort((a, b) => (b.usedCount || 0) - (a.usedCount || 0))[0];
    setForm({
      type: 'merge',
      fromSelection: true,
      canonical: best?.key || keys[0] || '',
      phrases: keys.join(', '),
    });
  }

  const toggleFlip = (id) =>
    setFlipped((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Bulk delete of the checked rows: one confirm for the whole batch, then the
  // per-item endpoint for each; a failure doesn't stop the rest of the batch.
  async function deleteSelected() {
    const keys = [...selected];
    const aliasCount = keys.reduce((s, k) => s + (itemByKey.get(k)?.aliases || []).length, 0);
    const warn = aliasCount ? `\n${aliasCount} ניסוחים מקופלים ישוחררו ויחזרו להיות עצמאיים.` : '';
    if (!window.confirm(`למחוק ${keys.length} מוצרים מהקטלוג?${warn}`)) return;
    setBusy(true);
    try {
      const failed = [];
      for (const k of keys) {
        try {
          await api.deleteCatalogItem(k);
        } catch {
          failed.push(k);
        }
      }
      setMsg(
        failed.length
          ? { t: `נמחקו ${keys.length - failed.length} מתוך ${keys.length} · נכשלו: ${failed.join(', ')}`, bad: true }
          : { t: `נמחקו ${keys.length} מוצרים מהקטלוג` }
      );
      setSelected(new Set());
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Delete an item outright. Its folded rephrasings become independent again;
  // the food reappears only if someone logs it again (or a backfill runs).
  async function deleteItem(it) {
    const n = (it.aliases || []).length;
    const warn = n ? `\n${n} ניסוחים מקופלים ישוחררו ויחזרו להיות עצמאיים.` : '';
    if (!window.confirm(`למחוק את "${it.name}" מהקטלוג?${warn}`)) return;
    setBusy(true);
    try {
      await api.deleteCatalogItem(it.key);
      setMsg({ t: `"${it.name}" נמחק מהקטלוג` });
      setSelected((s) => {
        if (!s.has(it.key)) return s;
        const next = new Set(s);
        next.delete(it.key);
        return next;
      });
      await load();
    } catch (e) {
      setMsg({ t: 'המחיקה נכשלה: ' + e.message, bad: true });
    } finally {
      setBusy(false);
    }
  }

  const openItemForm = (it) =>
    setForm(
      it
        ? {
            type: 'item',
            editKey: it.key,
            name: it.name || it.key,
            label: it.label || '',
            unit: it.unit || '',
            carbs: it.carbs ?? '',
            fat: it.fat ?? '',
            protein: it.protein ?? '',
            phrases: (it.aliases || []).join(', '),
          }
        : { type: 'item', ...EMPTY_ITEM_FORM }
    );

  // The product form, defined once: rendered above the table when creating a
  // manual product, and inline under the product's own row (a product card)
  // when editing. The phrases input manages the rephrasings: it opens with the
  // current ones, and on save the diff is applied (added → merge, removed →
  // detach) — see submitItem.
  const itemForm = form?.type === 'item' && (
    <form className={'ct-form' + (form.editKey ? ' ct-editcard' : '')} onSubmit={submitItem}>
      <div className="ct-formtitle">
        {form.editKey ? `עריכת "${form.editKey}"` : 'מוצר ידני — ערכים ליחידה אחת'}
      </div>
      <div className="ct-formgrid">
        <label>
          שם
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          יחידה
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="פרוסה / כף / מנה" />
        </label>
        <label>
          פחמ' נטו
          <input type="number" step="any" min="0" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: e.target.value })} />
        </label>
        <label>
          שומן
          <input type="number" step="any" min="0" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })} />
        </label>
        <label>
          חלבון
          <input type="number" step="any" min="0" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })} />
        </label>
      </div>
      <label>
        תיאור (אופציונלי)
        <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </label>
      <label>
        {form.editKey
          ? 'ניסוחים (מופרדים בפסיק) — מחיקה מהרשימה מנתקת, הוספה מקפלת תחת המוצר'
          : 'ניסוחים נוספים (מופרדים בפסיק, אופציונלי)'}
        <input
          value={form.phrases || ''}
          onChange={(e) => setForm({ ...form, phrases: e.target.value })}
          placeholder="כינויים שיתקפלו תחת המוצר"
        />
      </label>
      <div className="ct-formacts">
        <button className="ct-btn primary" type="submit" disabled={busy}>
          {form.editKey ? 'עדכן' : 'הוסף לקטלוג'}
        </button>
        <button className="ct-btn" type="button" onClick={() => setForm(null)}>ביטול</button>
      </div>
    </form>
  );

  const body = (
    <div
      className={'ct-modal' + (page ? ' ct-aspage' : '')}
      role={page ? undefined : 'dialog'}
      aria-modal={page ? undefined : 'true'}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ct-head">
        <h2>מפת מוצרים</h2>
        {page ? (
          <a className="ct-back" href="/">⬅ חזרה ליומן</a>
        ) : (
          <button className="ct-close" aria-label="סגור" onClick={onClose}>✕</button>
        )}
      </div>

        {status === 'loading' && <div className="ct-note">טוען מפת מוצרים…</div>}
        {status === 'error' && (
          <div className="ct-note">טעינת המפה נכשלה{error ? ` (${error})` : ''}.</div>
        )}

        {status === 'ready' && (
          <>
            <div className="ct-actionbar">
              <button
                className={'ct-toggle' + (resolverOn ? ' on' : '')}
                onClick={toggleResolver}
                disabled={busy}
                title="כשהמתג כבוי האפליקציה מחשבת ארוחות בדיוק כמו לפני הפיצ׳ר (ללא עזרת הקטלוג)"
              >
                <span className="ct-knob" />
                חישוב מהקטלוג: {resolverOn ? 'פעיל' : 'כבוי'}
              </button>
              <button className="ct-btn primary" onClick={doScan} disabled={busy || optimize.running}>
                🔍 סרוק כפילויות
              </button>
              <button
                className={'ct-btn' + (showMerges ? ' active' : '')}
                onClick={() => setShowMerges((v) => !v)}
              >
                בקשות מיזוג {merges.length ? <b>({merges.length})</b> : '(0)'}
              </button>
              <button
                className={'ct-btn' + (form?.type === 'merge' ? ' active' : '')}
                onClick={() => setForm(form?.type === 'merge' ? null : { type: 'merge', canonical: '', phrases: '' })}
              >
                ➕ מיזוג / ניסוח ידני
              </button>
              <button
                className={'ct-btn' + (form?.type === 'item' && !form.editKey ? ' active' : '')}
                onClick={() => (form?.type === 'item' && !form.editKey ? setForm(null) : openItemForm(null))}
              >
                ➕ מוצר ידני
              </button>
              {selected.size >= 2 && (
                <button className="ct-btn primary" onClick={mergeSelected} disabled={busy}>
                  🔗 מזג נבחרים ({selected.size})
                </button>
              )}
              {selected.size > 0 && (
                <button className="ct-btn danger" onClick={deleteSelected} disabled={busy}>
                  🗑 מחק נבחרים ({selected.size})
                </button>
              )}
              {selected.size > 0 && (
                <button className="ct-btn" onClick={() => setSelected(new Set())} disabled={busy}>
                  נקה בחירה
                </button>
              )}
              {optimize.lastRun?.at && (
                <span className="ct-scanstat">
                  סריקה אחרונה: {fmtDate(optimize.lastRun.at)}
                </span>
              )}
            </div>

            {msg && <div className={'ct-msg' + (msg.bad ? ' bad' : '')}>{msg.t}</div>}

            {showMerges && (
              <div className="ct-merges">
                {merges.length === 0 ? (
                  <div className="ct-note">אין בקשות מיזוג ממתינות. הריצו סריקה כדי לאתר כפילויות.</div>
                ) : (
                  merges.map((m) => {
                    const isFlipped = flipped.has(m._id);
                    const mainKey = isFlipped ? m.aliasKey : m.canonicalKey;
                    const foldKey = isFlipped ? m.canonicalKey : m.aliasKey;
                    const mainIt = itemByKey.get(mainKey);
                    const foldIt = itemByKey.get(foldKey);
                    return (
                      <div className="ct-mergecard" key={m._id}>
                        <div className="ct-mergemain">
                          <div className="ct-mergepair">
                            <span className="ct-fold" title={`${foldIt?.usedCount ?? '?'} שימושים`}>
                              «{foldKey}»
                            </span>
                            <span className="ct-arrow">⬅ יתקפל תחת</span>
                            <span className="ct-canon" title={`${mainIt?.usedCount ?? '?'} שימושים`}>
                              «{mainKey}»
                            </span>
                          </div>
                          <div className="ct-mergemeta">
                            ביטחון {Math.round((m.confidence || 0) * 100)}%
                            {m.reason ? ` · ${m.reason}` : ''}
                            {m.macroFix ? ' · כולל תיקון ערכים מוצע' : ''}
                            {mainIt && foldIt
                              ? ` · שימושים: ${mainIt.usedCount ?? 0} ראשי / ${foldIt.usedCount ?? 0} נקפל`
                              : ''}
                          </div>
                        </div>
                        <div className="ct-mergeacts">
                          <button className="ct-btn ok" disabled={busy} onClick={() => decide(m, 'approve')}>
                            אשר
                          </button>
                          <button
                            className="ct-btn"
                            disabled={busy}
                            title="החלף מי הפריט הראשי לפני האישור"
                            onClick={() => toggleFlip(m._id)}
                          >
                            ⇄ החלף ראשי
                          </button>
                          <button className="ct-btn danger" disabled={busy} onClick={() => decide(m, 'reject')}>
                            דחה
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {form?.type === 'merge' && (
              <form className="ct-form" onSubmit={submitMerge}>
                <div className="ct-formtitle">
                  {form.fromSelection
                    ? 'מיזוג הנבחרים — כולם יהפכו לניסוחים תחת השם הראשי שתגדיר/י'
                    : 'מיזוג ידני — קיפול ניסוחים תחת פריט ראשי'}
                </div>
                <label>
                  השם הראשי (קיים או חדש)
                  <input
                    list="ct-keys"
                    value={form.canonical}
                    onChange={(e) => setForm({ ...form, canonical: e.target.value })}
                    placeholder="שם הפריט שיישאר (אפשר גם שם חדש לגמרי)"
                    required
                  />
                </label>
                <label>
                  ניסוחים לקיפול (מופרדים בפסיק)
                  <input
                    value={form.phrases}
                    onChange={(e) => setForm({ ...form, phrases: e.target.value })}
                    placeholder="למשל: קפה, אספרסו ארוך, מנה קפה שחור"
                    required
                  />
                </label>
                <div className="ct-formacts">
                  <button className="ct-btn primary" type="submit" disabled={busy}>מזג</button>
                  <button className="ct-btn" type="button" onClick={() => setForm(null)}>ביטול</button>
                </div>
                <datalist id="ct-keys">
                  {state.items.map((it) => (
                    <option key={it.key} value={it.key} />
                  ))}
                </datalist>
              </form>
            )}

            {form?.type === 'item' && !form.editKey && itemForm}

            <div className="ct-controls">
              <div className="ct-search">
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={useRegex ? 'ביטוי רגולרי… (למשל ^חביתה)' : 'חיפוש בשם / יחידה / ניסוח…'}
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
              {optimize.pendingCount > 0 && (
                <> · <b className="ct-pending">{optimize.pendingCount}</b> בקשות מיזוג ממתינות</>
              )}
            </div>

            <div className="ct-tablewrap">
              <table className="ct-table">
                <thead>
                  <tr>
                    <th className="ct-selth" title="בחירה למיזוג" />
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
                    <th className="ct-actth" aria-label="פעולות" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={COLS.length + 2} className="ct-empty">אין מוצרים תואמים.</td>
                    </tr>
                  ) : (
                    rows.map((it) => {
                      const stale = ageDays(it.lastUsed) > STALE_DAYS;
                      const hasAliases = (it.aliases || []).length > 0;
                      const isSel = selected.has(it.key);
                      const isEditing = form?.type === 'item' && form.editKey === it.key;
                      return [
                        <tr
                          key={it._id}
                          className={
                            (it.fat == null || it.protein == null ? 'missing' : '') + (isSel ? ' sel' : '')
                          }
                          onClick={() => (isEditing ? setForm(null) : openItemForm(it))}
                        >
                          <td className="ct-selcell" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={() => toggleSelected(it.key)}
                              aria-label={`בחר את ${it.name} למיזוג`}
                            />
                          </td>
                          <td className="ct-name">
                            <span className="ct-nm">
                              {it.name}
                              {it.verified && <span className="ct-verified" title="מאומת על ידי מנהל">✓</span>}
                            </span>
                            {it.label && <span className="ct-lbl">{it.label}</span>}
                            {it.reviewNote && <span className="ct-flagnote">⚠ {it.reviewNote}</span>}
                            {hasAliases && (
                              <span className="ct-rowaliases">
                                {it.aliases.map((a) => (
                                  <span className="ct-alias" key={a}>{a}</span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td>{it.unit || '—'}</td>
                          <td className="num">{fmt(it.carbs)}</td>
                          <td className="num">{fmt(it.fat)}</td>
                          <td className="num">{fmt(it.protein)}</td>
                          <td className="num ct-uses">{(Number(it.usedCount) || 0).toLocaleString('he-IL')}</td>
                          <td className={'num ct-date' + (stale ? ' stale' : '')} title={stale ? 'לא נרשם זמן רב' : ''}>
                            {fmtDate(it.lastUsed)}
                          </td>
                          <td className="ct-rowacts" onClick={(e) => e.stopPropagation()}>
                            <button title="ערוך ערכים" onClick={() => (isEditing ? setForm(null) : openItemForm(it))}>✎</button>
                            <button
                              title="קפל ניסוחים תחת הפריט הזה"
                              onClick={() => setForm({ type: 'merge', canonical: it.key, phrases: '' })}
                            >
                              🔗
                            </button>
                            <button
                              className="ct-del"
                              title="מחק מהקטלוג"
                              disabled={busy}
                              onClick={() => deleteItem(it)}
                            >
                              🗑
                            </button>
                          </td>
                        </tr>,
                        isEditing && (
                          <tr key={it._id + ':edit'} className="ct-editrow">
                            <td colSpan={COLS.length + 2}>{itemForm}</td>
                          </tr>
                        ),
                      ];
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="ct-foot">
              ערכים לכל יחידה בודדת. לחיצה על כותרת עמודה ממיינת. שדה החיפוש תומך בביטוי רגולרי כשמסמנים <code>regex</code>.
              ארוחה שכל חלקיה מזוהים בקטלוג (בשמם או באחד הניסוחים) מחושבת מהקטלוג — בלי AI.
            </div>
          </>
        )}
    </div>
  );

  if (page) return <div className="ct-page">{body}</div>;
  return (
    <div className="ct-scrim" onClick={onClose}>
      {body}
    </div>
  );
}
