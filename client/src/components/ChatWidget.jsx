import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useSpeech } from '../lib/useSpeech.js';
import { fmt } from '../lib/helpers.js';
import './ChatWidget.scss';

const GREETING =
  'היי! אני קֶטוֹ, העוזר/ת הקטוגני/ת שלך 🥑\nאפשר לשאול אותי אם מוצר מתאים לקיטו, לבקש חלופה טובה יותר, לשלוח תמונה של מוצר או תווית, או לבקש ממני להוסיף ארוחה / מוצר ליומן.';

// Pull the displayable fields out of an action whether it came from POST
// (payload) or from a reloaded thread view (raw tool input).
function actionView(a) {
  const s = a.payload || a.input || {};
  if (a.type === 'meal') {
    return {
      date: s.date,
      cat: s.cat,
      desc: s.desc,
      carbs: s.carbs ?? s.net_carbs,
      fat: s.fat,
      protein: s.protein,
    };
  }
  return { key: s.key, label: s.label, unit: s.unit, carbs: s.carbs, fat: s.fat, protein: s.protein };
}

// Tiny markdown-ish renderer: **bold**, and `- ` / `* ` bullet lines.
function renderText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let bullets = null;
  const flush = () => {
    if (bullets) {
      out.push(
        <ul key={'ul' + out.length}>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>
      );
      bullets = null;
    }
  };
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      (bullets ||= []).push(m[1]);
    } else {
      flush();
      if (ln.trim()) out.push(<p key={'p' + i}>{inline(ln)}</p>);
    }
  });
  flush();
  return out;
}
function inline(s) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

