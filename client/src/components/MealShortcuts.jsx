import { fmt } from '../lib/helpers.js';
import './MealShortcuts.scss';

// Quick ways to log without retyping: repeat yesterday's meals, or add a saved
// template with one click. Templates are created from the day card ("שמור כתבנית").
export default function MealShortcuts({ templates, onApply, onDelete, onRepeatYesterday, canRepeat }) {
  return (
    <div className="panel shortcuts">
      <div className="sc-head">
        <h2>תבניות וקיצורים</h2>
        <button
          className="btn ghost mini"
          disabled={!canRepeat}
          onClick={onRepeatYesterday}
          title={canRepeat ? 'העתק את כל ארוחות אתמול ליום הנבחר' : 'אין ארוחות מאתמול לשכפול'}
        >
          ⟳ שכפל את אתמול
        </button>
      </div>

      <div className="sc-hint">
        קליק על תבנית מוסיף אותה ליום הנבחר. ליצירת תבנית — בכרטיס היום, ליד ארוחה, "★".
      </div>

      <div className="sc-tags">
        {templates.length === 0 ? (
          <span className="sc-empty">— אין תבניות שמורות עדיין</span>
        ) : (
          templates.map((t) => (
            <span className="sc-tag" key={t._id}>
              <button className="sc-add" onClick={() => onApply(t)} title="הוסף ליום הנבחר">
                <span className="plus">+</span>
                <span className="sc-name">{t.name}</span>
                <small>{fmt(t.carbs)} פחמ'</small>
              </button>
              <button className="sc-del" onClick={() => onDelete(t._id)} title="מחק תבנית">
                ✕
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
