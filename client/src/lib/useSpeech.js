import { useRef, useState } from 'react';
import { api } from './api';

// Voice input: record audio with MediaRecorder and transcribe it server-side
// (OpenAI Whisper). We moved off the browser Web Speech API because it's
// unreliable on mobile — many Android devices open the mic, hear speech, then
// return no result for any language ('nomatch'). Recording + server transcription
// works the same on every device, including iOS.
const SUPPORTED =
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// Stop runaway recordings (e.g. user walks away) — also keeps the upload small.
const MAX_MS = 60_000;

// Human-readable Hebrew message for a voice-input error code.
export function speechErrorMessage(code) {
  switch (code) {
    case 'not-allowed':
      return 'אין הרשאה למיקרופון — אשר/י גישה בהגדרות הדפדפן';
    case 'no-speech':
      return 'לא זוהה דיבור — קרב/י את המיקרופון ונסה/י שוב';
    case 'network':
      return 'התמלול נכשל — בדוק/י את החיבור ונסה/י שוב';
    default:
      return 'ההקלטה נכשלה — נסה/י שוב';
  }
}

// Choose a recording MIME type the browser actually supports.
function pickMime() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of types) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function useSpeech({ onTranscript, onError } = {}) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const cbRef = useRef({ onTranscript, onError });
  cbRef.current = { onTranscript, onError };

  function release() {
    clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    if (!SUPPORTED || listening || transcribing) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      cbRef.current.onError?.('not-allowed');
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const mime = pickMime();
    let rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      rec = new MediaRecorder(stream);
    }
    recRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };

    rec.onstop = async () => {
      release();
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (!blob.size) {
        cbRef.current.onError?.('no-speech');
        return;
      }
      setTranscribing(true);
      try {
        const audio = await blobToBase64(blob);
        const { text } = await api.transcribe(audio, type);
        const clean = (text || '').trim();
        if (clean) cbRef.current.onTranscript?.(clean);
        else cbRef.current.onError?.('no-speech');
      } catch {
        cbRef.current.onError?.('network');
      } finally {
        setTranscribing(false);
      }
    };

    try {
      rec.start();
    } catch {
      release();
      cbRef.current.onError?.('default');
      return;
    }
    setListening(true);
    timerRef.current = setTimeout(() => stop(), MAX_MS);
  }

  function stop() {
    setListening(false);
    clearTimeout(timerRef.current);
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop(); // fires onstop → transcribe
      } catch {
        release();
      }
    } else {
      release();
    }
  }

  return { supported: SUPPORTED, listening, transcribing, start, stop };
}
