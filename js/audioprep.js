// Cleaning a recording before it goes to speech-to-text, for a loud gym. Pure (the decoding is in
// prepareAudio, which falls back to the original recording if anything goes wrong).
//
// - low rumble (bass from the gym's speakers, footsteps, the phone rubbing) is filtered out
// - the silence and noise before and after your words are cut (Whisper invents words in noise)
// - the level is evened out, and it's sent as 16 kHz mono, what the model works at
import { toWav } from './vad.js';

export const RATE = 16000;

// Second-order high-pass (Butterworth) at `hz`: the voice keeps its body, the thump goes.
export function highpass(x, rate = RATE, hz = 110) {
  const w = Math.tan(Math.PI * hz / rate), n = 1 / (1 + Math.SQRT2 * w + w * w);
  const b0 = n, b1 = -2 * n, b2 = n, a1 = 2 * (w * w - 1) * n, a2 = (1 - Math.SQRT2 * w + w * w) * n;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// Where the speech is: frames (20 ms) clearly louder than the noise floor. Returns {start, end} in
// samples, padded, or null when nothing stands out from the noise.
export function speechSpan(x, rate = RATE, { frameMs = 20, padMs = 280 } = {}) {
  const f = Math.max(1, Math.round(rate * frameMs / 1000)), n = Math.floor(x.length / f);
  if (n < 5) return null;
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * f; j < (i + 1) * f; j++) s += x[j] * x[j]; rms[i] = Math.sqrt(s / f); }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(n * 0.15)], peak = sorted[Math.floor(n * 0.98)];
  if (peak < 0.004 || peak < floor * 2.2) return null; // flat: no word stands out
  const thr = Math.max(floor * 2.2, floor + (peak - floor) * 0.12);
  // speech is a run of loud frames, not one click: need 3 in 5
  const loud = i => rms[i] > thr;
  const hit = i => [0, 1, 2, 3, 4].filter(k => i + k < n && loud(i + k)).length >= 3;
  let a = -1, b = -1;
  for (let i = 0; i < n; i++) if (hit(i)) { a = i; break; }
  for (let i = n - 1; i >= 0; i--) if (hit(Math.max(0, i - 4))) { b = i; break; }
  if (a < 0 || b < a) return null;
  const pad = Math.round(rate * padMs / 1000);
  return { start: Math.max(0, a * f - pad), end: Math.min(x.length, (b + 1) * f + pad) };
}

// Peak to about −1 dB, but never more than 8× louder (the noise would come up with it).
export function normalize(x, target = 0.89, maxGain = 8) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (!peak) return x;
  const g = Math.min(maxGain, target / peak);
  if (Math.abs(g - 1) < 0.05) return x;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}

// Samples (16 kHz mono) → the cleaned WAV bytes, or null when it's silent (nothing above a whisper).
// Speech that doesn't stand out from the noise (you talked the whole time) is kept whole.
export function cleanSpeech(samples, rate = RATE) {
  const hp = highpass(samples, rate);
  let peak = 0;
  for (let i = 0; i < hp.length; i++) { const a = Math.abs(hp[i]); if (a > peak) peak = a; }
  if (peak < 0.01) return null;
  const span = speechSpan(hp, rate);
  return toWav(normalize(span ? hp.subarray(span.start, span.end) : hp), rate, RATE);
}

// The recording (webm/opus) → a cleaned 16 kHz WAV blob. Decoding happens off-screen (an offline
// audio context: it never takes the phone's audio from your music). Any failure: the original.
export async function prepareAudio(blob) {
  try {
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OAC || !blob?.size) return { blob, cleaned: false };
    const audio = await new OAC(1, RATE, RATE).decodeAudioData(await blob.arrayBuffer());
    let x = audio.getChannelData(0);
    if (audio.sampleRate !== RATE) { // (decoding normally resamples to the context's rate already)
      const k = audio.sampleRate / RATE, y = new Float32Array(Math.floor(x.length / k));
      for (let i = 0; i < y.length; i++) y[i] = x[Math.floor(i * k)];
      x = y;
    }
    const wav = cleanSpeech(x, RATE);
    if (!wav) return { blob, cleaned: false, silent: true };
    return { blob: new Blob([wav], { type: 'audio/wav' }), cleaned: true };
  } catch {
    return { blob, cleaned: false };
  }
}
