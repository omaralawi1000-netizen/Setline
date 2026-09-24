import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVad, toWav } from '../js/vad.js';

const R = 16000;
let seed = 3;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
const noise = (ms, amp) => Float32Array.from({ length: R * ms / 1000 }, () => amp * rnd());
const voice = (ms, amp = 0.2) => Float32Array.from({ length: R * ms / 1000 }, (_, i) => amp * Math.sin(2 * Math.PI * 180 * i / R) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * i / R)) + 0.003 * rnd());
const cat = (...p) => { const o = new Float32Array(p.reduce((a, x) => a + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const feed = (vad, sig) => { const out = []; for (let i = 0; i < sig.length; i += 2048) out.push(...vad.push(sig.subarray(i, i + 2048))); return out; };

test('one utterance in a quiet room, with a little pre-roll', () => {
  const vad = createVad({ rate: R });
  const out = feed(vad, cat(noise(1000, 0.003), voice(800), noise(1200, 0.003)));
  assert.equal(out.length, 1);
  const ms = out[0].length / R * 1000;
  assert.ok(ms > 1000 && ms < 1600, `~0.4 s pre + 0.8 s speech + 0.2 s tail, got ${ms}`);
});

test('a short click or clang is not speech', () => {
  const vad = createVad({ rate: R });
  assert.equal(feed(vad, cat(noise(800, 0.003), voice(80, 0.6), noise(1500, 0.003))).length, 0);
});

test('a loud but steady room raises the floor; speech above it still counts', () => {
  const vad = createVad({ rate: R });
  const out = feed(vad, cat(noise(3000, 0.03), voice(900, 0.35), noise(1500, 0.03)));
  assert.equal(out.length, 1);
  assert.ok(vad.floor > 0.01, 'floor followed the room');
});

test('two commands with a pause are two utterances; long talk is cut at the max', () => {
  let vad = createVad({ rate: R });
  assert.equal(feed(vad, cat(noise(500, 0.003), voice(600), noise(1200, 0.003), voice(700), noise(1200, 0.003))).length, 2);
});

test('music that keeps going is learned as the room, not sent over and over', () => {
  const vad = createVad({ rate: R, maxMs: 3000 });
  const out = feed(vad, cat(noise(800, 0.003), voice(12000, 0.15)));
  assert.ok(vad.floor > 0.02, 'floor rose to the music');
  out.push(...feed(vad, noise(1500, 0.003)));
  assert.equal(out.length, 0, 'nothing sent');
  // a command said over the music, louder than it, still gets through
  const vad2 = createVad({ rate: R, maxMs: 3000 });
  const music = n => voice(n, 0.1);
  const got = feed(vad2, cat(music(8000), (() => { const m = music(900); const c = voice(900, 0.5); return c.map((x, i) => x + m[i]); })(), music(1500)));
  assert.equal(got.length, 1);
});

test('reset drops what was being heard', () => {
  const vad = createVad({ rate: R });
  feed(vad, cat(noise(500, 0.003), voice(500)));
  assert.equal(vad.speaking, true);
  vad.reset();
  assert.equal(feed(vad, noise(1500, 0.003)).length, 0);
});

test('wav: header and downsampling', () => {
  const buf = toWav(new Float32Array(48000).fill(0.5), 48000, 16000);
  const v = new DataView(buf);
  assert.equal(String.fromCharCode(...new Uint8Array(buf, 0, 4)), 'RIFF');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(40, true), 32000);
  assert.equal(buf.byteLength, 44 + 32000);
  assert.ok(Math.abs(v.getInt16(44 + 100, true) - 16383) < 2);
});
