import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, PATTERN_OF, patternFor, posePaths } from '../js/figures.js';
import { createCatalog } from '../js/catalog.js';

const cmds = d => d.replace(/[-\d.\s]+/g, '');

test('every exercise has a figure', () => {
  for (const e of createCatalog().all) assert.ok(PATTERNS[patternFor(e)], e.id);
  for (const p of Object.values(PATTERN_OF)) assert.ok(PATTERNS[p], p);
  assert.equal(patternFor({ id: 'c-x', muscles: ['biceps'] }), 'curl');
});

test('start and end poses morph: same commands, joints stay a plausible length', () => {
  for (const name of Object.keys(PATTERNS)) {
    const a = posePaths(name, 'a'), b = posePaths(name, 'b');
    for (const k of ['far', 'near', 'head', 'prop']) assert.equal(cmds(a[k]), cmds(b[k]), `${name}.${k}`);
    assert.ok(!/NaN|undefined/.test(JSON.stringify([a, b])), name);
    const P = PATTERNS[name];
    for (const w of ['a', 'b']) {
      const q = P[w];
      const d = (x, y) => Math.hypot(q[x][0] - q[y][0], q[x][1] - q[y][1]);
      assert.ok(d('n', 'p') > 12 && d('n', 'p') < 24, `${name}.${w} torso ${d('n', 'p').toFixed(1)}`);
      assert.ok(d('p', 'k1') > 7 && d('p', 'k1') < 17, `${name}.${w} thigh ${d('p', 'k1').toFixed(1)}`);
      assert.ok(d('n', 'e1') > 6 && d('n', 'e1') < 14, `${name}.${w} upper arm ${d('n', 'e1').toFixed(1)}`);
      assert.ok(d('e1', 'w1') > 5 && d('e1', 'w1') < 14, `${name}.${w} forearm ${d('e1', 'w1').toFixed(1)}`);
    }
  }
});
