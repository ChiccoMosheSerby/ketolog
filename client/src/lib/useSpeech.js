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
    case 'no-speech':
      return 'לא זוהה דיבור — קרב/י את המיקרופון ונסה/י שוב';
    default:
      return 'ההקלטה נכשלה — נסה/י שוב';
  }
}

export function useSpeech({ lang = 'he-IL', onTranscript, onError } = {}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const finalRef = useRef(''); // accumulated finalized chunks for this session
  const wantRef = useRef(false); // user intends to keep listening
  const gotRef = useRef(false); // did this session produce any transcript?
  const errRef = useRef(false); // did this session already surface an error?
  const cbRef = useRef({ onTranscript, onError });
  cbRef.current = { onTranscript, onError };

  // Build a FRESH recognition instance per session. Android Chrome reuses a
  // single instance poorly — after the first start/stop it often stops emitting
  // results entirely — so we never reuse one across sessions.
  function build() {
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = !IS_TOUCH;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      gotRef.current = true;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += chunk + ' ';
        else interim += chunk;
      }
      cbRef.current.onTranscript?.((finalRef.current + interim).trim());
    };

    rec.onerror = (e) => {
      // 'aborted' is normal when the user taps stop — ignore it. 'no-speech'
      // is normal mid-pause on desktop (continuous restarts), but on mobile
      // it's the whole session failing, so surface it there.
      if (e.error === 'aborted') return;
      if (e.error === 'no-speech' && !IS_TOUCH) return;
      console.warn('speech error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false; // hard stop — don't fight the permission
      }
      errRef.current = true;
      cbRef.current.onError?.(e.error);
    };

    // Chrome ends each recognition session after a short window.
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
      const wasRecording = wantRef.current;
      wantRef.current = false;
      setListening(false);
      // Mobile: if we intended to record but captured nothing and no error
      // already explained why, the button just went red-then-grey silently.
      // Tell the user instead of leaving them guessing.
      if (wasRecording && IS_TOUCH && !gotRef.current && !errRef.current) {
        cbRef.current.onError?.('no-speech');
      }
    };

    return rec;
  }

  // Clean up any live instance on unmount.
  useEffect(
    () => () => {
      wantRef.current = false;
      const rec = recRef.current;
      if (rec) {
        rec.onresult = rec.onerror = rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    },
    [],
  );

  function start() {
    if (!SR || wantRef.current) return;
    finalRef.current = '';
    gotRef.current = false;
    errRef.current = false;
    wantRef.current = true;
    const rec = build();
    recRef.current = rec;
    try {
      rec.start();
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
