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
  return (names.length ? names.join(', ') + '. ' : '') + SAMPLE;
}
// The sample uses numbers nobody lifts, so that when Whisper, given silence or gym noise, simply
// repeats its prompt back (it does), the echo can be told apart from a real set and dropped.
const SAMPLE = 'Bænkpres 37,5 kilo 11 gentagelser. Bench press 142.5 kg for 3. Samme igen. Læg 2,5 til. Skip rest.';
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9æøå]+/g, ' ').trim();
const ECHO = [/\b37 5 kilo 11\b/, /\b142 5 kg for 3\b/, /\bskip rest\b.*\bsamme igen\b|\bsamme igen\b.*\blæg 2 5 til\b/];
// true when a piece of the transcript is the prompt coming back: a sample sentence, or the list of names
export function isEcho(text, prompt = '') {
  const t = norm(text);
  if (!t) return false;
  if (ECHO.some(r => r.test(t))) return true;
  const names = norm(String(prompt).split(SAMPLE)[0]);
  return !!names && t.length >= 8 && names.includes(t) && /\s/.test(t);
}
// Whisper sometimes says the same sentence twice ("Bench 80 for 8. Bench 80 for 8.")
export function dedupeSentences(text) {
  const parts = String(text || '').split(/(?<=[.!?])\s+/), out = [];
  for (const p of parts) if (!out.length || norm(out[out.length - 1]) !== norm(p)) out.push(p);
  return out.join(' ');
}

// Whisper "hears" things in silence and noise: subtitle credits and sign-offs it learned from
// films. Those, and segments the model itself marks as probably not speech, are dropped.
const JUNK = [
  /danske tekster/i, /scandinavian text service/i, /tekstet af/i, /undertekster/i, /oversat af/i, /nordic subtitle/i,
  /tak fordi (du|i) (så|lyttede) med/i, /thank(s| you) for watching/i, /subtitles? by/i, /amara\.org/i,
  /please subscribe/i, /like and subscribe/i, /^\W*(musik|music|applause|bifald)\W*$/i
];
export const isJunk = text => JUNK.some(r => r.test(text));
const SPOKEN = { danish: 'da', english: 'en' };
export function cleanTranscript(data, prompt = '') {
  if (!data || typeof data.text !== 'string') return null;
  const segs = Array.isArray(data.segments) ? data.segments : null;
  let text = segs
    ? segs.filter(g => !(g.no_speech_prob > 0.6 && g.avg_logprob < -0.7) && !(g.compression_ratio > 2.4) && !isJunk(g.text || '') && !isEcho(g.text, prompt)).map(g => String(g.text || '').trim()).join(' ')
    : data.text;
  // sentence by sentence too: one segment can hold the echo and more
  text = String(text).split(/(?<=[.!?])\s+/).filter(x => !isEcho(x, prompt)).join(' ');
  text = dedupeSentences(text.replace(/\s+/g, ' ').trim());
  if (isJunk(text) || isEcho(text, prompt)) text = '';
  const lang = String(data.language || '').toLowerCase();
  return { text, lang: SPOKEN[lang] || (lang.length === 2 ? lang : lang ? 'other' : '') };
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
  fd.append('response_format', 'verbose_json'); // per-segment "is this speech?" scores
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
  const out = cleanTranscript(await res.json().catch(() => null), prompt);
  if (!out) throw new SttError('failed', res.status);
  return out;
}

// Left on Auto, Whisper sometimes takes Danish for Norwegian or Swedish ("Jeg vet ikke hvad å
// gjøre"): anything that isn't Danish or English is heard again as Danish.
async function heard(blob, opts) {
  const r = await once(blob, opts);
  if (r.text && r.lang && r.lang !== 'da' && r.lang !== 'en' && opts.language !== 'en') return (await once(blob, { ...opts, language: 'da' })).text;
  return r.text;
}

// Transcribe with one retry on timeouts, network blips and 5xx.
export async function transcribe(blob, opts) {
  if (!opts.key) throw new SttError('nokey');
  if (navigator.onLine === false) throw new SttError('offline');
  try {
    return await heard(blob, opts);
  } catch (e) {
    if (!['timeout', 'network'].includes(e.code) && !(e.code === 'failed' && e.status >= 500)) throw e;
    return heard(blob, opts);
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
