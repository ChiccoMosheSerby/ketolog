import { useEffect, useRef, useState } from 'react';

// Thin wrapper around the browser's Web Speech API (Chrome/Edge/Safari).
// Streams an interim + final transcript via onTranscript(textSinceStart).
// No backend, no API key — runs entirely in the browser.
const SR =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

// Mobile (esp. iOS Safari) doesn't support continuous recognition or restarting
// outside a user gesture — so there we use single-utterance mode and don't
// auto-restart. Desktop keeps continuous dictation with auto-restart.
const IS_TOUCH =
  typeof navigator !== 'undefined' && /Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent);

// Human-readable Hebrew message for a SpeechRecognition error code.
export function speechErrorMessage(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'אין הרשאה למיקרופון — אשר/י גישה בהגדרות הדפדפן';
    case 'audio-capture':
      return 'לא נמצא מיקרופון זמין';
    case 'network':
      return 'הזיהוי דורש חיבור אינטרנט — בדוק/י את החיבור ונסה/י שוב';
    case 'language-not-supported':
      return 'השפה אינה נתמכת לזיהוי קולי בדפדפן זה';
    default:
      return 'ההקלטה נכשלה — נסה/י שוב';
  }
}

export function useSpeech({ lang = 'he-IL', onTranscript, onError } = {}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const finalRef = useRef(''); // accumulated finalized chunks for this session
  const wantRef = useRef(false); // user intends to keep listening
  const cbRef = useRef({ onTranscript, onError });
  cbRef.current = { onTranscript, onError };

  useEffect(() => {
    if (!SR) return undefined;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = !IS_TOUCH;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += chunk + ' ';
        else interim += chunk;
      }
      cbRef.current.onTranscript?.((finalRef.current + interim).trim());
    };

    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' are normal during pauses — ignore them.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('speech error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false; // hard stop — don't fight the permission
      }
      cbRef.current.onError?.(e.error);
    };

    // Chrome ends each recognition session after a short window. If the user is
    // still recording, restart it — otherwise the speech mid-session is lost
    // and the field looks like "recording but no text appears".
    rec.onend = () => {
      // Desktop: Chrome ends each session after a window — restart to keep
      // dictating. Mobile: a restart isn't a user gesture and tends to fail,
      // so just stop after the utterance.
      if (wantRef.current && !IS_TOUCH) {
        try {
          rec.start();
          return;
        } catch {
          /* couldn't restart — fall through to stop */
        }
      }
      wantRef.current = false;
      setListening(false);
    };

    recRef.current = rec;
    return () => {
      wantRef.current = false;
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    };
  }, [lang]);

  function start() {
    if (!recRef.current || wantRef.current) return;
    finalRef.current = '';
    wantRef.current = true;
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      // 'already started' — reflect listening state anyway
      setListening(true);
    }
  }

  function stop() {
    wantRef.current = false;
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
