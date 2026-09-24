import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/cardio.js';
import { suggest, stepFor, easyDay } from '../js/progression.js';
import { upsertBodyweight, bodyTrend, proteinTarget, addProtein, validBodyweight, dateKey } from '../js/body.js';
import { weekStreak, weekReview, weekStart } from '../js/stats.js';
import * as R from '../js/routines.js';
import { createCatalog } from '../js/catalog.js';
import { makeSet } from '../js/workout.js';

const cat = createCatalog();
const T = new Date(2026, 8, 24, 18).getTime(); // Thu
const DAY = 86_400_000;
const wo = (t, exId, sets) => ({ id: 'w' + t, startedAt: t, finishedAt: t + 3600_000, exercises: [{ exerciseId: exId, sets: sets.map(([kg, reps]) => makeSet({ kg, reps, done: true })) }] });

// ---------- cardio ----------
test('live cardio: pause and resume from timestamps', () => {
  let a = C.startCardio('run', T);
  assert.equal(C.cardioElapsed(a, T + 60_000), 60);
  a = C.pauseCardio(a, T + 60_000);
  assert.equal(C.cardioElapsed(a, T + 999_000), 60, 'paused time does not count');
  a = C.resumeCardio(a, T + 120_000);
  assert.equal(C.cardioElapsed(a, T + 180_000), 120);
  const s = C.finishCardio(a, { distanceKm: 0.4, zone: 2 }, T + 180_000);
  assert.equal(s.durationSec, 120);
  assert.equal(s.source, 'live');
});

test('pace, speed and splits', () => {
  assert.equal(C.paceText({ type: 'run', durationSec: 1500, distanceKm: 5 }), '5:00 /km');
  assert.equal(C.paceText({ type: 'bike', durationSec: 3600, distanceKm: 28.4 }), '28.4 km/h');
  assert.equal(C.paceText({ type: 'bike', durationSec: 3600, distanceKm: 28.4 }, 'da'), '28,4 km/t');
  assert.equal(C.paceText({ type: 'row', durationSec: 480, distanceKm: 2 }), '2:00 /500 m');
  assert.equal(C.paceText({ type: 'swim', durationSec: 1200, distanceKm: 1 }), '2:00 /100 m');
  assert.equal(C.paceText({ type: 'elliptical', durationSec: 1200, distanceKm: 3 }), '');
});

test('cardio validation catches impossible sessions', () => {
  assert.ok(C.validateCardio({ type: 'run', durationSec: 1500, distanceKm: 5 }).ok);
  assert.equal(C.validateCardio({ type: 'run', durationSec: 30 }).error, 'duration');
  assert.equal(C.validateCardio({ type: 'run', durationSec: 600, distanceKm: 10 }).error, 'speed');
  assert.equal(C.validateCardio({ type: 'yoga', durationSec: 600 }).error, 'type');
  assert.equal(C.validateCardio({ type: 'bike', durationSec: 3600, zone: 7 }).error, 'zone');
});

test('cardio records need earlier sessions of the same type', () => {
  const mk = (d, sec, km, type = 'run') => C.makeCardioSession({ type, startedAt: T - d * DAY, durationSec: sec, distanceKm: km });
  const old = [mk(10, 1800, 5), mk(5, 1500, 5), mk(3, 3600, 20, 'bike')];
  assert.deepEqual(C.cardioRecords(mk(0, 1440, 5), old), ['pace']);
  assert.deepEqual(C.cardioRecords(mk(0, 2400, 7), old).sort(), ['distance', 'duration']);
  assert.deepEqual(C.cardioRecords(mk(0, 600, 2, 'swim'), old), [], 'first swim is a baseline');
  const w = C.cardioMinutes([mk(1, 1800, 5), { ...mk(2, 1200, null, 'bike'), zone: 2 }, mk(20, 999, 1)], weekStart(T), weekStart(T) + 7 * DAY);
  assert.deepEqual(w, { minutes: 50, zone2: 20, km: 5, sessions: 2 });
});

// ---------- progression ----------
test('suggest: up when every set hit the target', () => {
  const bench = cat.get('bench-press');
  const h = [wo(T - 3 * DAY, 'bench-press', [[80, 8], [80, 8], [80, 8]])];
  assert.deepEqual(suggest(h, bench, 8), { kg: 82.5, reps: 8, reason: 'up', from: { kg: 80, reps: 8 } });
  assert.equal(suggest(h, cat.get('back-squat')), null);
});

test('suggest: repeat after a miss, deload after three misses', () => {
  const squat = cat.get('back-squat');
  const miss = d => wo(T - d * DAY, 'back-squat', [[100, 6], [100, 5], [100, 4]]);
  assert.equal(suggest([miss(3)], squat, 6).reason, 'repeat');
  assert.equal(suggest([miss(3)], squat, 6).kg, 100);
  const d = suggest([miss(3), miss(6), miss(9)], squat, 6);
  assert.equal(d.reason, 'deload');
  assert.equal(d.kg, 90);
  assert.equal(suggest([wo(T, 'back-squat', [[100, 6], [100, 6]])], squat, 6).kg, 105, 'squat steps by 5');
});

