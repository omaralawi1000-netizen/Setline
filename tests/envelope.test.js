import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelope } from '../js/tts.js';

test('envelope: quiet then loud, normalised to 0..1', () => {
  const rate = 1000, s = new Float32Array(300);
  for (let i = 150; i < 300; i++) s[i] = i % 2 ? 0.5 : -0.5;
  const e = envelope(s, rate);
  assert.equal(e.length, 10); // 30 ms steps
  assert.equal(e[0], 0);
  assert.equal(e[9], 1);
  assert.ok(e.every(v => v >= 0 && v <= 1));
});

test('envelope: silence stays at zero', () => {
  const e = envelope(new Float32Array(100), 1000);
  assert.ok(e.every(v => v === 0));
});
