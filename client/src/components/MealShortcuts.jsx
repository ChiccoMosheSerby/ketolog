import { useState } from 'react';
import { fmt } from '../lib/helpers.js';
import { useMediaQuery, MOBILE_QUERY } from '../lib/useMediaQuery.js';
import './MealShortcuts.scss';

// Compact, foldable quick-add tags shown under the description input: saved
// products + meal templates + "repeat yesterday". A click adds the item to the
// description above. Minimal styling — it lives inside the Add-Meal panel.
export default function MealShortcuts({
  products,
  templates,
  onApplyProduct,
  onApplyTemplate,
  onDeleteTemplate,
  onRepeatYesterday,
  canRepeat,
}) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [open, setOpen] = useState(!isMobile);
  const count = (products?.length || 0) + (templates?.length || 0);

  return (
    <div className="shortcuts" data-tour="shortcuts">
      <button
        className={'sc-head' + (open ? ' open' : '')}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="chev"></span>
        קיצורים מהירים
        {count > 0 && <span className="sc-count">{count}</span>}
      </button>

      {open && (
        <div className="sc-body">
          <div className="sc-group">
            <div className="sc-glabel">המוצרים שלי</div>
            <div className="sc-row">
              {!products || products.length === 0 ? (
                <span className="sc-empty">— הוסיפו בלשונית "המוצרים שלי"</span>
              ) : (
                products.map((p) => (
                  <button
                    className="sc-chip"
                    key={p._id}
                    onClick={() => onApplyProduct(p)}
                    title="הוסף לפירוט"
                  >
                    <span className="plus">+</span>
                    {p.unit} {p.key}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="sc-group">
            <div className="sc-glabel">תבניות שמורות</div>
            <div className="sc-row">
              {!templates || templates.length === 0 ? (
                <span className="sc-empty">— צרו תבנית מ-"★" שליד ארוחה</span>
              ) : (
                templates.map((t) => (
                  <span className="sc-chip-wrap" key={t._id}>
                    <button className="sc-chip" onClick={() => onApplyTemplate(t)} title="הוסף לפירוט">
                      <span className="plus">+</span>
                      {t.name}
                      <small>{fmt(t.carbs)} פחמ'</small>
                    </button>
                    <button
                      className="sc-del"
                      onClick={() => onDeleteTemplate(t._id)}
                      title="מחק תבנית"
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {canRepeat && (
            <button className="sc-repeat" onClick={onRepeatYesterday} title="העתק את כל ארוחות אתמול ליום הנבחר">
              ⟳ שכפל את כל ארוחות אתמול
            </button>
          )}
        </div>
      )}
    </div>
  );
}