test('steps by equipment and bodyweight reps', () => {
  assert.equal(stepFor(cat.get('dumbbell-curl')), 2);
  assert.equal(stepFor(cat.get('deadlift')), 2.5, 'deadlift is a back-primary lift');
  assert.equal(stepFor(cat.get('leg-press')), 5);
  const s = suggest([wo(T, 'pull-up', [[0, 8], [0, 8]])], cat.get('pull-up'), 8);
  assert.deepEqual([s.kg, s.reps, s.reason], [0, 9, 'reps']);
});

test('easy day: lighter and one set fewer', () => {
  const t = easyDay({ name: 'x', exercises: [{ exerciseId: 'a', sets: [{ reps: 8, kg: 100 }, { reps: 8, kg: 100 }, { reps: 8, kg: 100 }] }, { exerciseId: 'b', sets: [{ reps: 10, kg: null }, { reps: 10, kg: null }] }] });
  assert.equal(t.easy, true);
  assert.deepEqual(t.exercises[0].sets.map(s => s.kg), [90, 90]);
  assert.equal(t.exercises[1].sets.length, 2, 'two sets stay two');
});

// ---------- body ----------
test('bodyweight: one entry per date, trend and protein', () => {
  let bw = [];
  bw = upsertBodyweight(bw, '2026-08-20', 84);
  bw = upsertBodyweight(bw, '2026-09-23', 82.6);
  bw = upsertBodyweight(bw, '2026-09-24', 82.2);
  bw = upsertBodyweight(bw, '2026-09-24', 82.4);
  assert.equal(bw.length, 3);
  const tr = bodyTrend(bw, '2026-09-24');
  assert.equal(tr.latest.kg, 82.4);
  assert.equal(tr.change30, -1.6);
  assert.equal(tr.loggedToday, true);
  assert.equal(proteinTarget(82.4), 150);
  assert.equal(proteinTarget(10), null);
  assert.ok(!validBodyweight(401));
  let p = addProtein([], '2026-09-24', 40);
  p = addProtein(p, '2026-09-24', 30);
  assert.equal(p[0].protein, 70);
  assert.equal(addProtein(p, '2026-09-24', -5), p);
  assert.match(dateKey(T), /^2026-09-24$/);
});

// ---------- streak and review ----------
test('week streak counts strength and 20+ min cardio', () => {
  const week = i => weekStart(T) - i * 7 * DAY + DAY;
  const h = [wo(week(1), 'a', [[1, 1]]), wo(week(1) + DAY, 'a', [[1, 1]]), wo(week(2), 'a', [[1, 1]])];
  const c = [C.makeCardioSession({ type: 'run', startedAt: week(1) + 2 * DAY, durationSec: 1800 }), C.makeCardioSession({ type: 'run', startedAt: week(2) + DAY, durationSec: 600 })];
  assert.deepEqual(weekStreak(h, c, 3, T), { streak: 1, thisWeek: 0, goal: 3 }, 'last week met, the one before only had a short run');
  const r = weekReview(h, c, T);
  assert.equal(r.workouts, 2);
  assert.equal(r.cardioMin, 30);
  assert.equal(weekReview([], [], T), null);
});

// ---------- routines ----------
test('routine editing', () => {
  let r = R.newRoutine('My day', T);
  r = R.addRoutineExercise(r, 'bench-press', 4, 8);
  r = R.addRoutineExercise(r, 'barbell-row');
  r = R.moveRoutineExercise(r, 1, 0);
  assert.deepEqual(r.exercises.map(e => e.exerciseId), ['barbell-row', 'bench-press']);
  r = R.setRoutineSets(r, 0, 5, 6);
  assert.equal(r.exercises[0].sets.length, 5);
  assert.ok(r.exercises[0].sets.every(s => s.reps === 6));
  r = R.removeRoutineExercise(r, 1);
  assert.equal(r.exercises.length, 1);
  assert.ok(R.validRoutine(r));
  assert.ok(!R.validRoutine(R.newRoutine('')));
  const d = R.duplicateRoutine(R.starterRoutines()[0], 'en', T);
  assert.equal(d.name, 'Push day (copy)');
  assert.equal(d.names, undefined);
  assert.equal(R.renameRoutine(R.starterRoutines()[0], ' Chest  day ').name, 'Chest day');
});

test('programs use real exercises; next routine is the least recent', () => {
  for (const p of R.PROGRAMS) for (const r of p.routines) for (const e of r.exercises) assert.ok(cat.get(e.exerciseId), e.exerciseId);
  const ppl = R.programRoutines('ppl', 'da', T);
  assert.deepEqual(ppl.map(r => r.name), ['Push-dag', 'Pull-dag', 'Ben-dag']);
  const hist = [{ routineId: ppl[0].id, startedAt: T - 2 * DAY }, { routineId: ppl[1].id, startedAt: T - DAY }];
  assert.equal(R.nextRoutine(ppl, hist).id, ppl[2].id);
  assert.equal(R.nextRoutine(ppl, [...hist, { routineId: ppl[2].id, startedAt: T }]).id, ppl[0].id);
});
