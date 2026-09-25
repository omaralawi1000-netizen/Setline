import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeech, pcmToFloat } from '../js/tts.js';

const R = 24000;
// voice-like: a 180 Hz fundamental with 1.2 kHz and 2.4 kHz formant energy
const voice = (ms, amp = 0.3) => Float32Array.from({ length: Math.round(R * ms / 1000) }, (_, i) => amp * (0.5 * Math.sin(2 * Math.PI * 180 * i / R) + 0.35 * Math.sin(2 * Math.PI * 1200 * i / R) + 0.15 * Math.sin(2 * Math.PI * 2400 * i / R)));
const tone = (ms, hz, amp) => Float32Array.from({ length: Math.round(R * ms / 1000) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / R) * Math.exp(-i / (R * 0.05)));
const noise = (ms, amp) => { let s = 7; return Float32Array.from({ length: Math.round(R * ms / 1000) }, () => { s = (s * 16807) % 2147483647; return amp * (s / 1073741823.5 - 1); }); };
const silence = ms => new Float32Array(Math.round(R * ms / 1000));
const cat = (...parts) => { const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const ms = x => (x.length / R) * 1000;

test('a low thump after the last word is cut', () => {
  const clean = cleanSpeech(cat(voice(900), silence(200), tone(180, 55, 0.8), silence(100)), R);
  assert.ok(ms(clean) < 1150, `ends after the speech, got ${ms(clean)} ms`);
});

test('a burst of noise after the last word is cut', () => {
  const clean = cleanSpeech(cat(voice(900), silence(150), noise(120, 0.6)), R);
  assert.ok(ms(clean) < 1150, `got ${ms(clean)} ms`);
});

test('a short last word is kept', () => {
  const clean = cleanSpeech(cat(voice(900), silence(160), voice(220), silence(300)), R);
  assert.ok(ms(clean) > 1250 && ms(clean) < 1500, `kept "go", trimmed silence: ${ms(clean)} ms`);
});

test('ends on silence with no DC offset', () => {
  const x = cat(voice(500)).map(v => v + 0.1);
  const clean = cleanSpeech(x, R);
  assert.ok(Math.abs(clean[clean.length - 1]) < 1e-3, 'faded to zero');
  assert.ok(Math.abs(clean[0]) < 1e-3, 'fades in');
});

test('pcm bytes and a WAV header decode', () => {
  const pcm = new Int16Array(Array.from({ length: 4800 }, (_, i) => Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / R))));
  assert.equal(pcmToFloat(pcm.buffer, R).length > 4000, true);
  const wav = geminiWav([...pcm].map(v => v / 32768));
  assert.ok(Math.abs(pcmToFloat(wav.buffer, R).length - pcmToFloat(pcm.buffer, R).length) < 2);
  assert.equal(cleanSpeech(new Float32Array(0)).length, 0);
});

test('audio split over several parts is joined, not cut after the first', async () => {
  const { audioFrom } = await import('../js/tts.js');
  const pcm = n => Buffer.from(new Int16Array(n).fill(1000).buffer).toString('base64');
  const data = { candidates: [{ content: { parts: [
    { inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm(4800) } },
    { text: 'ignored' },
    { inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm(2400) } }
  ] } }] };
  const a = audioFrom(data);
  assert.equal(a.pcm.byteLength, (4800 + 2400) * 2);
  assert.equal(a.rate, 24000);
  assert.throws(() => audioFrom({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }));
});

test('a soft final syllable is not chopped', () => {
  // speech, then a quiet decaying tail (-30 dB) that is still part of the word
  const tail = Float32Array.from({ length: R * 0.25 }, (_, i) => 0.012 * Math.sin(2 * Math.PI * 900 * i / R));
  const clean = cleanSpeech(cat(voice(800), tail, silence(400)), R);
  assert.ok(ms(clean) >= 1040, `kept the soft ending: ${ms(clean)} ms`);
});

test('a ghost voice after the reply is cut, using how long the text should take', () => {
  // "Bench press, set 3." ≈ 1.2 s of speech, then a pause and 1.4 s of garbled voice-like audio
  const text = 'Bench press, set 3.';
  const clean = cleanSpeech(cat(voice(1200), silence(300), voice(1400, 0.25), silence(200)), R, text);
  assert.ok(ms(clean) < 1500, `cut after the real speech, got ${ms(clean)} ms`);
});

test('a quiet ghost after a pause is cut even without the text', () => {
  const clean = cleanSpeech(cat(voice(1500), silence(260), voice(900, 0.05), silence(100)), R);
  assert.ok(ms(clean) < 1800, `got ${ms(clean)} ms`);
});

