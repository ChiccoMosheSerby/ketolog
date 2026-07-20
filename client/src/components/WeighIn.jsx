import { useState } from 'react';
import { weightSeries } from '../lib/energyBalance.js';
import { fmt, heDate } from '../lib/helpers.js';
import './WeighIn.scss';

const RECOMMEND = 3; // half a week — the twice-weekly recommended cadence
const OVERDUE = 7; // a full week without a weigh-in — the prominent nudge
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Weigh-in card — the only place weight is entered. The user can weigh in any
// time; the recommended cadence is twice a week (same morning, after the
// bathroom, before coffee — consistent readings beat noisy daily ones). The
// card stays quiet while a weigh-in is fresh (just the last value + countdown),
// reopens the input once half a week has passed, and turns into a prominent
// prompt after a full week. The value is stored on today's day doc
// (metrics.weight), so history, exports and the TDEE math read it as-is.
export default function WeighIn({ days, today, onSave }) {
  const weights = weightSeries(days);
  const last = weights[weights.length - 1] || null;
  const prev = weights[weights.length - 2] || null;
  const daysSince = last ? daysBetween(last.date, today) : null;
  const recommended = !last || daysSince >= RECOMMEND;
  const due = !last || daysSince >= OVERDUE;

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editDate, setEditDate] = useState(null); // history row being edited
  const [editVal, setEditVal] = useState('');
  const open = recommended || editing;

  async function save() {
    const kg = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) return;
    setSaving(true);
    try {
      await onSave(today, String(kg));
      setVal('');
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(date) {
    const kg = parseFloat(String(editVal).replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) return;
    setSaving(true);
    try {
      await onSave(date, String(kg));
      setEditDate(null);
      setEditVal('');
    } finally {
      setSaving(false);
    }
  }

  const delta = last && prev ? Math.round((last.kg - prev.kg) * 10) / 10 : null;

  return (
    <div className={'weighin' + (due ? ' due' : '')}>
      <div className="wi-row">
        <span className="wi-ico" aria-hidden>⚖️</span>
        {open ? (
          <>
            <span className="wi-txt">
              <b>שקילה שבועית</b>
              <small>
                {last
                  ? `שקילה אחרונה: ${fmt(last.kg)} ק"ג · ${heDate(last.date)} · מומלץ לשקול פעמיים בשבוע`
                  : 'משקל בוקר — אחרי שירותים, לפני קפה, פעמיים בשבוע (למשל ראשון וחמישי)'}
              </small>
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="20"
              max="400"
              placeholder='ק"ג'
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button className="btn mini" onClick={save} disabled={saving || !val}>
              {saving ? 'שומר…' : 'שמור'}
            </button>
            {!recommended && (
              <button className="btn ghost mini" onClick={() => setEditing(false)}>
                ביטול
              </button>
            )}
          </>
        ) : (
          <>
            <span className="wi-txt">
              <b>
                {fmt(last.kg)} ק"ג
                {delta != null && delta !== 0 && (
                  <i className={'wi-delta ' + (delta < 0 ? 'good' : 'bad')}>
                    {delta > 0 ? '+' : ''}{fmt(delta)}
                  </i>
                )}
              </b>
              <small>
                נשקל {daysSince === 0 ? 'היום' : daysSince === 1 ? 'אתמול' : `לפני ${daysSince} ימים`} ·
                השקילה הבאה מומלצת {RECOMMEND - daysSince === 1 ? 'מחר' : `בעוד ${RECOMMEND - daysSince} ימים`}
              </small>
            </span>
            <button className="btn ghost mini" onClick={() => setEditing(true)}>
              Add
            </button>
          </>
        )}
      </div>

      {/* full weigh-in history — every entry ever logged, newest first. Each
          weigh-in lives on its own date, so nothing is ever overwritten (only
          a second weigh-in on the same day replaces that day's value). */}
      {weights.length > 0 && (
        <div className="wi-history">
          <button
            className="wi-htoggle"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
          >
            כל השקילות ({weights.length}) {historyOpen ? '▴' : '▾'}
          </button>
          {historyOpen && (
            <ul className="wi-list">
              {[...weights].reverse().map((p, ri) => {
                const i = weights.length - 1 - ri; // index in the ascending array
                const d = i > 0 ? Math.round((p.kg - weights[i - 1].kg) * 10) / 10 : null;
                const isEditing = editDate === p.date;
                return (
                  <li key={p.date}>
                    <span className="wi-date">{heDate(p.date)}</span>
                    {isEditing ? (
                      <>
                        <input
                          className="wi-edit-input"
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="20"
                          max="400"
                          value={editVal}
                          autoFocus
                          onChange={(e) => setEditVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(p.date);
                            if (e.key === 'Escape') setEditDate(null);
                          }}
                        />
                        <button
                          className="btn mini"
                          onClick={() => saveEdit(p.date)}
                          disabled={saving || !editVal}
                        >
                          {saving ? 'שומר…' : 'שמור'}
                        </button>
                        <button className="btn ghost mini" onClick={() => setEditDate(null)}>
                          ביטול
                        </button>
                      </>
                    ) : (
                      <>
                        <b className="wi-kg">{fmt(p.kg)} ק"ג</b>
                        {d != null && d !== 0 && (
                          <i className={'wi-delta ' + (d < 0 ? 'good' : 'bad')}>
                            {d > 0 ? '+' : ''}{fmt(d)}
                          </i>
                        )}
                        <button
                          className="wi-edit"
                          title="ערוך שקילה זו"
                          onClick={() => {
                            setEditDate(p.date);
                            setEditVal(String(p.kg));
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="wi-del"
                          title="מחק שקילה זו"
                          onClick={() => {
                            if (window.confirm(`למחוק את השקילה של ${heDate(p.date)} (${fmt(p.kg)} ק"ג)?`)) {
                              onSave(p.date, '');
                            }
                          }}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
