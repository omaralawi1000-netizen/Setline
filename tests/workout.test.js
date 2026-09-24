import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/workout.js';

const T0 = 1_700_000_000_000;
const routine = { name: 'Push day', routineId: 'push-day', exercises: [
  { exerciseId: 'bench-press', sets: [{ reps: 8, kg: 80 }, { reps: 8, kg: 80 }] },
  { exerciseId: 'overhead-press', sets: [{ reps: 8 }] }
] };

test('createWorkout builds planned sets', () => {
  const w = W.createWorkout(routine, T0);
  assert.equal(w.startedAt, T0);
  assert.equal(w.exercises.length, 2);
  assert.deepEqual(w.exercises[0].sets.map(s => s.done), [false, false]);
  assert.equal(w.exercises[1].sets[0].kg, null);
  assert.equal(w.current, 0);
  assert.equal(w.rest, null);
});

test('logSet fills the first planned set', () => {
  const w = W.createWorkout(routine, T0);
  const { workout, set } = W.logSet(w, 0, { kg: 82.5, reps: 7 }, T0 + 1000, 90);
  assert.equal(workout.exercises[0].sets.length, 2);
  assert.equal(workout.exercises[0].sets[0].id, set.id);
  assert.equal(set.kg, 82.5);
  assert.equal(set.done, true);
  assert.equal(set.completedAt, T0 + 1000);
  assert.equal(workout.exercises[0].sets[1].done, false);
  assert.equal(w.exercises[0].sets[0].done, false, 'input is not mutated');
});

test('logSet appends when no planned set is left', () => {
  let w = W.createWorkout(routine, T0);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  const r = W.logSet(w, 0, { kg: 80, reps: 6 }, T0);
  assert.equal(r.workout.exercises[0].sets.length, 3);
  assert.equal(r.workout.exercises[0].sets[2].reps, 6);
});

test('rest starts only when a set is logged and is derived from timestamps', () => {
  const w = W.createWorkout(routine, T0);
  assert.equal(W.restRemaining(w.rest, T0), 0);
  const { workout } = W.logSet(w, 0, { kg: 80, reps: 8 }, T0, 90);
  assert.deepEqual(workout.rest, { startedAt: T0, endsAt: T0 + 90000, duration: 90 });
  assert.equal(W.restRemaining(workout.rest, T0 + 18_000), 72);
  assert.equal(W.restRemaining(workout.rest, T0 + 17_500), 73, 'rounds up');
  assert.equal(W.restRemaining(workout.rest, T0 + 999_999), 0);
  assert.equal(W.restProgress(workout.rest, T0 + 45_000), 0.5);
});

test('adjustRest adds and removes 15 s, never below now', () => {
  let w = W.logSet(W.createWorkout(routine, T0), 0, { kg: 80, reps: 8 }, T0, 90).workout;
  w = W.adjustRest(w, 15, T0 + 10_000);
  assert.equal(W.restRemaining(w.rest, T0 + 10_000), 95);
  assert.equal(w.rest.duration, 105);
  w = W.adjustRest(w, -15, T0 + 10_000);
  assert.equal(W.restRemaining(w.rest, T0 + 10_000), 80);
  w = W.adjustRest(w, -300, T0 + 10_000);
  assert.equal(W.restRemaining(w.rest, T0 + 10_000), 0);
  assert.equal(W.adjustRest(w, 15, T0 + 20_000), w, 'no-op once rest is over');
});

test('skipRest clears rest', () => {
  const w = W.logSet(W.createWorkout(routine, T0), 0, { kg: 80, reps: 8 }, T0).workout;
  assert.equal(W.skipRest(w).rest, null);
});

test('validateSet enforces limits and asks for confirmation', () => {
  assert.deepEqual(W.validateSet(80, 8), { ok: true, confirm: [] });
  assert.deepEqual(W.validateSet(0, 10), { ok: true, confirm: [] }, 'bodyweight is 0 kg');
  assert.equal(W.validateSet(80, 0).ok, false, '0 reps rejected');
  assert.equal(W.validateSet(80, 301).ok, false);
  assert.equal(W.validateSet(80, 7.5).ok, false);
  assert.equal(W.validateSet(-1, 5).ok, false);
  assert.equal(W.validateSet(1501, 5).ok, false);
  assert.equal(W.validateSet(NaN, 5).ok, false);
  assert.deepEqual(W.validateSet(520, 5).confirm, ['kg']);
  assert.deepEqual(W.validateSet(500, 100).confirm, []);
  assert.deepEqual(W.validateSet(60, 120).confirm, ['reps']);
  assert.throws(() => W.logSet(W.createWorkout(routine, T0), 0, { kg: 80, reps: 0 }));
});

test('max 100 sets per exercise and 60 exercises per workout', () => {
  let w = W.createWorkout({ exercises: [{ exerciseId: 'a', sets: [] }] }, T0);
  for (let i = 0; i < 100; i++) w = W.logSet(w, 0, { kg: 20, reps: 5 }, T0).workout;
  assert.throws(() => W.logSet(w, 0, { kg: 20, reps: 5 }, T0), RangeError);
  let e = W.createWorkout({}, T0);
  for (let i = 0; i < 60; i++) e = W.addExercise(e, 'x' + i);
  assert.throws(() => W.addExercise(e, 'more'), RangeError);
});

