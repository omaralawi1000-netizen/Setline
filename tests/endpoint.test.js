import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEndpointer, looksUnfinished } from '../js/endpoint.js';

const run = (ep, level, ms) => { const ev = []; for (let t = 0; t < ms; t += 16) { const e = ep.push(level, 16); if (e) ev.push(e); } return ev; };

test('a pause after speech is raised once, speaking again resumes', () => {
  const ep = createEndpointer();
  assert.deepEqual(run(ep, 0.08, 800), [], 'quiet room before speaking');
  assert.deepEqual(run(ep, 0.55, 900), []);
  assert.deepEqual(run(ep, 0.08, 600), [], 'a breath is not a pause');
  assert.deepEqual(run(ep, 0.5, 300), []);
  assert.deepEqual(run(ep, 0.08, 1500), ['pause']);
  assert.deepEqual(run(ep, 0.08, 1500), [], 'raised once');
  assert.deepEqual(run(ep, 0.6, 200), ['resume']);
  assert.deepEqual(run(ep, 0.08, 1500), ['pause']);
});

test('a cough does not count as speech, music is not speech', () => {
  const a = createEndpointer();
  run(a, 0.1, 500); run(a, 0.6, 100);
  assert.deepEqual(run(a, 0.1, 2000), []);
  const b = createEndpointer();
  assert.deepEqual(run(b, 0.3, 3000), []);
  run(b, 0.7, 1000);
  assert.deepEqual(run(b, 0.3, 1500), ['pause']);
});

test('half sentences wait, whole ones go', () => {
  for (const s of ['', 'I did 80 kilos for', 'bench press and', 'um', 'I want to build muscle and...', 'jeg vil gerne have en plan med', 'øh', 'sets of 8,', 'my knee is -']) assert.ok(looksUnfinished(s), s);
  for (const s of ['80 kilos for 8', 'Start push day.', 'How is my bench going?', 'jeg er 27 år', 'I train five days a week.']) assert.ok(!looksUnfinished(s), s);
});
