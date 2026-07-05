import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  dayTotal, dayMacroGrams, macroPct, hasMacros, fmt, heDate, zoneInfo, maxRange, TARGET,
} from '../lib/helpers.js';
import './DayCard.scss';

export default function DayCard({
  iso,
  day,
  title,
  open,
  onToggle,
  onDeleteMeal,
  onSetMetric,
  onCopyMeal,
  onSaveTemplate,
  onSaveProduct,
  onSaveItemProduct,
  target = TARGET,
}) {
  const { t } = useTranslation();
  const mt = day.metrics || {};
  const [weight, setWeight] = useState(mt.weight || '');
  const [status, setStatus] = useState(mt.status || '');

  const total = dayTotal(day);
  const zi = zoneInfo(total, target);
  const maxr = maxRange(target);
  const meals = [...(day.meals || [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const g = dayMacroGrams(day);
  const mp = macroPct(g);

  return (
    <div className={'day' + (open ? ' open' : '')}>
      <button className="day-head" onClick={onToggle} aria-expanded={open}>
        <span className="day-htext">
          <span className="day-title">{title || day.label || iso}</span>
          <span className="day-date">{heDate(iso)}</span>
        </span>
        <span className="day-hright">
          <span className="day-total" style={{ color: zi.color }}>
            {fmt(total)} <small>{t('dayCard.netGrams')}</small>
          </span>
          <span className="chev"></span>
        </span>
      </button>

      <div className="meter">
        <span style={{ width: zi.pct + '%', background: zi.color }}></span>
        <i className="meter-mark" title={t('dayCard.targetLimit', { value: fmt(target) })}></i>
      </div>
      <div className="meter-scale">
        <span className="s0">0</span>
        <span className="s20">{t('dayCard.targetLabel', { value: fmt(target) })}</span>
        <span className="s50">{fmt(maxr)}</span>
      </div>
      <div className="meter-cap">{zi.cap}</div>

      {open && (
        <div className="day-body">
          {hasMacros(day) && mp ? (
            <div className="macro">
              <div className="macro-bar">
                <i style={{ width: mp.fat + '%', background: 'var(--olive)' }}></i>
                <i style={{ width: mp.protein + '%', background: 'var(--protein)' }}></i>
                <i style={{ width: mp.carb + '%', background: 'var(--amber)' }}></i>
              </div>
              <div className="macro-legend">
                <span>
                  <span className="dot" style={{ background: 'var(--olive)' }}></span>{t('dayCard.macroFat')}{' '}
                  <b>{mp.fat}%</b> · {t('dayCard.grams', { value: fmt(g.fat) })}
                </span>
                <span>
                  <span className="dot" style={{ background: 'var(--protein)' }}></span>{t('dayCard.macroProtein')}{' '}
                  <b>{mp.protein}%</b> · {t('dayCard.grams', { value: fmt(g.protein) })}
                </span>
                <span>
                  <span className="dot" style={{ background: 'var(--amber)' }}></span>{t('dayCard.macroCarb')}{' '}
                  <b>{mp.carb}%</b> · {t('dayCard.grams', { value: fmt(g.carb) })}
                </span>
                <span style={{ marginInlineStart: 'auto' }}>{t('dayCard.kcal', { value: mp.kcal })}</span>
              </div>
            </div>
          ) : (
            <div className="macro-na">{t('dayCard.macroNa')}</div>
          )}

          <div className="meals">
            {meals.length === 0 ? (
              <div className="desc" style={{ padding: '10px 0', color: 'var(--ink-soft)' }}>
                {t('dayCard.noMeals')}
              </div>
            ) : (
              meals.map((m) => {
                const items = Array.isArray(m.items) ? m.items : [];
                return (
                <div className="meal" key={m._id}>
                  <div className="time">{m.time || '--:--'}</div>
                  <div className="body">
                    <div className="desc">{m.desc || m.cat}</div>
                    {items.length > 0 && (
                      <ul className="meal-items">
                        {items.map((it, i) => (
                          <li key={i}>
                            <span className="mi-name">
                              {it.qty > 1 && <b className="mi-qty">{fmt(it.qty)}×</b>} {it.name}
                            </span>
                            <span className="mi-carb">
                              {t('dayCard.grams', { value: fmt((Number(it.carbs) || 0) * (it.qty || 1)) })}
                            </span>
                            {onSaveItemProduct && (
                              <button
                                className="mi-save"
                                title={t('dayCard.saveToProducts')}
                                onClick={() => onSaveItemProduct(it)}
                              >
                                📦
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="carb">{t('dayCard.grams', { value: fmt(Number(m.carbs) || 0) })}</div>
                  <div className="meal-acts">
                    {onSaveTemplate && (
                      <button className="mact" title={t('dayCard.saveTemplate')} onClick={() => onSaveTemplate(m)}>
                        ★
                      </button>
                    )}
                    {onSaveProduct && (
                      <button
                        className="mact"
                        title={t('dayCard.saveToProducts')}
                        onClick={() => onSaveProduct(m)}
                      >
                        📦
                      </button>
                    )}
                    {onCopyMeal && (
                      <button className="mact" title={t('dayCard.copyToDay')} onClick={() => onCopyMeal(m)}>
                        ⧉
                      </button>
                    )}
                    <button className="del" title={t('dayCard.deleteMeal')} onClick={() => onDeleteMeal(iso, m._id)}>
                      ✕
                    </button>
                  </div>
                </div>
                );
              })
            )}
          </div>

          <div className="metrics">
            <div className="mlabel">{t('dayCard.metricsTitle')}</div>
            <div className="mrow">
              <div className="mfld">
                <label>{t('dayCard.weightLabel')}</label>
                <input
                  type="number"
                  step="0.1"
                  placeholder="–"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  onBlur={() => onSetMetric(iso, 'weight', weight)}
                />
              </div>
              <label className="mfld">
                <input
                  type="checkbox"
                  checked={!!mt.run}
                  onChange={(e) => onSetMetric(iso, 'run', e.target.checked)}
                />{' '}
                {t('dayCard.run10min')}
              </label>
              <label className="mfld">
                <input
                  type="checkbox"
                  checked={!!mt.abs}
                  onChange={(e) => onSetMetric(iso, 'abs', e.target.checked)}
                />{' '}
                {t('dayCard.abs5min')}
              </label>
            </div>
            <div className="status">
              <textarea
                placeholder={t('dayCard.statusPlaceholder')}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                onBlur={() => onSetMetric(iso, 'status', status)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