test('editLastDone corrects the last done set only', () => {
  let w = W.createWorkout(routine, T0);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  const e = W.editLastDone(w, 0, { kg: 80, reps: 6 });
  assert.equal(e.exercises[0].sets[0].reps, 8);
  assert.equal(e.exercises[0].sets[1].reps, 6);
  const none = W.createWorkout(routine, T0);
  assert.equal(W.editLastDone(none, 0, { kg: 1, reps: 1 }), none);
});

test('deleteSet removes by id', () => {
  let w = W.logSet(W.createWorkout(routine, T0), 0, { kg: 80, reps: 8 }, T0).workout;
  const id = w.exercises[0].sets[0].id;
  w = W.deleteSet(w, 0, id);
  assert.equal(w.exercises[0].sets.length, 1);
  assert.equal(w.exercises[0].sets[0].done, false);
});

test('nextSetNumber follows planned sets then appends', () => {
  let w = W.createWorkout(routine, T0);
  assert.equal(W.nextSetNumber(w.exercises[0]), 1);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  assert.equal(W.nextSetNumber(w.exercises[0]), 2);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  assert.equal(W.nextSetNumber(w.exercises[0]), 3);
});

test('add, remove and move between exercises keeps current valid', () => {
  let w = W.createWorkout(routine, T0);
  w = W.addExercise(w, 'lateral-raise');
  assert.equal(w.current, 2);
  w = W.removeExercise(w, 0);
  assert.equal(w.current, 1);
  assert.equal(w.exercises[w.current].exerciseId, 'lateral-raise');
  w = W.setCurrent(w, 99);
  assert.equal(w.current, 1);
  w = W.removeExercise(w, 1);
  w = W.removeExercise(w, 0);
  assert.equal(w.exercises.length, 0);
  assert.equal(w.current, 0);
});

test('volume and set count skip warm-ups and planned sets', () => {
  let w = W.createWorkout(routine, T0);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0).workout;
  w = W.logSet(w, 1, { kg: 50, reps: 5 }, T0).workout;
  w.exercises[0].sets.push(W.makeSet({ kg: 40, reps: 10, type: 'warmup', done: true }));
  assert.equal(W.volume(w), 80 * 8 + 50 * 5);
  assert.equal(W.doneSetCount(w), 3);
});

test('finishWorkout drops planned sets and empty exercises', () => {
  let w = W.createWorkout(routine, T0);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T0 + 60_000).workout;
  const f = W.finishWorkout(w, T0 + 3_600_000);
  assert.equal(f.finishedAt, T0 + 3_600_000);
  assert.equal(f.exercises.length, 1);
  assert.equal(f.exercises[0].sets.length, 1);
  assert.equal(f.rest, null);
  assert.equal(W.elapsedSec(f), 3600);
});

test('lastSession finds the most recent finished session of an exercise', () => {
  const mk = (id, t, kg) => ({ id, startedAt: t, exercises: [{ exerciseId: 'bench-press', sets: [W.makeSet({ kg, reps: 8, done: true })] }] });
  const hist = [mk('a', T0, 70), mk('c', T0 + 2, 77.5), mk('b', T0 + 1, 75)];
  const last = W.lastSession(hist, 'bench-press');
  assert.equal(last.workoutId, 'c');
  assert.equal(last.sets[0].kg, 77.5);
  assert.equal(W.lastSession(hist, 'deadlift'), null);
});

test('suggestNext: draft, planned, last done, last session, default', () => {
  const ex = { sets: [W.makeSet({ kg: 80, reps: 8 })], draft: null };
  assert.deepEqual(W.suggestNext(ex, null), { kg: 80, reps: 8 });
  assert.deepEqual(W.suggestNext({ ...ex, draft: { kg: 85, reps: 5 } }, null), { kg: 85, reps: 5 });
  const planNoKg = { sets: [W.makeSet({ kg: 60, reps: 8, done: true }), W.makeSet({ reps: 10 })], draft: null };
  assert.deepEqual(W.suggestNext(planNoKg, null), { kg: 60, reps: 10 });
  const last = { sets: [W.makeSet({ kg: 70, reps: 6, done: true }), W.makeSet({ kg: 72.5, reps: 5, done: true })] };
  assert.deepEqual(W.suggestNext({ sets: [], draft: null }, last), { kg: 70, reps: 6 });
  assert.deepEqual(W.suggestNext({ sets: [], draft: null }, null), { kg: 20, reps: 8 });
  assert.deepEqual(W.suggestNext({ sets: [], draft: null }, null, 0), { kg: 0, reps: 8 });
});

test('planFromHistory fills planned kg from the last session', () => {
  const hist = [{ id: 'h', startedAt: T0, exercises: [{ exerciseId: 'bench-press', sets: [
    W.makeSet({ kg: 77.5, reps: 8, done: true }), W.makeSet({ kg: 75, reps: 8, done: true })] }] }];
  const plan = W.planFromHistory({ id: 'push-day', name: 'Push day', exercises: [
    { exerciseId: 'bench-press', sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
    { exerciseId: 'overhead-press', sets: [{ reps: 8 }] }] }, hist);
  assert.deepEqual(plan.exercises[0].sets.map(s => s.kg), [77.5, 75, 75]);
  assert.equal(plan.exercises[1].sets[0].kg, null);
  assert.equal(plan.routineId, 'push-day');
});
