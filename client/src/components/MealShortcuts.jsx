import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        {t('mealShortcuts.title')}
        {count > 0 && <span className="sc-count">{count}</span>}
      </button>

      {open && (
        <div className="sc-body">
          <div className="sc-group">
            <div className="sc-glabel">{t('mealShortcuts.myProducts')}</div>
            <div className="sc-row">
              {!products || products.length === 0 ? (
                <span className="sc-empty">{t('mealShortcuts.emptyProducts')}</span>
              ) : (
                [...products]
                  .sort((a, b) => (Number(a.carbs) || 0) - (Number(b.carbs) || 0))
                  .map((p) => (
                  <button
                    className="sc-chip"
                    key={p._id}
                    onClick={() => onApplyProduct(p)}
                    title={t('mealShortcuts.addToDetail')}
                  >
                    <span className="plus">+</span>
                    {p.unit} {p.key}
                    <small>{fmt(p.carbs)}</small>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="sc-group">
            <div className="sc-glabel">{t('mealShortcuts.savedTemplates')}</div>
            <div className="sc-row">
              {!templates || templates.length === 0 ? (
                <span className="sc-empty">{t('mealShortcuts.emptyTemplates')}</span>
              ) : (
                templates.map((tpl) => (
                  <span className="sc-chip-wrap" key={tpl._id}>
                    <button className="sc-chip" onClick={() => onApplyTemplate(tpl)} title={t('mealShortcuts.addToDetail')}>
                      <span className="plus">+</span>
                      {tpl.name}
                      <small>{t('mealShortcuts.carbsShort', { carbs: fmt(tpl.carbs) })}</small>
                    </button>
                    <button
                      className="sc-del"
                      onClick={() => onDeleteTemplate(tpl._id)}
                      title={t('mealShortcuts.deleteTemplate')}
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {canRepeat && (
            <button className="sc-repeat" onClick={onRepeatYesterday} title={t('mealShortcuts.repeatTitle')}>
              {t('mealShortcuts.repeatButton')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
