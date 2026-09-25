import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presets } from '../js/motion-tokens.js';
import { springBlock } from '../scripts/springs.mjs';

test('motion presets are the five agreed ones', () => {
  assert.deepEqual(Object.keys(presets), ['tap', 'fast', 'default', 'expressive', 'fade']);
  const v = n => [presets[n].visualDuration, presets[n].bounce];
  assert.deepEqual(v('tap'), [0.15, 0]);
  assert.deepEqual(v('fast'), [0.25, 0.15]);
  assert.deepEqual(v('default'), [0.35, 0.2]);
  assert.deepEqual(v('expressive'), [0.5, 0.3]);
  assert.equal(presets.fade.duration, 0.2);
  assert.equal(presets.fade.type, undefined); // never springy
});

test('css/motion.css springs match js/motion-tokens.js (run node scripts/springs.mjs)', () => {
  const css = readFileSync(new URL('../css/motion.css', import.meta.url), 'utf8');
  assert.ok(css.includes(springBlock()), 'css/motion.css is out of date: run node scripts/springs.mjs');
});
