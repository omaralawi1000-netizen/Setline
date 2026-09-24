// Spoken replies: Gemini TTS (24 kHz 16-bit PCM) played through Web Audio, cached in IndexedDB.
// Falls back to speechSynthesis. Never blocks the UI; never speaks while the mic is open.
import { audioContext } from './audio.js';
import * as db from './db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT = 6000;
const RATE = 24000;

let current = null;   // {source} | {utter}
// What spoke last and why, for Settings: {engine: 'gemini'|'device', error: code|null}
export const lastSpeech = { engine: null, error: null };
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

import { rankModels } from './ai.js';

// Pick a TTS model. natural: newest Flash TTS (sounds best), fast: newest Flash-Lite TTS.
// Each falls back to the other family, then to anything with "tts".
export function pickTtsModel(models, preferred, quality = 'fast') {
  const ids = models
    .filter(x => typeof x === 'string' || !x.supportedGenerationMethods || x.supportedGenerationMethods.includes('generateContent'))
    .map(x => String(x.name || x).replace(/^models\//, ''))
    .filter(id => /tts/.test(id));
  const best = list => rankModels(list)[0] || null;
  const lite = best(ids.filter(id => /flash-lite/.test(id))), flash = best(ids.filter(id => /flash/.test(id) && !/lite/.test(id)));
  const pick = (quality === 'natural' ? flash || lite : lite || flash) || best(ids);
  // the configured default only wins if nothing newer is listed
  if (preferred && ids.includes(preferred) && rankModels([preferred, pick])[0] === preferred) return preferred;
  return pick;
}

export async function listModels(key) {
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
  if (res.status === 400 || res.status === 401 || res.status === 403) return { status: 'bad' };
  if (!res.ok) return { status: String(res.status) };
  const data = await res.json();
  return { status: 'ok', models: data.models || [] };
}

// ---------- synthesis ----------

async function synth(text, { key, model, voice }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      })
    });
    if (!res.ok) throw Object.assign(new Error('tts ' + res.status), { status: res.status });
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData;
    if (!part) throw new Error('tts empty');
    const bin = atob(part.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const rate = Number(/rate=(\d+)/.exec(part.mimeType || '')?.[1]) || RATE;
    return { pcm: bytes.buffer, rate };
  } finally { clearTimeout(timer); }
}

// 16-bit PCM → float, skipping a WAV header if one is present.
export function pcmToFloat(buf) {
  const u8 = new Uint8Array(buf);
  const wav = u8.length > 44 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46; // "RIFF"
  const start = wav ? 44 : 0;
  const n = Math.floor((u8.length - start) / 2);
  const view = new DataView(buf, start, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  // soft edges: a hard stop on a non-zero sample is the "thud" at the end
  const fadeIn = Math.min(n, 240), fadeOut = Math.min(n, 1200);
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) out[n - 1 - i] *= i / fadeOut;
  return out;
}

function playPcm({ pcm, rate }, mine) {
  const ac = audioContext();
  if (!ac) throw new Error('no audio');
  const samples = pcmToFloat(pcm);
  const audio = ac.createBuffer(1, samples.length, rate || RATE);
  audio.getChannelData(0).set(samples);
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
  // network and "natural" voices sound far better than the default local ones
  const voices = ss.getVoices().filter(v => v.lang?.toLowerCase().startsWith(want));
  const score = v => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  const v = voices.sort((a, b) => score(b) - score(a))[0];
  if (v) u.voice = v;
  u.lang = lang === 'da' ? 'da-DK' : 'en-GB';
  u.rate = 1;
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
  const cacheKey = `v2|${opts.model}|${opts.voice}|${text}`;
  if (opts.key) {
    try {
      let buf = await db.get('ttsCache', cacheKey).catch(() => null);
      if (buf && !buf.pcm) buf = null;
      if (!buf) {
        // chosen model, then its runner-up
        const models = [...new Set([opts.model, ...(opts.alt || [])].filter(Boolean))];
        let last;
        for (const model of models) {
          try { buf = await synth(text, { ...opts, model }); break; } catch (e) { last = e; if (e.status === 400 || e.status === 403) break; }
        }
        if (!buf) throw last;
        db.put('ttsCache', buf, cacheKey).catch(() => {});
      }
      if (mine !== seq || !opts.canSpeak()) return;
      lastSpeech.engine = 'gemini'; lastSpeech.error = null;
      await playPcm(buf, mine);
      return;
    } catch (e) {
      lastSpeech.error = e?.status ? String(e.status) : e?.name === 'AbortError' ? 'timeout' : 'failed';
      console.warn('tts fallback', lastSpeech.error);
    }
  } else lastSpeech.error = 'nokey';
  lastSpeech.engine = 'device';
  if (mine !== seq || !opts.canSpeak()) return;
  fallback(text, opts.lang, mine);
}

export const isSpeaking = () => !!current;
