// Spoken replies: Gemini TTS (24 kHz 16-bit PCM) played through Web Audio, cached in IndexedDB.
// Falls back to speechSynthesis. Never blocks the UI; never speaks while the mic is open.
import { audioContext } from './audio.js';
import * as db from './db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT = 6000;
const RATE = 24000;

let current = null;   // {source} | {utter}
let lastClip = null;  // the last reply as received, for Settings → save audio
// The last reply exactly as Gemini sent it (a WAV file), so a bad ending can be shared and checked.
export function lastClipWav() {
  if (!lastClip) return null;
  const raw = new Uint8Array(lastClip.pcm);
  if (raw.length > 12 && String.fromCharCode(...raw.subarray(0, 4)) === 'RIFF') return { blob: new Blob([raw], { type: 'audio/wav' }), text: lastClip.text };
  const pcm = raw, n = pcm.length - (pcm.length % 2);
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const str = (o, x) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, lastClip.rate, true); v.setUint32(28, lastClip.rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).set(pcm.subarray(0, n));
  return { blob: new Blob([buf], { type: 'audio/wav' }), text: lastClip.text };
}
// What spoke last and why, for Settings: {engine: 'gemini'|'device', error: code|null}
export const lastSpeech = { engine: null, error: null };
let seq = 0;
let listeners = new Set();
export const onSpeaking = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = on => { for (const fn of listeners) fn(on); };

export function stop() {
  seq++;
  // fade out rather than cut: a hard stop mid-word clicks
  if (current?.source) {
    const { source, gain } = current;
    try {
      const ac = audioContext(), t0 = ac.currentTime;
      gain?.gain.setTargetAtTime(0, t0, 0.012);
      source.stop(t0 + 0.06);
    } catch { try { source.stop(); } catch {} }
  }
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
  const timer = setTimeout(() => ctl.abort(), Math.min(20000, TIMEOUT + text.length * 40)); // longer answers take longer
  try {
    const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: /[.!?…]["”']?$/.test(text.trim()) ? text.trim() : `${text.trim()}.` }] }], // a clear full stop: models ramble less after one
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
      })
    });
    if (!res.ok) {
      const body = res.status === 429 ? await res.text().catch(() => '') : '';
      throw Object.assign(new Error('tts ' + res.status), { status: res.status, daily: /PerDay/i.test(body) });
    }
    return audioFrom(await res.json());
  } finally { clearTimeout(timer); }
}

// The audio can come back split over several parts, and each part may be a whole WAV file:
// a header, the samples, then metadata (the SynthID watermark note). Only the samples are sound;
// playing the metadata as audio was the loud burst at the end of replies.
export function audioFrom(data) {
  const parts = (data?.candidates?.[0]?.content?.parts || []).map(p => p.inlineData).filter(d => d?.data);
  if (!parts.length) throw new Error('tts empty');
  let rate = null;
  const chunks = parts.map(d => {
    const bin = atob(d.data);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    const a = pcmBytes(b, Number(/rate=(\d+)/.exec(d.mimeType || '')?.[1]) || RATE);
    rate ??= a.rate;
    return a.bytes;
  });
  const bytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  return { pcm: bytes.buffer, rate: rate || RATE };
}

// Just the 16-bit mono samples out of raw PCM or a WAV container (any chunks before or after "data").
export function pcmBytes(u8, fallbackRate = RATE) {
  const tag = (o, n = 4) => String.fromCharCode(...u8.subarray(o, o + n));
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { bytes: u8.subarray(0, u8.length - (u8.length % 2)), rate: fallbackRate };
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let off = 12, rate = fallbackRate, ch = 1, bits = 16;
  while (off + 8 <= u8.length) {
    const id = tag(off), size = v.getUint32(off + 4, true), body = off + 8;
    if (id === 'fmt ' && body + 16 <= u8.length) { ch = v.getUint16(body + 2, true) || 1; rate = v.getUint32(body + 4, true) || fallbackRate; bits = v.getUint16(body + 14, true); }
    else if (id === 'data') {
      const len = Math.min(size === 0xFFFFFFFF || size === 0 ? u8.length - body : size, u8.length - body);
      let d = u8.subarray(body, body + len - (len % 2));
      if (bits !== 16) return { bytes: new Uint8Array(0), rate };
      if (ch > 1) { // keep the first channel
        const n = Math.floor(d.length / (2 * ch)), mono = new Uint8Array(n * 2);
        for (let i = 0; i < n; i++) { mono[i * 2] = d[i * 2 * ch]; mono[i * 2 + 1] = d[i * 2 * ch + 1]; }
        d = mono;
      }
      return { bytes: d, rate };
    }
    off = body + size + (size & 1);
  }
  return { bytes: new Uint8Array(0), rate }; // a WAV without samples: say nothing rather than noise
}

