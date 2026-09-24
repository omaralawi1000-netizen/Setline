// Spoken replies: Gemini TTS (24 kHz 16-bit PCM) played through Web Audio, cached in IndexedDB.
// Falls back to speechSynthesis. Never blocks the UI; never speaks while the mic is open.
import { audioContext } from './audio.js';
import * as db from './db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT = 6000;
const RATE = 24000;

let current = null;   // {source} | {utter}
let seq = 0;
let listeners = new Set();
export const onSpeaking = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = on => { for (const fn of listeners) fn(on); };

export function stop() {
  seq++;
  if (current?.source) { try { current.source.stop(); } catch {} }
  if (current?.utter || globalThis.speechSynthesis?.speaking) { try { speechSynthesis.cancel(); } catch {} }
  if (current) { current = null; emit(false); }
}

// ---------- model choice (pure) ----------

const version = id => (id.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
const unstable = id => /(preview|exp|experimental|latest)/.test(id);

// Pick the newest stable Flash-Lite TTS model, else the newest Flash TTS model.
export function pickTtsModel(models, preferred) {
  const ids = models
    .filter(x => typeof x === 'string' || !x.supportedGenerationMethods || x.supportedGenerationMethods.includes('generateContent'))
    .map(x => String(x.name || x).replace(/^models\//, ''))
    .filter(id => /tts/.test(id));
  if (preferred && ids.includes(preferred)) return preferred;
  const best = list => list.sort((a, b) => unstable(a) - unstable(b) || version(b) - version(a) || a.length - b.length)[0] || null;
  return best(ids.filter(id => /flash-lite/.test(id))) || best(ids.filter(id => /flash/.test(id))) || best(ids);
}

export async function listModels(key) {
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  if (res.status === 400 || res.status === 401 || res.status === 403) return { status: 'bad' };
  if (!res.ok) return { status: String(res.status) };
  const data = await res.json();
  return { status: 'ok', models: data.models || [] };
}

// ---------- synthesis ----------

const STYLE = 'Say this briefly, calm and upbeat, like a training partner:';

async function synth(text, { key, model, voice }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE} ${text}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      })
    });
    if (!res.ok) throw new Error('tts ' + res.status);
    const data = await res.json();
    const b64 = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData?.data;
    if (!b64) throw new Error('tts empty');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } finally { clearTimeout(timer); }
}

function playPcm(buf, mine) {
  const ac = audioContext();
  if (!ac) throw new Error('no audio');
  const pcm = new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
  const audio = ac.createBuffer(1, pcm.length, RATE);
  const ch = audio.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  return new Promise(res => {
    if (mine !== seq) return res();
    const source = ac.createBufferSource();
    source.buffer = audio;
    source.connect(ac.destination);
    source.onended = () => { if (current?.source === source) { current = null; emit(false); } res(); };
    current = { source };
    emit(true);
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    source.start();
  });
}

function fallback(text, lang, mine) {
  const ss = globalThis.speechSynthesis;
  if (!ss || mine !== seq) return;
  const u = new SpeechSynthesisUtterance(text);
  const want = lang === 'da' ? 'da' : 'en';
  const v = ss.getVoices().find(v => v.lang?.toLowerCase().startsWith(want));
  if (v) u.voice = v;
  u.lang = lang === 'da' ? 'da-DK' : 'en-GB';
  u.rate = 1.05;
  u.onend = u.onerror = () => { if (current?.utter === u) { current = null; emit(false); } };
  current = { utter: u };
  emit(true);
  ss.speak(u);
}

// speak(text, {key, model, voice, lang, canSpeak}) — fire and forget.
export async function speak(text, opts) {
  if (!text) return;
  stop();
  const mine = ++seq;
  const cacheKey = `${opts.model}|${opts.voice}|${text}`;
  if (opts.key) {
    try {
      let buf = await db.get('ttsCache', cacheKey).catch(() => null);
      if (!buf) {
        buf = await synth(text, opts);
        db.put('ttsCache', buf, cacheKey).catch(() => {});
      }
      if (mine !== seq || !opts.canSpeak()) return;
      await playPcm(buf, mine);
      return;
    } catch (e) {
      console.warn('tts fallback', e?.message);
    }
  }
  if (mine !== seq || !opts.canSpeak()) return;
  fallback(text, opts.lang, mine);
}

export const isSpeaking = () => !!current;
