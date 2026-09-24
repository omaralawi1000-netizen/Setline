import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEndpointer } from '../js/vad.js';

const run = (ep, level, ms) => { let done = false; for (let t = 0; t < ms; t += 16) done = ep.push(level, 16) || done; return done; };

test('tap-to-talk stops after speech and a pause', () => {
  const ep = createEndpointer();
  assert.equal(run(ep, 0.08, 800), false, 'quiet room before speaking: keep waiting');
  assert.equal(run(ep, 0.55, 900), false, 'speaking');
  assert.equal(run(ep, 0.4, 0) || run(ep, 0.08, 600), false, 'a short breath is not the end');
  assert.equal(run(ep, 0.5, 400), false);
  assert.equal(run(ep, 0.08, 1100), true, 'a real pause ends it');
});

test('a cough does not start it, a noisy room does not trap it', () => {
  const a = createEndpointer();
  run(a, 0.1, 500); run(a, 0.6, 100);
  assert.equal(run(a, 0.1, 2000), false, 'too little speech to count');
  const b = createEndpointer();
  run(b, 0.3, 1500);                 // gym music
  assert.equal(run(b, 0.3, 1500), false, 'music alone is not speech');
  run(b, 0.7, 1000);                 // talking over it
  assert.equal(run(b, 0.3, 1200), true, 'back to the music level ends it');
});
