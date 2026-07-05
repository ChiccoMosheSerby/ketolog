import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useSpeech, speechErrorMessage } from '../lib/useSpeech.js';
import { fmt } from '../lib/helpers.js';
import { renderText } from '../lib/markdown.jsx';
import Logo from './Logo.jsx';
import './ChatWidget.scss';

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

export default function ChatWidget() {
  const { t } = useTranslation();
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
  const taRef = useRef(null);
  const baseDescRef = useRef('');

  const speech = useSpeech({
    onTranscript: (text) => {
      const base = baseDescRef.current;
      setInput(base + (base && text ? ' ' : '') + text);
    },
    onError: (err) => toast(speechErrorMessage(err)),
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

  // Grow the composer to fit its content (up to the CSS max-height), then shrink
  // back down as text is removed or after a message is sent.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [input, open]);

  function toggleMic() {
    if (speech.listening) speech.stop();
    else {
      baseDescRef.current = input.trim();
      speech.start();
    }
  }

  // Shared by the 📎 picker and clipboard paste: read an image File/Blob → state.
  function loadImageFile(file) {
    if (!file || !file.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const data = String(dataUrl).split(',')[1];
      setImage({ data, mediaType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  function pickImage(e) {
    loadImageFile(e.target.files?.[0]);
    e.target.value = '';
  }

  // Paste an image straight into the chat (e.g. a copied screenshot).
  function onPaste(e) {
    for (const item of e.clipboardData?.items || []) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          loadImageFile(file);
          return;
        }
      }
    }
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
      setMessages((m) => [...m, { role: 'assistant', text: '', error: e.message || t('chat.errorGeneric') }]);
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
        toast(action.type === 'meal' ? t('chat.mealAddedToast') : t('chat.productSavedToast'));
        window.dispatchEvent(new Event('ketolog:dataChanged'));
      }
    } catch (e) {
      toast(e.message || t('chat.actionFailedToast'));
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
        data-tour="chat"
        onClick={() => setOpen(true)}
        aria-label={t('chat.openAria')}
        title={t('chat.assistantName')}
      >
        <Logo size={58} />
      </button>

      {open && (
        <div className="chat-panel" role="dialog" aria-label={t('chat.assistantName')}>
          <header className="chat-head">
            <div className="chat-title">
              <span className="chat-ava"><Logo size={36} /></span>
              <div>
                <b>{t('chat.ketoName')}</b>
                <span className="chat-sub">{t('chat.assistantSubtitle')}</span>
              </div>
            </div>
            <div className="chat-head-btns">
              <button className="icon-btn" onClick={newChat} title={t('chat.newChat')}>
                ✎
              </button>
              <button className="icon-btn" onClick={() => setOpen(false)} title={t('common.close')}>
                ✕
              </button>
            </div>
          </header>

          <div className="chat-body" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="chat-msg assistant">
                <div className="bubble">{renderText(t('chat.greeting'))}</div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={'chat-msg ' + m.role}>
                <div className={'bubble' + (m.error ? ' err' : '')}>
                  {m.hasImage && <span className="img-chip">{t('chat.imageChip')}</span>}
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
              <button className="icon-btn" onClick={() => setImage(null)} title={t('chat.removeImage')}>
                ✕
              </button>
            </div>
          )}

          <div className="chat-input">
            <button
              className="icon-btn"
              onClick={() => fileRef.current?.click()}
              title={t('chat.attachImage')}
            >
              📎
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            {speech.supported && (
              <button
                className={'icon-btn' + (speech.listening ? ' rec' : '')}
                onClick={toggleMic}
                title={speech.listening ? t('chat.stopRecording') : t('chat.speak')}
              >
                🎤
              </button>
            )}
            <textarea
              ref={taRef}
              rows={1}
              placeholder={t('chat.inputPlaceholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
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
  const { t } = useTranslation();
  const v = actionView(action);
  const done = action.status === 'added';
  const cancelled = action.status === 'cancelled';
  const macros = [
    v.carbs != null && t('chat.macroNetCarbs', { value: fmt(Number(v.carbs)) }),
    v.fat != null && t('chat.macroFat', { value: fmt(Number(v.fat)) }),
    v.protein != null && t('chat.macroProtein', { value: fmt(Number(v.protein)) }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={'action-card' + (done ? ' done' : '') + (cancelled ? ' cancelled' : '')}>
      <div className="ac-head">
        <span className="ac-kind">{action.type === 'meal' ? t('chat.actionMealKind') : t('chat.actionProductKind')}</span>
        {done && <span className="ac-badge ok">{t('chat.addedBadge')}</span>}
        {cancelled && <span className="ac-badge">{t('chat.cancelledBadge')}</span>}
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
            {action.type === 'meal' ? t('chat.addToJournal') : t('chat.saveProduct')}
          </button>
          <button className="ac-cancel" onClick={() => onResolve('cancel')}>
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
