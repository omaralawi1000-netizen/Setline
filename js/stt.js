// Groq speech-to-text. The recording is sent only here and never stored.
export const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
const TIMEOUT = 6000;

// Short context prompt: the current exercise and recent names in both languages, plus a sample.
export function buildPrompt({ current = null, recent = [], catalog }) {
  const names = [];
  const add = id => { const e = catalog?.get(id); if (e) for (const n of [e.da, e.en]) if (n && !names.includes(n)) names.push(n); };
  if (current) add(current);
  for (const id of recent) { if (names.length >= 12) break; add(id); }
  const sample = 'Bænkpres 82,5 kilo 8 gentagelser. Bench press 80 kg for 8. Samme igen. Læg 2,5 til. Skip rest.';
  return (names.length ? names.join(', ') + '. ' : '') + sample;
}

export class SttError extends Error {
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

async function once(blob, { key, model, language, prompt }) {
  const fd = new FormData();
  const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm';
  fd.append('file', blob, `speech.${ext}`);
  fd.append('model', model);
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  if (language === 'da' || language === 'en') fd.append('language', language);
  if (prompt) fd.append('prompt', prompt);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: ctl.signal });
  } catch (e) {
    throw new SttError(e?.name === 'AbortError' ? 'timeout' : navigator.onLine === false ? 'offline' : 'network');
  } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) throw new SttError('badkey', res.status);
  if (res.status === 429) throw new SttError('busy', res.status);
  if (!res.ok) throw new SttError('failed', res.status);
  const data = await res.json().catch(() => null);
  if (!data || typeof data.text !== 'string') throw new SttError('failed', res.status);
  return data.text.trim();
}

// Transcribe with one retry on timeouts, network blips and 5xx.
export async function transcribe(blob, opts) {
  if (!opts.key) throw new SttError('nokey');
  if (navigator.onLine === false) throw new SttError('offline');
  try {
    return await once(blob, opts);
  } catch (e) {
    if (!['timeout', 'network'].includes(e.code) && !(e.code === 'failed' && e.status >= 500)) throw e;
    return once(blob, opts);
  }
}

// Key check: list models. Returns 'ok' | 'bad' | 'offline' | status code.
export async function testGroqKey(key) {
  try {
    const res = await fetch(GROQ_MODELS, { headers: { Authorization: `Bearer ${key}` } });
    if (res.ok) return 'ok';
    if (res.status === 401 || res.status === 403) return 'bad';
    return String(res.status);
  } catch { return 'offline'; }
}
