import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orbFrame, resolvePreset } from '../js/orbs.js';

// The ported engine must draw exactly what the original thinking-orbs library draws: its own golden
// vectors (dot for dot, in draw order) for every state and size Setline uses.
const golden = JSON.parse(readFileSync(new URL('./fixtures/orbs-golden.json', import.meta.url), 'utf8'));

test('thinking orbs: the port matches the library, dot for dot', () => {
  assert.ok(golden.cases.length >= 16);
  for (const c of golden.cases) {
    const f = orbFrame(c.state, c.size, c.t);
    assert.equal(f.dots.length, c.dotCount, `${c.key}: dot count`);
    for (let k = 0; k * 6 < c.dots.length; k++) {
      const d = f.dots[k * c.every], g = c.dots.slice(k * 6, k * 6 + 6);
      const got = [d.x, d.y, d.z, d.r, d.white, d.a ?? 1];
      for (let j = 0; j < 6; j++) assert.ok(Math.abs(got[j] - g[j]) <= golden.tolerance, `${c.key} dot ${k * c.every} field ${j}: ${got[j]} vs ${g[j]}`);
    }
  }
});

test('thinking orbs: presets resolve once and keep the shipped speeds', () => {
  assert.equal(resolvePreset('breathing', 20), resolvePreset('breathing', 20));
  assert.equal(resolvePreset('searching', 20).speed, 2.665);
  assert.equal(resolvePreset('composing', 64).mode, 'ribbon');
});