export default function ChatWidget() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]); // { role, text, hasImage, actions }
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null); // { data, mediaType, preview }
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const baseDescRef = useRef('');

  const speech = useSpeech({
    onTranscript: (text) => {
      const base = baseDescRef.current;
      setInput(base + (base && text ? ' ' : '') + text);
    },
    onError: (err) => toast(err === 'not-allowed' ? 'אין הרשאה למיקרופון' : 'ההקלטה נכשלה'),
  });

  // load the most recent thread the first time the panel opens
  useEffect(() => {
    if (!open || loaded) return;
    api
      .getChat()
      .then((r) => {
        setConversationId(r.conversationId);
        setMessages(r.view || []);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  function toggleMic() {
    if (speech.listening) speech.stop();
    else {
      baseDescRef.current = input.trim();
      speech.start();
    }
  }

  function pickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const data = String(dataUrl).split(',')[1];
      setImage({ data, mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function send() {
    const text = input.trim();
    if ((!text && !image) || busy) return;
    if (speech.listening) speech.stop();

    const userMsg = { role: 'user', text, hasImage: !!image };
    setMessages((m) => [...m, userMsg]);
    const sentImage = image;
    setInput('');
    setImage(null);
    setBusy(true);

    try {
      const r = await api.sendChat({
        conversationId,
        text,
        image: sentImage ? { data: sentImage.data, mediaType: sentImage.mediaType } : undefined,
      });
      setConversationId(r.conversationId);
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: r.reply, actions: r.actions || [] },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: '', error: e.message || 'שגיאה' }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function resolve(msgIdx, action, decision) {
    if (!conversationId) return;
    try {
      const r = await api.resolveAction(conversationId, action.id, decision);
      const status = r.status || (decision === 'add' ? 'added' : 'cancelled');
      setMessages((prev) =>
        prev.map((m, i) =>
          i !== msgIdx
            ? m
            : { ...m, actions: m.actions.map((a) => (a.id === action.id ? { ...a, status } : a)) }
        )
      );
      if (status === 'added') {
        toast(action.type === 'meal' ? 'הארוחה נוספה ליומן' : 'המוצר נשמר');
        window.dispatchEvent(new Event('ketolog:dataChanged'));
      }
    } catch (e) {
      toast(e.message || 'הפעולה נכשלה');
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setInput('');
    setImage(null);
  }

  return (
    <>
      <button
        className={'chat-fab' + (open ? ' hidden' : '')}
        onClick={() => setOpen(true)}
        aria-label="פתח/י את העוזר הקטוגני"
        title="העוזר הקטוגני"
      >
        🥑
      </button>

      {open && (
        <div className="chat-panel" role="dialog" aria-label="העוזר הקטוגני">
          <header className="chat-head">
            <div className="chat-title">
              <span className="chat-ava">🥑</span>
              <div>
                <b>קֶטוֹ</b>
                <span className="chat-sub">העוזר הקטוגני שלך</span>
              </div>
            </div>
            <div className="chat-head-btns">
              <button className="icon-btn" onClick={newChat} title="שיחה חדשה">
                ✎
              </button>
              <button className="icon-btn" onClick={() => setOpen(false)} title="סגור">
                ✕
              </button>
            </div>
          </header>

          <div className="chat-body" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-msg assistant">
                <div className="bubble">{renderText(GREETING)}</div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={'chat-msg ' + m.role}>
                <div className={'bubble' + (m.error ? ' err' : '')}>
                  {m.hasImage && <span className="img-chip">🖼️ תמונה</span>}
                  {m.error ? m.error : renderText(m.text)}
                </div>
                {m.actions?.map((a) => (
                  <ActionCard key={a.id} action={a} onResolve={(d) => resolve(i, a, d)} />
                ))}
              </div>
            ))}

            {busy && (
              <div className="chat-msg assistant">
                <div className="bubble typing">
                  <i></i>
                  <i></i>
                  <i></i>
                </div>
              </div>
            )}
          </div>

          {image && (
            <div className="chat-attach">
              <img src={image.preview} alt="" />
              <button className="icon-btn" onClick={() => setImage(null)} title="הסר תמונה">
                ✕
              </button>
            </div>
          )}

          <div className="chat-input">
            <button
              className="icon-btn"
              onClick={() => fileRef.current?.click()}
              title="צרף/י תמונה"
            >
              📎
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            {speech.supported && (
              <button
                className={'icon-btn' + (speech.listening ? ' rec' : '')}
                onClick={toggleMic}
                title={speech.listening ? 'עצור הקלטה' : 'דבר/י'}
              >
                🎤
              </button>
            )}
            <textarea
              rows={1}
              placeholder="שאל/י אותי משהו על קיטו…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="send-btn" onClick={send} disabled={busy || (!input.trim() && !image)}>
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ActionCard({ action, onResolve }) {
  const v = actionView(action);
  const done = action.status === 'added';
  const cancelled = action.status === 'cancelled';
  const macros = [
    v.carbs != null && `${fmt(Number(v.carbs))} פחמ' נטו`,
    v.fat != null && `${fmt(Number(v.fat))} שומן`,
    v.protein != null && `${fmt(Number(v.protein))} חלבון`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={'action-card' + (done ? ' done' : '') + (cancelled ? ' cancelled' : '')}>
      <div className="ac-head">
        <span className="ac-kind">{action.type === 'meal' ? '🍽️ הוספת ארוחה' : '➕ מוצר חדש'}</span>
        {done && <span className="ac-badge ok">נוסף ליומן ✓</span>}
        {cancelled && <span className="ac-badge">בוטל</span>}
      </div>
      <div className="ac-body">
        {action.type === 'meal' ? (
          <>
            <div className="ac-title">{v.desc}</div>
            <div className="ac-meta">
              {v.cat}
              {v.date ? ` · ${v.date}` : ''}
            </div>
          </>
        ) : (
          <>
            <div className="ac-title">
              {v.key} <span className="ac-unit">/ {v.unit}</span>
            </div>
            {v.label && v.label !== v.key && <div className="ac-meta">{v.label}</div>}
          </>
        )}
        {macros && <div className="ac-macros">{macros}</div>}
      </div>
      {!done && !cancelled && (
        <div className="ac-btns">
          <button className="ac-add" onClick={() => onResolve('add')}>
            {action.type === 'meal' ? 'הוסף ליומן' : 'שמור מוצר'}
          </button>
          <button className="ac-cancel" onClick={() => onResolve('cancel')}>
            בטל
          </button>
        </div>
      )}
    </div>
  );
}
