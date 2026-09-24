import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platesFor } from '../js/plates.js';
import { warmupRamp } from '../js/warmup.js';
import { makeBackup, validateBackup } from '../js/backup.js';
import { weeklySeries, prTimeline, liftSummaries, weekStart } from '../js/stats.js';
import { sanitize } from '../js/settings.js';
import { makeSet } from '../js/workout.js';

test('plates per side, greedy, with remainders', () => {
  assert.deepEqual(platesFor(100).perSide, [25, 15]);
  assert.deepEqual(platesFor(142.5).perSide, [25, 25, 10, 1.25]);
  assert.equal(platesFor(142.5).total, 142.5);
  assert.deepEqual(platesFor(20).perSide, []);
  assert.equal(platesFor(15).under, true);
  assert.deepEqual(platesFor(61, 20).perSide, [20]);
  assert.equal(platesFor(61, 20).remainder, 1);
  assert.deepEqual(platesFor(50, 15).perSide, [15, 2.5]);
  assert.deepEqual(platesFor(12.5, 0).perSide, [5, 1.25]);
});

test('warm-up ramp skips steps that are not lighter', () => {
  assert.deepEqual(warmupRamp(100).map(s => [s.kg, s.reps]), [[20, 10], [50, 5], [70, 3], [85, 2]]);
  assert.deepEqual(warmupRamp(40).map(s => s.kg), [20, 27.5, 35]);
  assert.deepEqual(warmupRamp(20), []);
  assert.ok(warmupRamp(100).every(s => s.type === 'warmup'));
});

const T = new Date(2026, 8, 24, 18).getTime();
const w = (id, t, kg, reps, prs = []) => ({ id, startedAt: t, finishedAt: t + 3600000, exercises: [{ exerciseId: 'bench-press', sets: [makeSet({ kg, reps, done: true })] }], prs });
const state = {
  settings: { ...sanitize({}), ttsModel: 'x', cmdModel: 'y' },
  history: [w('a', T - 86400000 * 8, 80, 8), w('b', T - 86400000, 85, 5, [{ id: 'bench-press|weight', exerciseId: 'bench-press', kind: 'weight', kg: 85, reps: 5, value: 85 }])],
  cardio: [{ id: 'c1', type: 'run', startedAt: T - 3600000, durationSec: 1800, distanceKm: 5, zone: 2 }],
  routines: [{ id: 'r1', name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8, kg: null }] }] }],
  custom: [], prs: [{ id: 'bench-press|weight', exerciseId: 'bench-press', kind: 'weight', kg: 85, reps: 5, value: 85 }],
  bodyweight: [{ date: '2026-09-24', kg: 82 }], nutrition: [{ date: '2026-09-24', protein: 90 }], chat: [{ id: 'm1', role: 'user', text: 'hi', at: T }]
};

test('backup round trip, no keys or model picks', () => {
  const b = makeBackup(state, T);
  const json = JSON.parse(JSON.stringify(b));
  assert.equal(json.data.settings.ttsModel, undefined);
  assert.doesNotMatch(JSON.stringify(json), /groq|gsk_|AIza/);
  const v = validateBackup(json);
  assert.equal(v.ok, true);
  assert.equal(v.data.workouts.length, 2);
  assert.equal(v.data.cardio[0].distanceKm, 5);
});

test('a bad backup is rejected as a whole', () => {
  const b = JSON.parse(JSON.stringify(makeBackup(state, T)));
  assert.equal(validateBackup({}).error, 'kind');
  assert.equal(validateBackup({ ...b, version: 9 }).error, 'version');
  const bad = JSON.parse(JSON.stringify(b)); bad.data.workouts[1].exercises[0].sets[0].reps = 0;
  assert.equal(validateBackup(bad).error, 'workouts[1]');
  const bad2 = JSON.parse(JSON.stringify(b)); bad2.data.cardio[0].type = 'teleport';
  assert.equal(validateBackup(bad2).ok, false);
  const bad3 = JSON.parse(JSON.stringify(b)); bad3.data.bodyweight = 'lots';
  assert.equal(validateBackup(bad3).error, 'bodyweight');
  const withKey = JSON.parse(JSON.stringify(b)); withKey.data.settings.groq = 'gsk_x';
  assert.equal(validateBackup(withKey).data.settings.groq, undefined, 'keys never come back in');
});

test('progress series', () => {
  const ws = weeklySeries(state.history, state.cardio, 4, T);
  assert.equal(ws.length, 4);
  assert.equal(ws[3].t, weekStart(T));
  assert.equal(ws[3].volume, 425);
  assert.equal(ws[3].cardioMin, 30);
  assert.equal(ws[3].sessions, 2);
  assert.equal(prTimeline(state.history)[0].pr.kg, 85);
  const lifts = liftSummaries(state.history);
  assert.equal(lifts[0].id, 'bench-press');
  assert.equal(lifts[0].sessions, 2);
  assert.equal(lifts[0].series.length, 2);
});

import * as W from '../js/workout.js';
test('warm-ups are a checklist that logging skips', () => {
  let w = W.createWorkout({ exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 100, reps: 5 }, { kg: 100, reps: 5 }] }] }, T);
  w = W.addWarmups(w, 0, warmupRamp(100));
  assert.equal(w.exercises[0].sets.length, 6);
  assert.equal(W.nextSetNumber(w.exercises[0]), 1, 'warm-ups do not count as set numbers');
  const r = W.logSet(w, 0, { kg: 100, reps: 5 }, T);
  const logged = r.workout.exercises[0].sets.find(s => s.done);
  assert.equal(logged.type, 'normal', 'a logged set fills the first working set, not a warm-up');
  assert.equal(W.addWarmups(r.workout, 0, warmupRamp(100)), r.workout, 'only once');
  const wu = w.exercises[0].sets[0];
  const c = W.completeWarmup(w, 0, wu.id, T);
  assert.equal(c.exercises[0].sets[0].done, true);
  assert.equal(W.volume(c), 0, 'warm-ups never count toward volume');
  assert.equal(W.setNumberAt(w.exercises[0], 4), 1);
  const f = W.finishWorkout(W.logSet(c, 0, { kg: 100, reps: 5 }, T).workout, T + 1);
  assert.equal(f.exercises[0].sets.filter(s => s.type === 'warmup').length, 1, 'undone warm-ups are dropped');
});