// 16-bit PCM (or a WAV) → float, cleaned up for playback.
export function pcmToFloat(buf, rate = RATE, text = '') {
  const a = pcmBytes(new Uint8Array(buf), rate);
  const n = a.bytes.length >> 1;
  const view = new DataView(a.bytes.buffer, a.bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return cleanSpeech(out, a.rate, text);
}

// The model sometimes ends a clip with a stray thump or burst of noise after the last word.
// Find where speech really ends, drop a short trailing burst that doesn't sound like speech
// (very low or noise-like zero-crossing rate), then end on a smooth fade. Pure.
export function cleanSpeech(x, rate = RATE, text = '') {
  const n = x.length;
  if (!n) return x;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - mean;
  const F = Math.max(1, Math.round(rate * 0.01)); // 10 ms frames
  const frames = Math.ceil(n / F);
  const rms = new Float32Array(frames);
  let peak = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const a = f * F, b = Math.min(n, a + F);
    for (let i = a; i < b; i++) e += out[i] * out[i];
    rms[f] = Math.sqrt(e / (b - a));
    if (rms[f] > peak) peak = rms[f];
  }
  const thr = Math.max(0.004, peak * 0.015); // ~-36 dB: soft word endings still count as speech
  const segs = [];
  for (let f = 0; f < frames; f++) {
    if (rms[f] <= thr) continue;
    const last = segs[segs.length - 1];
    if (last && f - last.end <= 8) last.end = f + 1; else segs.push({ start: f, end: f + 1 });
  }
  const zcr = (a, b) => { let z = 0; for (let i = a + 1; i < b; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) z++; return z / Math.max(1, b - a); };
  const segRms = sg => { let e = 0, c = 0; for (let f = sg.start; f < sg.end; f++) { e += rms[f]; c++; } return e / Math.max(1, c); };
  // 1. what the model adds after it's done: a short non-voice blip, or a quiet "ghost" after a pause
  for (let k = 0; k < 3 && segs.length > 1; k++) {
    const last = segs[segs.length - 1], prev = segs[segs.length - 2];
    const len = last.end - last.start, gap = last.start - prev.end;
    const z = zcr(last.start * F, Math.min(n, last.end * F));
    const speechy = z * rate > 300 && z < 0.3; // crossings per second: voice sits well inside this
    const body = segs.slice(0, -1).map(segRms).sort((a, b) => a - b);
    const typical = body[body.length >> 1] || 0;
    const ghost = gap >= 20 && len <= 150 && segRms(last) < typical * 0.3;
    if ((gap >= 8 && len <= 40 && !speechy) || ghost) segs.pop(); else break;
  }
  let hardEnd = Infinity;
  // 2. longer than the text could take: end at the last pause that fits the text
  if (text && segs.length > 1) {
    const chars = String(text).length + (String(text).match(/\d/g) || []).length * 4; // numbers take longer to say
    const expected = chars / 14, allowed = expected * 1.45 + 0.35;
    const endS = seg => (seg.end * F) / rate;
    if (endS(segs[segs.length - 1]) > allowed) {
      let cut = -1;
      for (let i = 0; i < segs.length - 1; i++) {
        if (endS(segs[i]) > allowed) break;
        if (segs[i + 1].start - segs[i].end >= 12 && endS(segs[i]) >= expected * 0.6) cut = i;
      }
      if (cut >= 0) segs.length = cut + 1;
      else if (endS(segs[segs.length - 1]) > expected * 2 + 0.5) hardEnd = Math.round((allowed * rate) / F); // no pause to end on: fade out there
    }
  }
  let end = n;
  if (segs.length) end = Math.min(n, (segs[segs.length - 1].end + 18) * F, hardEnd * F); // keep 180 ms of natural decay
  const clip = out.subarray(0, end);
  const fadeIn = Math.min(clip.length, Math.round(rate * 0.01)), fadeOut = Math.min(clip.length, Math.round(rate * 0.12));
  for (let i = 0; i < fadeIn; i++) clip[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) clip[clip.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  return clip;
}

function playPcm({ pcm, rate }, mine, text = '') {
  const ac = audioContext();
  if (!ac) throw new Error('no audio');
  lastClip = { pcm, rate: rate || RATE, text };
  const realRate = pcmBytes(new Uint8Array(pcm), rate || RATE).rate;
  const samples = pcmToFloat(pcm, rate || RATE, text);
  const audio = ac.createBuffer(1, Math.max(1, samples.length), realRate);
  audio.getChannelData(0).set(samples);
  return new Promise(res => {
    if (mine !== seq) return res();
    const source = ac.createBufferSource();
    source.buffer = audio;
    // a gentle high-pass takes out thumps and rumble the voice doesn't need
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.707;
    const gain = ac.createGain();
    source.connect(hp).connect(gain).connect(ac.destination);
    source.onended = () => {
      setTimeout(() => { try { source.disconnect(); hp.disconnect(); gain.disconnect(); } catch {} }, 200);
      if (current?.source === source) { current = null; emit(false); }
      res();
    };
    current = { source, gain, until: performance.now() + audio.duration * 1000 + 1500 };
    emit(true);
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    source.start();
  });
}

// The phone's own voice. Android's speech engine is fussy: it has no voices until they've loaded,
// drops a sentence spoken right after a cancel, sometimes never starts, and cuts long text off.
// So: wait for the voices, give it a beat after cancelling, speak sentence by sentence, and retry a
// sentence once if it never starts.
let voicesReady = null;
const loadVoices = ss => (ss.getVoices().length ? Promise.resolve() : (voicesReady ||= new Promise(r => {
  const done = () => r();
  try { ss.addEventListener('voiceschanged', done, { once: true }); } catch { ss.onvoiceschanged = done; }
  setTimeout(done, 900);
})));
const pause = ms => new Promise(r => setTimeout(r, ms));
export function speechChunks(text, max = 180) {
  const out = [];
  for (const sent of String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?…:;])\s+/)) {
    if (!sent) continue;
    if (sent.length <= max) { out.push(sent); continue; }
    let cur = '';
    for (const w of sent.split(/(?<=,)\s+|\s+/)) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur.trim()); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) out.push(cur);
  }
  // join very short bits so it doesn't sound choppy
  return out.reduce((a, x) => (a.length && a[a.length - 1].length + x.length < 90 ? (a[a.length - 1] += ' ' + x, a) : (a.push(x), a)), []);
}
async function fallback(text, lang, mine) {
  const ss = globalThis.speechSynthesis;
  if (!ss || mine !== seq) return;
  await loadVoices(ss);
  if (mine !== seq) return;
  try { if (ss.speaking || ss.pending) ss.cancel(); ss.resume(); } catch {}
  await pause(80); // speaking straight after a cancel gets dropped on Android
  const want = lang === 'da' ? 'da' : 'en';
  // network and "natural" voices sound far better than the default local ones
  const voices = ss.getVoices().filter(v => v.lang?.toLowerCase().startsWith(want));
  const score = v => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  const voice = voices.sort((a, b) => score(b) - score(a))[0];
  const one = (part, retry = true) => new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(part);
    if (voice) u.voice = voice;
    u.lang = lang === 'da' ? 'da-DK' : 'en-GB';
    u.rate = 1.04;
    let started = false, over = false;
    const end = ok => { if (over) return; over = true; clearTimeout(kick); clearTimeout(guard); resolve(ok); };
    u.onstart = () => { started = true; };
    u.onend = () => end(true);
    u.onerror = e => end(e?.error === 'interrupted' || e?.error === 'canceled' ? 'stop' : false);
    current = { utter: u, until: performance.now() + 4000 + part.length * 120 };
    // never started: nudge it once (cancel + speak again), then give up on this bit
    const kick = setTimeout(async () => {
      if (started || over) return;
      try { ss.cancel(); } catch {}
      if (retry && mine === seq) { over = true; clearTimeout(guard); await pause(80); resolve(await one(part, false)); } else end(false);
    }, 1600);
    // it started but onend never came (an Android habit): move on after a generous estimate
    const guard = setTimeout(() => end(true), 4000 + part.length * 110);
    try { ss.speak(u); } catch { end(false); }
  });
  emit(true);
  for (const part of speechChunks(text)) {
    if (mine !== seq) return;
    const r = await one(part);
    if (r === 'stop') break;
  }
  if (mine === seq && current) { current = null; emit(false); }
}

