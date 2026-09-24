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
  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set([0x52, 0x49, 0x46, 0x46]); wav.set(new Uint8Array(pcm.buffer), 44);
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
