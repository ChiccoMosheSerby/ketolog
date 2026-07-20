import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fmt } from "../lib/helpers.js";
import { DEFAULT_CAT, DEFAULT_CATS, loadCats, addCat } from "../lib/categories.js";
import "./ProductPicker.scss";

const SORT_KEY = "ketolog:pickerSort";
const SORTS = [
  { id: "usage", label: "לפי שימוש" },
  { id: "carbs", label: "לפי פחמימות" },
  { id: "name", label: "א־ב" },
];

const STARRED_CAT = "⭐ מועדפים";
const TEMPLATES_CAT = "ארוחות שמורות";
const NEW_CAT = "__new__"; // sentinel option: prompt for a fresh category name

// Group strictly by the product's own category — every product carries an
// explicit `cat` (the server defaults it on create), so no name-based guessing
// here: guessing filed "טונה במים" under משקאות because of the "מים".
const catOf = (p) => (p.cat || "").trim() || DEFAULT_CAT;

// Popup catalog of the user's saved products + saved meals (templates),
// grouped into foldable categories (folded by default; starred favorites are
// pinned open on top). Includes a search filter, star / delete per product,
// and a sort (per category) that persists per device.
export default function ProductPicker({
  products,
  templates,
  usage, // Map<name, times logged> — drives the "לפי שימוש" sort
  desc,
  onApplyProduct,
  onApplyTemplate,
  onClear,
  onUpdateProduct,
  onDeleteProduct,
  onDeleteTemplate,
  onRepeatYesterday,
  canRepeat,
  onClose,
}) {
  const [sort, setSort] = useState(
    () => localStorage.getItem(SORT_KEY) || "usage",
  );
  const [query, setQuery] = useState("");
  // categories start folded — only favorites and what the user opens are open
  const [openCats, setOpenCats] = useState(() => new Set([STARRED_CAT]));
  // the row whose details tooltip is open (tap toggles; only one at a time —
  // tapping the same row again, another row, or the background closes it).
  // `below` flips the bubble under the row when the row sits near the top of
  // the scrolling list — otherwise the scroll container clips the tooltip.
  const [openInfo, setOpenInfo] = useState({ id: "", below: false });
  const openInfoId = openInfo.id;
  const toggleInfo = (id, e) => {
    const row = e.currentTarget.closest(".picker-item");
    const body = e.currentTarget.closest(".picker-body");
    const spaceAbove =
      row && body
        ? row.getBoundingClientRect().top - body.getBoundingClientRect().top
        : Infinity;
    setOpenInfo((prev) =>
      prev.id === id ? { id: "", below: false } : { id, below: spaceAbove < 110 },
    );
  };

  function switchSort(id) {
    setSort(id);
    localStorage.setItem(SORT_KEY, id);
  }

  function toggleCat(cat) {
    setOpenCats((prev) => {
      const s = new Set(prev);
      if (s.has(cat)) s.delete(cat);
      else s.add(cat);
      return s;
    });
  }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const uses = (name) => usage?.get((name || "").trim()) || 0;

  // The active sort orders items INSIDE each category; the category grouping
  // itself is fixed (alphabetical), so items never jump between groups.
  const sortItems = useMemo(() => {
    const byName = (a, b) =>
      (a.key || a.name || "").localeCompare(b.key || b.name || "", "he");
    if (sort === "carbs")
      return (list) =>
        [...list].sort(
          (a, b) => (Number(a.carbs) || 0) - (Number(b.carbs) || 0) || byName(a, b),
        );
    if (sort === "usage")
      return (list) =>
        [...list].sort(
          (a, b) => uses(b.key || b.name) - uses(a.key || a.name) || byName(a, b),
        );
    return (list) => [...list].sort(byName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, usage]);

  const starred = useMemo(
    () => sortItems((products || []).filter((p) => p.starred)),
    [products, sortItems],
  );

  // category choices for the move-to-category select (defaults + custom + in-use)
  const [cats, setCats] = useState(() => loadCats(products || []));
  useEffect(() => setCats(loadCats(products || [])), [products]);

  // Standalone "create category" (footer button): adds it to the catalog and
  // an empty group shows up right away — products move in via their select.
  function createCat() {
    const name = (window.prompt("שם הקטגוריה החדשה:") || "").trim();
    if (!name) return;
    addCat(name);
    setCats(loadCats(products || []));
    setOpenCats((prev) => new Set(prev).add(name));
  }

  const groups = useMemo(() => {
    const by = new Map();
    // custom categories keep a group even when empty — so a freshly created
    // one is visible; empty defaults stay hidden to avoid clutter
    for (const c of cats) if (!DEFAULT_CATS.includes(c)) by.set(c, []);
    for (const p of products || []) {
      const cat = catOf(p);
      if (!by.has(cat)) by.set(cat, []);
      by.get(cat).push(p);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "he"))
      .map(([cat, list]) => [cat, sortItems(list)]);
  }, [products, sortItems, cats]);

  const sortedTemplates = useMemo(
    () => sortItems(templates || []),
    [templates, sortItems],
  );

  // Search: a match on the name or the full label, case/space tolerant.
  const q = query.trim();
  const matches = (s) => (s || "").includes(q);
  const foundProducts = q
    ? sortItems((products || []).filter((p) => matches(p.key) || matches(p.label)))
    : [];
  const foundTemplates = q
    ? sortItems((templates || []).filter((t) => matches(t.name) || matches(t.desc)))
    : [];

  function deleteProduct(p) {
    if (window.confirm(`למחוק את "${p.key}" מהמוצרים שלך?`)) onDeleteProduct(p._id);
  }

  const productRow = (p) => (
    <div
      className={
        "picker-item" +
        (openInfoId === p._id ? " open" + (openInfo.below ? " tip-below" : "") : "")
      }
      key={p._id}
    >
      {onUpdateProduct && (
        <button
          type="button"
          className={"pi-star" + (p.starred ? " on" : "")}
          title={p.starred ? "הסר ממועדפים" : "הוסף למועדפים — יוצג למעלה"}
          onClick={() => onUpdateProduct(p._id, { starred: !p.starred })}
        >
          {p.starred ? "★" : "☆"}
        </button>
      )}
      <button
        type="button"
        className="pi-main"
        onClick={(e) => {
          e.stopPropagation();
          toggleInfo(p._id, e);
        }}
      >
        {p.image ? (
          <img className="pi-thumb" src={p.image} alt="" loading="lazy" />
        ) : (
          <span className="pi-thumb pi-thumb-ph" aria-hidden="true">
            🍽️
          </span>
        )}
        <span className="pi-info">
          <span className="pi-name">
            {p.unit} {p.key}
          </span>
          <span className="pi-meta">
            <span className="pi-carb">{fmt(p.carbs)} פחמ'</span> · {fmt(p.fat)}{" "}
            שומן · {fmt(p.protein)} חלבון
            {uses(p.key) > 0 && (
              <span className="pi-uses"> · נרשם {uses(p.key)}×</span>
            )}
          </span>
        </span>
      </button>
      <span className="pi-tip" role="tooltip">
        <b>
          {p.unit} {p.key}
        </b>
        {p.label && p.label !== p.key && <span>{p.label}</span>}
        <span className="pi-tip-vals">
          <span className="pi-carb">{fmt(p.carbs)} פחמ'</span> · {fmt(p.fat)}{" "}
          שומן · {fmt(p.protein)} חלבון
        </span>
        {onUpdateProduct && (
          <label className="pi-tip-cat" onClick={(e) => e.stopPropagation()}>
            קטגוריה:
            <select
              value={catOf(p)}
              onChange={(e) => {
                let cat = e.target.value;
                if (cat === NEW_CAT) {
                  cat = (window.prompt("שם הקטגוריה החדשה:") || "").trim();
                  if (!cat) {
                    // canceled — no state change follows, so reset the DOM value
                    e.target.value = catOf(p);
                    return;
                  }
                  addCat(cat);
                }
                onUpdateProduct(p._id, { cat });
                setOpenInfo({ id: "", below: false });
              }}
            >
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={NEW_CAT}>+ קטגוריה חדשה…</option>
            </select>
          </label>
        )}
      </span>
      <button
        type="button"
        className="pi-add"
        title="הוסף לפירוט הארוחה"
        onClick={() => onApplyProduct(p)}
      >
        +
      </button>
      {onDeleteProduct && (
        <button
          type="button"
          className="pi-x"
          title="מחק מוצר"
          onClick={() => deleteProduct(p)}
        >
          ✕
        </button>
      )}
    </div>
  );

  const templateRow = (t) => (
    <div
      className={
        "picker-item" +
        (openInfoId === t._id ? " open" + (openInfo.below ? " tip-below" : "") : "")
      }
      key={t._id}
    >
      <button
        type="button"
        className="pi-main"
        onClick={(e) => {
          e.stopPropagation();
          toggleInfo(t._id, e);
        }}
      >
        <span className="pi-thumb pi-thumb-ph" aria-hidden="true">
          ⭐
        </span>
        <span className="pi-info">
          <span className="pi-name">{t.name}</span>
          <span className="pi-meta">
            <span className="pi-carb">{fmt(t.carbs)} פחמ'</span>
          </span>
        </span>
      </button>
      <span className="pi-tip" role="tooltip">
        <b>{t.name}</b>
        {t.desc && t.desc !== t.name && <span>{t.desc}</span>}
        <span className="pi-tip-vals">
          <span className="pi-carb">{fmt(t.carbs)} פחמ'</span>
        </span>
      </span>
      <button
        type="button"
        className="pi-add"
        title="הוסף לפירוט הארוחה"
        onClick={() => onApplyTemplate(t)}
      >
        +
      </button>
      <button
        type="button"
        className="pi-x"
        title="מחק תבנית"
        onClick={() => onDeleteTemplate(t._id)}
      >
        ✕
      </button>
    </div>
  );

  function renderGroup(cat, children, count, pinnedOpen = false) {
    const open = pinnedOpen || openCats.has(cat);
    return (
      <div className={"picker-group" + (open ? " open" : "")} key={cat}>
        <button
          type="button"
          className="picker-ghead"
          onClick={() => !pinnedOpen && toggleCat(cat)}
          aria-expanded={open}
        >
          <span className="picker-glabel">{cat}</span>
          <span className="picker-gright">
            <span className="picker-gcount">{count}</span>
            {!pinnedOpen && <span className="chev"></span>}
          </span>
        </button>
        {open && <div className="picker-list">{children}</div>}
      </div>
    );
  }

  return createPortal(
    <div className="picker-scrim" onClick={onClose}>
      <div
        className="picker-modal"
        role="dialog"
        aria-label="המוצרים והארוחות שלי"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          <div className="picker-htext">
            <span className="picker-title">המוצרים והארוחות שלי</span>
            <span className="picker-sub">
              קליק מוסיף לפירוט הארוחה · ★ מצמיד למעלה
            </span>
          </div>
          <button className="picker-close" title="סגירה" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="picker-tools">
          <input
            type="search"
            className="picker-search"
            placeholder="חיפוש מוצר או ארוחה…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="picker-sort" role="group" aria-label="מיון">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={"picker-sort-btn" + (sort === s.id ? " on" : "")}
                onClick={() => switchSort(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="picker-body"
          onClick={() => setOpenInfo({ id: "", below: false })}
        >
          {q ? (
            foundProducts.length === 0 && foundTemplates.length === 0 ? (
              <div className="picker-empty">לא נמצא כלום עבור "{q}".</div>
            ) : (
              <>
                {foundProducts.length > 0 &&
                  renderGroup(
                    "מוצרים",
                    foundProducts.map(productRow),
                    foundProducts.length,
                    true,
                  )}
                {foundTemplates.length > 0 &&
                  renderGroup(
                    TEMPLATES_CAT,
                    foundTemplates.map(templateRow),
                    foundTemplates.length,
                    true,
                  )}
              </>
            )
          ) : (
            <>
              {groups.length === 0 && sortedTemplates.length === 0 && (
                <div className="picker-empty">
                  אין עדיין מוצרים או ארוחות שמורות. מוסיפים מוצרים בפאנל
                  "המוצרים שלי", ותבניות מ-★ שליד ארוחה ביומן.
                </div>
              )}

              {starred.length > 0 &&
                renderGroup(
                  STARRED_CAT,
                  starred.map(productRow),
                  starred.length,
                  true,
                )}

              {groups.map(([cat, list]) =>
                renderGroup(
                  cat,
                  list.length ? (
                    list.map(productRow)
                  ) : (
                    <div className="picker-gempty">
                      אין מוצרים בקטגוריה — מעבירים אליה מוצר דרך חלון הפרטים
                      שלו (לחיצה על השורה).
                    </div>
                  ),
                  list.length,
                ),
              )}

              {sortedTemplates.length > 0 &&
                renderGroup(
                  TEMPLATES_CAT,
                  sortedTemplates.map(templateRow),
                  sortedTemplates.length,
                )}
            </>
          )}
        </div>

        <div className="picker-foot">
          <div className="picker-desc" title="פירוט הארוחה שנבנה עד כה">
            {desc?.trim() ? desc : "עדיין לא נבחר כלום…"}
          </div>
          <div className="picker-actions">
            <button
              className="btn ghost mini"
              onClick={createCat}
              title="הוספת קטגוריה חדשה לרשימה"
            >
              + קטגוריה חדשה
            </button>
            {canRepeat && (
              <button
                className="btn ghost mini"
                onClick={onRepeatYesterday}
                title="העתק את כל ארוחות אתמול ליום הנבחר"
              >
                ⟳ שכפל את ארוחות אתמול
              </button>
            )}
            {onClear && desc?.trim() && (
              <button
                className="btn ghost mini"
                onClick={onClear}
                title="נקה את פירוט הארוחה שנבנה"
              >
                ✕ נקה
              </button>
            )}
            <button className="btn mini" onClick={onClose}>
              סיום
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
