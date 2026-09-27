import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highpass, speechSpan, normalize, cleanSpeech, RATE } from '../js/audioprep.js';
import { sanitize } from '../js/settings.js';

// a second of gym noise, half a second of "speech" (a louder tone burst), noise again
function clip() {
  const x = new Float32Array(RATE * 2.5);
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < x.length; i++) x[i] = rnd() * 0.02 + Math.sin(i * 2 * Math.PI * 60 / RATE) * 0.05; // hiss + 60 Hz hum
  for (let i = RATE; i < RATE * 1.5; i++) x[i] += Math.sin(i * 2 * Math.PI * 440 / RATE) * 0.3;
  return x;
}

test('the rumble goes, the voice stays', () => {
  const hum = new Float32Array(RATE).map((_, i) => Math.sin(i * 2 * Math.PI * 40 / RATE));
  const voice = new Float32Array(RATE).map((_, i) => Math.sin(i * 2 * Math.PI * 800 / RATE));
  const peak = a => Math.max(...a.slice(RATE / 2).map(Math.abs));
  assert.ok(peak(highpass(hum)) < 0.2, 'a 40 Hz thump is mostly gone');
  assert.ok(peak(highpass(voice)) > 0.9, 'an 800 Hz voice passes');
});

test('the noise around the words is cut', () => {
  const x = highpass(clip());
  const s = speechSpan(x);
  assert.ok(s, 'speech found');
  assert.ok(s.start > RATE * 0.6 && s.start < RATE, `starts near the words (${s.start})`);
  assert.ok(s.end > RATE * 1.5 && s.end < RATE * 1.9, `ends near the words (${s.end})`);
});

test('silence is not sent; flat speech is kept whole', () => {
  assert.equal(cleanSpeech(new Float32Array(RATE)), null);
  const talk = new Float32Array(RATE).map((_, i) => Math.sin(i * 2 * Math.PI * 300 / RATE) * 0.3);
  const wav = cleanSpeech(talk);
  assert.ok(wav && wav.byteLength > 44 + RATE, 'kept');
});

test('the level is evened out, within reason', () => {
  const quiet = new Float32Array([0.1, -0.05]);
  assert.ok(Math.abs(Math.max(...normalize(quiet)) - 0.8) < 0.01, 'at most 8× louder');
});

test('everyone moves to the accurate speech model once', () => {
  assert.equal(sanitize({ stt: 'fast' }).stt, 'accurate');
  assert.equal(sanitize({ stt: 'fast', sttV: 2 }).stt, 'fast', 'a choice made after that is kept');
});