// speak(text, {key, model, voice, lang, canSpeak}) — fire and forget.
// Longer replies are spoken in two pieces: the first sentence is synthesized on its own so it can
// start playing while the rest is still being made (the voice starts in about half the time).
export function splitSpeech(text) {
  const t = String(text || '').trim();
  const m = /^(.{12,}?[.!?…])\s+(?=\S)/.exec(t);
  if (!m || t.length < 320 || t.length - m[0].length < 12) return [t]; // one request for a normal reply (the free quota is a few a minute)
  return [m[1], t.slice(m[0].length)];
}

const pending = new Map();
function clip(text, opts) {
  const k = `v4|${opts.model}|${opts.voice}|${text}`;
  if (!pending.has(k)) pending.set(k, clipNow(text, opts, k).finally(() => pending.delete(k)));
  return pending.get(k);
}
async function clipNow(text, opts, cacheKey) {
  let buf = await db.get('ttsCache', cacheKey).catch(() => null);
  if (buf && !buf.pcm) buf = null;
  if (buf) return buf;
  // chosen model, then its runner-up
  const models = [...new Set([opts.model, ...(opts.alt || [])].filter(Boolean))];
  let last;
  for (const model of models) {
    try { buf = await synth(text, { ...opts, model }); break; } catch (e) { last = e; if (e.status === 400 || e.status === 403) break; }
  }
  if (!buf) throw last;
  db.put('ttsCache', buf, cacheKey).catch(() => {});
  return buf;
}

