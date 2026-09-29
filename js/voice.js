// Microphone capture: MediaRecorder (webm/opus, mono) with a live level from a Web Audio analyser.
// The stream is released on stop, on cancel and whenever the page hides.
import { audioContext, hold, letGo } from './audio.js';

export const MAX_MS = 60_000; // room to stop and think mid-sentence

let rec = null; // {stream, recorder, chunks, analyser, source, startedAt, peak, timer, resolve}

export const isRecording = () => !!rec;

function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return opts.find(m => globalThis.MediaRecorder?.isTypeSupported?.(m)) || '';
}

// Start recording. Resolves once the mic is open. Throws {code:'denied'|'nomic'|'unsupported'|'busy'}.
// One opening at a time: a second call while the mic is still opening waits for the same one (two
// getUserMedia calls racing left one stream open and the other recorder lost), and an opening that
// was cancelled meanwhile closes its stream instead of recording.
let opening = null, gen = 0;
export function start(opts = {}) {
  if (rec) return Promise.resolve();
  if (!opening) opening = open(opts).finally(() => { opening = null; });
  return opening;
}
export const isStarting = () => !!opening;
async function open({ onMaxed, maxMs = MAX_MS } = {}) {
  const mine = ++gen;
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  let stream;
  try {
    // No echo cancellation: nothing plays while recording, and on Android it switches the phone into
    // call audio, which is slower to open, can clip the first word and pops the speaker on the way back.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    const code = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : e?.name === 'NotFoundError' ? 'nomic' : 'busy';
    throw Object.assign(new Error(code), { code });
  }
  if (mine !== gen || rec) { for (const tr of stream.getTracks()) tr.stop(); return; }
  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
  const r = { stream, recorder, chunks: [], analyser: null, source: null, startedAt: performance.now(), peak: 0, buf: null, timer: 0, frames: 0 };
  recorder.ondataavailable = e => { if (e.data?.size) r.chunks.push(e.data); };
  const ac = audioContext();
  if (ac) {
    try {
      r.source = ac.createMediaStreamSource(stream);
      r.analyser = ac.createAnalyser();
      r.analyser.fftSize = 1024;
      r.analyser.smoothingTimeConstant = 0.2;
      r.source.connect(r.analyser);
      r.buf = new Float32Array(r.analyser.fftSize);
      hold('mic');
    } catch { r.analyser = null; }
  }
  recorder.start(250);
  r.timer = setTimeout(() => onMaxed?.(), maxMs);
  rec = r;
}

// Current input level, 0..1 (RMS, shaped for display).
export function level() {
  if (!rec?.analyser) return 0;
  if (audioContext()?.state !== 'running') return 0; // not measuring; don't judge silence from this
  rec.frames++;
  rec.analyser.getFloatTimeDomainData(rec.buf);
  let sum = 0;
  for (let i = 0; i < rec.buf.length; i++) sum += rec.buf[i] * rec.buf[i];
  const rms = Math.sqrt(sum / rec.buf.length);
  rec.rms = rms; // the raw value, for the voice glow (read once a frame, shared)
  const v = Math.min(1, Math.pow(rms * 6, 0.7));
  if (v > rec.peak) rec.peak = v;
  return v;
}

// The voice split up, from one read of the spectrum a frame. For the orb, 0..1 each: the body of it
// (roughly 90–500 Hz) and its edge (the consonants, roughly 2–6 kHz). For the voice glow, the raw
// RMS and voice-glow's own three bands (fundamentals and chest, vowels and presence, sibilance),
// as the average spectrum share: it shapes them itself.
let fbuf = null;
const QUIET = { low: 0, high: 0, rms: 0, voice: [0, 0, 0] };
export function bands() {
  if (!rec?.analyser || audioContext()?.state !== 'running') return QUIET;
  const n = rec.analyser.frequencyBinCount, hz = audioContext().sampleRate / 2 / n;
  if (!fbuf || fbuf.length !== n) fbuf = new Uint8Array(n);
  rec.analyser.getByteFrequencyData(fbuf);
  const avg = (a, b) => { const i0 = Math.max(1, Math.round(a / hz)), i1 = Math.min(n - 1, Math.round(b / hz)); let s = 0; for (let i = i0; i <= i1; i++) s += fbuf[i]; return s / Math.max(1, i1 - i0 + 1); };
  const shape = x => Math.max(0, Math.min(1, (x - 70) / 120));
  return { low: shape(avg(90, 500)), high: shape(avg(2000, 6000) * 1.35), rms: rec.rms || 0, voice: [avg(80, 300) / 255, avg(300, 2000) / 255, avg(2000, 6000) / 255] };
}

function release(r) {
  clearTimeout(r.timer);
  try { r.source?.disconnect(); } catch {}
  for (const tr of r.stream.getTracks()) tr.stop();
  letGo('mic'); // the music comes back as soon as the mic closes
}

// Stop and return {blob, ms, peak}. The mic is closed before this resolves.
export function stop() {
  const r = rec;
  rec = null;
  if (!r) return Promise.resolve(null);
  return new Promise(res => {
    const done = () => {
      release(r);
      const type = r.recorder.mimeType || 'audio/webm';
      // measured: the level meter really ran, so a low peak means silence
      res({ blob: new Blob(r.chunks, { type }), ms: performance.now() - r.startedAt, peak: r.peak, measured: r.frames > 8 });
    };
    if (r.recorder.state === 'inactive') return done();
    r.recorder.onstop = done;
    try { r.recorder.requestData(); } catch {}
    r.recorder.stop();
  });
}

// What's been recorded so far, without stopping (for a quick look at a pause).
export function snapshot() {
  if (!rec?.chunks.length) return null;
  return new Blob(rec.chunks, { type: rec.recorder.mimeType || 'audio/webm' });
}

export function cancel() {
  if (opening) gen++; // (an opening in flight closes itself)
  const r = rec;
  rec = null;
  if (!r) return;
  r.recorder.onstop = null;
  try { r.recorder.stop(); } catch {}
  release(r);
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cancel(); });
addEventListener('pagehide', cancel);