test('a long real reply with pauses is left whole', () => {
  const text = 'Nice work today. You beat last week on bench by two and a half kilos, and your squat moved well. Rest up.';
  // ~7 s of speech with natural pauses
  const parts = [];
  for (let i = 0; i < 6; i++) parts.push(voice(1000), silence(220));
  const clean = cleanSpeech(cat(...parts), R, text);
  assert.ok(ms(clean) > 7000, `kept all of it: ${ms(clean)} ms`);
});

test('the reply as received can be saved as a WAV', async () => {
  const { lastClipWav } = await import('../js/tts.js');
  assert.equal(lastClipWav(), null);
});

// a WAV like Gemini's newer voices send: header, samples, then a metadata chunk (the SynthID note)
function geminiWav(samples, rate = 24000, meta = 'This audio has an imperceptible SynthID watermark. digitalSourceType trainedAlgorithmicMedia') {
  const data = new Int16Array(samples.map(v => Math.round(v * 32767)));
  const metaBytes = new TextEncoder().encode(meta + (meta.length % 2 ? ' ' : ''));
  const size = 12 + 24 + 8 + data.byteLength + 8 + metaBytes.length;
  const b = new Uint8Array(size), v = new DataView(b.buffer);
  const put = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); v.setUint32(4, size - 8, true); put(8, 'WAVE');
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  put(36, 'data'); v.setUint32(40, data.byteLength, true); b.set(new Uint8Array(data.buffer), 44);
  const m = 44 + data.byteLength; put(m, 'LIST'); v.setUint32(m + 4, metaBytes.length, true); b.set(metaBytes, m + 8);
  return b;
}

test('a WAV with metadata after the samples: only the samples are played (no burst at the end)', async () => {
  const { pcmBytes, pcmToFloat, audioFrom } = await import('../js/tts.js');
  const w = geminiWav([...voice(600)]);
  const a = pcmBytes(w);
  assert.equal(a.rate, 24000);
  assert.equal(a.bytes.length, Math.round(R * 0.6) * 2);
  const f = pcmToFloat(w.buffer.slice(0), 24000);
  let tail = 0;
  for (let i = f.length - 240; i < f.length; i++) tail = Math.max(tail, Math.abs(f[i]));
  assert.ok(tail < 0.01, `ends quietly, got ${tail}`);
  // two WAV parts join as audio, not header + metadata noise in the middle
  const b64 = Buffer.from(w).toString('base64');
  const r = audioFrom({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: b64 } }, { inlineData: { mimeType: 'audio/wav', data: b64 } }] } }] });
  assert.equal(r.pcm.byteLength, a.bytes.length * 2);
  // raw PCM still works, with the rate from the mime type
  const raw = new Uint8Array(new Int16Array(4800).buffer);
  assert.equal(pcmBytes(raw, 16000).rate, 16000);
  assert.equal(pcmBytes(raw).bytes.length, 9600);
  assert.equal(audioFrom({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from(raw).toString('base64') } }] } }] }).pcm.byteLength, 9600);
});

test('a data chunk with a placeholder size uses what is there; other sample formats say nothing', async () => {
  const { pcmBytes } = await import('../js/tts.js');
  const w = geminiWav([...voice(100)], 24000, 'x');
  new DataView(w.buffer).setUint32(40, 0xFFFFFFFF, true);
  assert.ok(pcmBytes(w).bytes.length > 0);
  const w8 = geminiWav([...voice(100)]);
  new DataView(w8.buffer).setUint16(34, 8, true);
  assert.equal(pcmBytes(w8).bytes.length, 0);
});

import { splitSpeech } from '../js/tts.js';
test('long replies start with their first sentence', () => {
  assert.deepEqual(splitSpeech('Logged.'), ['Logged.']);
  assert.deepEqual(splitSpeech('Bench press, 80 kilos for 8.'), ['Bench press, 80 kilos for 8.']);
  const short = 'Nice work today, Omar. Your bench is up two kilos this month, so next week try 82.5 for 6.';
  assert.deepEqual(splitSpeech(short), [short], 'a normal reply is one request (the free quota is a few a minute)');
  const [a, b] = splitSpeech('Nice work today, Omar. ' + 'Your bench is up two kilos this month, so next week try 82.5 for 6 and keep the rest short. '.repeat(4));
  assert.equal(a, 'Nice work today, Omar.');
  assert.match(b, /^Your bench/);
  assert.equal(splitSpeech('Ok. ' + 'x'.repeat(80)).length, 1, 'a tiny first sentence is not worth its own request');
});
