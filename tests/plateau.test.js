import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stalledLifts, applyPlateauFix, newReps } from '../js/plateau.js';
import { createCatalog } from '../js/catalog.js';

const catalog = createCatalog();
const DAY = 86_400_000, now = Date.UTC(2026, 8, 24);
const session = (daysAgo, kg, reps) => ({ startedAt: now - daysAgo * DAY, exercises: [{ exerciseId: 'bench-press', sets: [{ kg, reps, done: true, type: 'normal' }] }] });
const routines = [{ id: 'r1', name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8, kg: null }, { reps: 8, kg: null }] }, { exerciseId: 'lateral-raise', sets: [{ reps: 12, kg: null }] }] }];

test('three sessions over two weeks without a new best is a stall', () => {
  const h = [session(35, 90, 8), session(28, 92.5, 8), session(18, 92.5, 7), session(11, 92.5, 8), session(4, 90, 8)];
  const s = stalledLifts(h, routines, { catalog, now });
  assert.equal(s.length, 1);
  assert.equal(s[0].exerciseId, 'bench-press');
  assert.equal(s[0].toReps, 5);
  assert.equal(s[0].swapTo, 'incline-bench-press');
  assert.equal(stalledLifts(h, routines, { catalog, now, snooze: { 'bench-press': now + DAY } }).length, 0, 'snoozed');
});

test('progress, too few sessions or a short span is not a stall', () => {
  assert.equal(stalledLifts([session(30, 90, 8), session(20, 92.5, 8), session(10, 95, 8), session(3, 97.5, 8)], routines, { catalog, now }).length, 0);
  assert.equal(stalledLifts([session(20, 90, 8), session(10, 90, 8), session(3, 90, 8)], routines, { catalog, now }).length, 0);
  assert.equal(stalledLifts([session(30, 92.5, 8), session(8, 90, 8), session(5, 90, 8), session(2, 90, 8)], routines, { catalog, now }).length, 0, 'span < 14 days');
  assert.equal(stalledLifts([session(80, 92.5, 8), session(70, 90, 8), session(60, 90, 8), session(50, 90, 8)], routines, { catalog, now }).length, 0, 'not trained lately');
});

test('fixes apply to the plan', () => {
  const stall = { exerciseId: 'bench-press', toReps: 5, swapTo: 'incline-bench-press' };
  const r = applyPlateauFix(routines, stall, 'reps');
  assert.deepEqual(r[0].exercises[0].sets.map(s => s.reps), [5, 5]);
  assert.equal(r[0].exercises[1], routines[0].exercises[1]);
  const s = applyPlateauFix(routines, stall, 'swap');
  assert.equal(s[0].exercises[0].exerciseId, 'incline-bench-press');
  assert.equal(s[0].exercises[0].sets.length, 2);
  assert.deepEqual([newReps(5), newReps(8), newReps(12)], [10, 5, 6]);
});
