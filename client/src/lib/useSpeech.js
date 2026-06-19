import { useEffect, useRef, useState } from 'react';

// Thin wrapper around the browser's Web Speech API (Chrome/Edge/Safari).
// Streams an interim + final transcript via onTranscript(textSinceStart).
// No backend, no API key — runs entirely in the browser.
const SR =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function useSpeech({ lang = 'he-IL', onTranscript, onError } = {}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const finalRef = useRef(''); // accumulated finalized chunks for this session
  const cbRef = useRef({ onTranscript, onError });
  cbRef.current = { onTranscript, onError };

  useEffect(() => {
    if (!SR) return undefined;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += chunk;
        else interim += chunk;
      }
      cbRef.current.onTranscript?.((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        cbRef.current.onError?.(e.error);
      }
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    return () => {
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    };
  }, [lang]);

  function start() {
    if (!recRef.current || listening) return;
    finalRef.current = '';
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* already started */
    }
  }
  function stop() {
    if (!recRef.current) return;
    try {
      recRef.current.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }

  return { supported: Boolean(SR), listening, start, stop };
}
