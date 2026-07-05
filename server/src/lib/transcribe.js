// Speech-to-text via OpenAI's audio transcription API. The browser Web Speech
// API is unreliable on mobile (many Android devices return no result for any
// language), so we record audio on the client and transcribe it here instead.
// whisper-1 reliably honours the `language` + `prompt` hints, which is what
// keeps short Hebrew clips (one or two food words) from hallucinating in a
// random language. gpt-4o-transcribe treats `prompt` as loose instructions and
// drifts on tiny utterances.
export const TRANSCRIBE_MODEL = () => process.env.TRANSCRIBE_MODEL || 'whisper-1';

// Primes the decoder for Hebrew + the everyday food words this app hears, so a
// one-word utterance like "שוקולד" stays Hebrew instead of becoming gibberish.
const FOOD_PROMPT =
  'תמלול תיאור ארוחה בעברית. מילים נפוצות: פיתה, חומוס, שוקולד, ביצים, גבינה, ' +
  'אבוקדו, סלט, עוף, בשר, אורז, לחם, חלב, יוגורט, ירקות, אגוזים, חמאה, שמן זית, טחינה.';

export function transcribeConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Map a recorded MIME type to a filename extension OpenAI accepts. MediaRecorder
// on Android Chrome produces webm/opus; Safari produces mp4/aac.
function extFor(mime = '') {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

// Transcribe a raw audio buffer. lang is an ISO-639-1 hint ('he' for Hebrew).
// Returns { text, duration } — `duration` (seconds of audio) drives the Whisper
// cost accounting, which is billed per minute. `verbose_json` is what surfaces
// the duration field; plain json returns only the text.
export async function transcribeAudio(buffer, mimeType = 'audio/webm', lang = 'he') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `audio.${extFor(mimeType)}`);
  form.append('model', TRANSCRIBE_MODEL());
  if (lang) form.append('language', lang);
  form.append('prompt', FOOD_PROMPT);
  form.append('temperature', '0'); // deterministic — least likely to hallucinate
  form.append('response_format', 'verbose_json'); // includes `duration` for cost tracking

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`transcription ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return { text: (data.text || '').trim(), duration: Number(data.duration) || 0 };
}
