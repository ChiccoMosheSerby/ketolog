// Speech-to-text via OpenAI's audio transcription API. The browser Web Speech
// API is unreliable on mobile (many Android devices return no result for any
// language), so we record audio on the client and transcribe it here instead.
const TRANSCRIBE_MODEL = () => process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe';

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
export async function transcribeAudio(buffer, mimeType = 'audio/webm', lang = 'he') {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `audio.${extFor(mimeType)}`);
  form.append('model', TRANSCRIBE_MODEL());
  if (lang) form.append('language', lang);

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
  return (data.text || '').trim();
}
