import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fmt } from "../lib/helpers.js";
import { DEFAULT_CAT } from "../lib/categories.js";
import "./ProductPicker.scss";

const SORT_KEY = "ketolog:pickerSort";
const SORTS = [
  { id: "usage", label: "לפי שימוש" },
  { id: "carbs", label: "לפי פחמימות" },
  { id: "name", label: "א־ב" },
];

// Products whose name/label reads like a drink get their own משקאות category
// (unless the user gave the product an explicit category of its own).
const DRINK_RE =
  /(קפה|תה|משקה|מים|סודה|יין|בירה|מיץ|קולה|שתיה|שתייה|שוקו|לימונדה|אספרסו|קפוצ|לאטה|זירו)/;

const STARRED_CAT = "⭐ מועדפים";
const TEMPLATES_CAT = "ארוחות שמורות";

function catOf(p) {
  const c = (p.cat || "").trim();
  if (c && c !== DEFAULT_CAT) return c;
  if (DRINK_RE.test(`${p.key || ""} ${p.label || ""}`)) return "משקאות";
  return c || DEFAULT_CAT;
}

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
  // tapping the same row again, another row, or the background closes it)
  const [openInfoId, setOpenInfoId] = useState("");
  const toggleInfo = (id) =>
    setOpenInfoId((prev) => (prev === id ? "" : id));

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

  const groups = useMemo(() => {
    const by = new Map();
    for (const p of products || []) {
      const cat = catOf(p);
      if (!by.has(cat)) by.set(cat, []);
      by.get(cat).push(p);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "he"))
      .map(([cat, list]) => [cat, sortItems(list)]);
  }, [products, sortItems]);

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
      className={"picker-item" + (openInfoId === p._id ? " open" : "")}
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
          toggleInfo(p._id);
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
      className={"picker-item" + (openInfoId === t._id ? " open" : "")}
      key={t._id}
    >
      <button
        type="button"
        className="pi-main"
        onClick={(e) => {
          e.stopPropagation();
          toggleInfo(t._id);
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

        <div className="picker-body" onClick={() => setOpenInfoId("")}>
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
                renderGroup(cat, list.map(productRow), list.length),
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
            {canRepeat && (
              <button
                className="btn ghost mini"
                onClick={onRepeatYesterday}
                title="העתק את כל ארוחות אתמול ליום הנבחר"
              >
                ⟳ שכפל את ארוחות אתמול
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
