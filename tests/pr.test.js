import { test } from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, applyWorkout, rebuild, bestsFrom, livePRSets, prId } from '../js/pr.js';
import { makeSet } from '../js/workout.js';

const set = (kg, reps, type = 'normal') => makeSet({ kg, reps, type, done: true, completedAt: 1 });
const wo = (id, t, bySets) => ({ id, startedAt: t, exercises: Object.entries(bySets).map(([exerciseId, sets]) => ({ exerciseId, sets })) });

test('Epley e1RM, 1 rep equals kg', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(100, 10), 133.3);
  assert.equal(e1rm(80, 8), 101.3);
  assert.equal(e1rm(0, 10), 0);
  assert.equal(e1rm(100, 0), 0);
});

test('first session sets a baseline, not PRs', () => {
  const { records, prs } = applyWorkout([], wo('w1', 1, { bench: [set(80, 8), set(80, 8)] }));
  assert.equal(prs.length, 0);
  const b = bestsFrom(records, 'bench');
  assert.equal(b.weight.value, 80);
  assert.equal(b.e1rm.value, 101.3);
  assert.equal(b.reps['80'].reps, 8);
});

test('later session beating the baseline creates PRs with workout, set and date', () => {
  let r = applyWorkout([], wo('w1', 1, { bench: [set(80, 8)] })).records;
  const heavy = set(85, 5), more = set(80, 10);
  const res = applyWorkout(r, wo('w2', 2, { bench: [heavy, more] }));
  const kinds = res.prs.map(p => p.kind).sort();
  assert.deepEqual(kinds, ['e1rm', 'reps', 'weight']);
  const w = res.prs.find(p => p.kind === 'weight');
  assert.equal(w.setId, heavy.id);
  assert.equal(w.workoutId, 'w2');
  assert.equal(w.date, 1);
  assert.equal(res.prs.find(p => p.kind === 'e1rm').setId, more.id, '80x10 (106.7) beats 85x5 (99.2)');
  assert.equal(res.prs.find(p => p.kind === 'reps').id, prId('bench', 'reps', 80));
});

test('equal performance is not a PR', () => {
  const r = applyWorkout([], wo('w1', 1, { bench: [set(80, 8)] })).records;
  assert.equal(applyWorkout(r, wo('w2', 2, { bench: [set(80, 8)] })).prs.length, 0);
});

test('reps PR needs history at that exact weight', () => {
  const r = applyWorkout([], wo('w1', 1, { bench: [set(80, 8)] })).records;
  const res = applyWorkout(r, wo('w2', 2, { bench: [set(70, 15)] }));
  assert.deepEqual(res.prs.map(p => p.kind), ['e1rm']);
  assert.equal(bestsFrom(res.records, 'bench').reps['70'].reps, 15, 'new weight becomes a baseline');
});

test('warm-up sets never count', () => {
  const r = applyWorkout([], wo('w1', 1, { bench: [set(80, 8)] })).records;
  const res = applyWorkout(r, wo('w2', 2, { bench: [set(120, 3, 'warmup')] }));
  assert.equal(res.prs.length, 0);
  assert.equal(bestsFrom(res.records, 'bench').weight.value, 80);
});

test('one PR per kind per workout, pointing at the best set', () => {
  const r = applyWorkout([], wo('w1', 1, { bench: [set(80, 5)] })).records;
  const a = set(82.5, 5), b = set(85, 5);
  const res = applyWorkout(r, wo('w2', 2, { bench: [a, b] }));
  assert.equal(res.prs.filter(p => p.kind === 'weight').length, 1);
  assert.equal(res.prs.find(p => p.kind === 'weight').setId, b.id);
});

test('rebuild replays history in date order', () => {
  const w1 = wo('w1', 1, { bench: [set(80, 8)] });
  const w2 = wo('w2', 2, { bench: [set(85, 8)] });
  const { byWorkout, records } = rebuild([w2, w1]);
  assert.equal(byWorkout.w1.length, 0);
  assert.ok(byWorkout.w2.length >= 2);
  assert.equal(bestsFrom(records, 'bench').weight.value, 85);
});

test('livePRSets marks sets in the active workout', () => {
  const r = applyWorkout([], wo('w1', 1, { bench: [set(80, 8)] })).records;
  const s = set(90, 3);
  const live = livePRSets(r, wo('now', 3, { bench: [set(80, 6), s], squat: [set(140, 5)] }));
  assert.deepEqual(live.get(s.id), ['weight']);
  assert.equal(live.size, 1, 'squat has no baseline yet');
});