// Gemini's free voices have a small daily limit. Once it answers 429 the phone's voice takes over
// for an hour, so no reply waits on a request that is going to fail.
const QUOTA_KEY = 'setline.ttsRest'; // (renamed in 1.36: an old overnight rest is dropped)
const quotaUntil = () => { try { return Number(localStorage.getItem(QUOTA_KEY)) || 0; } catch { return 0; } };
// Short rests only: a per-minute limit for 30 s, a daily one for 10 minutes, then Gemini is simply asked
// again (turning on billing lifts the limit at once, and a long rest would hide that).
function quotaHit(daily) {
  try { localStorage.setItem(QUOTA_KEY, String(Date.now() + (daily ? 600_000 : 30_000))); } catch {}
}
// A voice model that no longer exists (404): the app picks again from the key's model list.
let onMissing = () => {};
export const whenModelMissing = fn => { onMissing = fn; };
export function clearVoiceRest() { try { localStorage.removeItem(QUOTA_KEY); } catch {} }

export async function speak(text, opts) {
  if (!text) return;
  stop();
  const mine = ++seq;
  const resting = opts.model !== 'device' && Date.now() < quotaUntil();
  if (resting) lastSpeech.error = 'quota';
  if (opts.key && opts.model !== 'device' && !resting) { // 'device': the phone's own voice, no network wait
    const parts = splitSpeech(text);
    const jobs = parts.map(p => clip(p, opts));
    jobs.forEach(j => j.catch(() => {})); // a later piece failing is handled when we get to it
    let played = 0;
    try {
      for (let i = 0; i < parts.length; i++) {
        const buf = await jobs[i];
        if (mine !== seq || !opts.canSpeak()) return;
        lastSpeech.engine = 'gemini'; lastSpeech.error = null;
        await playPcm(buf, mine, parts[i]);
        played++;
        if (mine !== seq) return;
      }
      return;
    } catch (e) {
      lastSpeech.error = e?.status === 429 ? (e.daily ? 'quota' : 'busy') : e?.status ? String(e.status) : e?.name === 'AbortError' ? 'timeout' : 'failed';
      if (e?.status === 429) quotaHit(!!e.daily);
      if (e?.status === 404) onMissing();
      console.warn('tts fallback', lastSpeech.error);
    }
    text = parts.slice(played).join(' ');
  } else if (!resting) lastSpeech.error = opts.model === 'device' ? null : 'nokey';
  lastSpeech.engine = 'device';
  if (mine !== seq || !opts.canSpeak()) return;
  await fallback(text, opts.lang, mine);
}

export const isSpeaking = () => {
  if (current && current.until && performance.now() > current.until) { current = null; emit(false); }
  return !!current;
};
