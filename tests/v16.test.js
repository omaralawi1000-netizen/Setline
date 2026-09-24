import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/workout.js';
import * as N from '../js/insights.js';
import * as G from '../js/gps.js';
import { sanitize } from '../js/settings.js';
import { createCatalog } from '../js/catalog.js';
import { parse } from '../js/parser.js';
import { resolve } from '../js/commands.js';
import { translator } from '../js/i18n.js';
import { starterRoutines } from '../js/routines.js';
import { weekStart } from '../js/stats.js';

const cat = createCatalog();
const DAY = 86_400_000;
const T = new Date(2026, 8, 24, 18).getTime(); // Thursday
const done = (kg, reps) => W.makeSet({ kg, reps, done: true, completedAt: 1 });
const wo = (t, exs, min = 50, extra = {}) => ({
  id: 'w' + t + Math.random(), startedAt: t, finishedAt: t + min * 60000, ...extra,
  exercises: exs.map(([exerciseId, n, kg = 60, reps = 8]) => ({ id: exerciseId + t, exerciseId, sets: Array.from({ length: n }, () => done(kg, reps)) }))
});

// ---------- per-exercise rest ----------
test('rest: adjusting teaches the exercise, the next set uses it', () => {
  let w = W.createWorkout({ exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] }] }, T);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T, 90).workout;
  assert.equal(w.rest.duration, 90);
  w = W.adjustRest(w, 60, T + 1000);
  assert.equal(w.exercises[0].restSec, 150);
  w = W.logSet(w, 0, { kg: 80, reps: 8 }, T + 200_000, 90).workout;
  assert.equal(w.rest.duration, 150, 'learned rest wins over the default');
  assert.deepEqual(W.learnedRest(w), { 'bench-press': 150 });
  const f = W.finishWorkout(w, T + 400_000);
  assert.equal(f.exercises[0].restSec, 150, 'kept on the finished workout');
});

test('rest: restFor falls back from workout to saved to default', () => {
  assert.equal(W.restFor({ exerciseId: 'a', restSec: 120 }, { a: 180 }, 90), 120);
  assert.equal(W.restFor({ exerciseId: 'a' }, { a: 180 }, 90), 180);
  assert.equal(W.restFor({ exerciseId: 'b' }, { a: 180 }, 90), 90);
  assert.equal(W.restFor(null, {}, 75), 75);
});

test('settings: restByEx, deload and auto-advance are sanitized', () => {
  const s = sanitize({ restByEx: { 'bench-press': 143, squat: 9999, bad: 'x' }, autoAdvance: false, deloadUntil: 5, deloadSnoozed: -1 });
  assert.deepEqual(s.restByEx, { 'bench-press': 150, squat: 300 });
  assert.equal(s.autoAdvance, false);
  assert.equal(s.deloadUntil, 5);
  assert.equal(s.deloadSnoozed, 0);
  assert.equal(sanitize({}).autoAdvance, true);
});

// ---------- auto-advance ----------
test('auto-advance: the last planned set moves on to the next untouched exercise', () => {
  let w = W.createWorkout({ exercises: [
    { exerciseId: 'bench-press', sets: [{ reps: 8 }, { reps: 8 }] },
    { exerciseId: 'overhead-press', sets: [{ reps: 8 }] }
  ] }, T);
  let b = w; w = W.logSet(w, 0, { kg: 80, reps: 8 }, T).workout;
  assert.equal(W.advanceAfterLog(b, w, 0).current, 0, 'a planned set is left');
  b = w; w = W.advanceAfterLog(b, W.logSet(w, 0, { kg: 80, reps: 8 }, T).workout, 0);
  assert.equal(w.current, 1);
  assert.equal(w.advancedFrom, 0);
  // an extra set beyond the plan doesn't jump anywhere
  const extra = W.logSet(w, 0, { kg: 80, reps: 6 }, T).workout;
  assert.equal(W.advanceAfterLog(w, extra, 0).current, 0);
  assert.equal(extra.advancedFrom, undefined);
  // nothing untouched left: stay
  const solo = W.createWorkout({ exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8 }] }] }, T);
  assert.equal(W.advanceAfterLog(solo, W.logSet(solo, 0, { kg: 80, reps: 8 }, T).workout, 0).current, 0);
});

test('auto-advance by voice: "same again" right after still means the finished exercise', () => {
  const settings = { unit: 'kg', restSec: 90, spoken: 'minimal', autoAdvance: true, restByEx: {} };
  let w = W.createWorkout({ exercises: [
    { exerciseId: 'bench-press', sets: [{ reps: 8 }] },
    { exerciseId: 'overhead-press', sets: [{ reps: 8 }] }
  ] }, T);
  const say = text => {
    const ex = w.exercises[w.current];
    const li = W.lastDoneIndex(ex), pi = W.firstPlannedIndex(ex);
    const ctx = { lang: 'en', unit: 'kg', catalog: cat, usage: {}, routines: starterRoutines(), workoutExerciseIds: w.exercises.map(e => e.exerciseId),
      current: { exerciseId: ex.exerciseId, lastSet: li >= 0 ? ex.sets[li] : null, planned: pi >= 0 ? ex.sets[pi] : null }, restRunning: false };
    const intent = parse(text, ctx);
    const cmd = resolve(intent, { active: w, history: [], prs: [], routines: starterRoutines(), undoCount: 0, settings, catalog: cat, now: T }, translator('en'), 'en');
    if (cmd.run?.op === 'update') w = cmd.run.fn(w, T);
    return cmd;
  };
  say('80 kg 8 reps');
  assert.equal(w.current, 1, 'moved on to overhead press');
  say('same again');
  assert.equal(w.exercises[0].sets.filter(s => s.done).length, 2, 'extra set on bench');
  assert.equal(w.current, 0);
});

// ---------- session length ----------
test('usual length: same routine first, then recent, then estimate', () => {
  const h = [wo(T - 2 * DAY, [['bench-press', 3]], 50, { routineId: 'push' }), wo(T - 5 * DAY, [['bench-press', 3]], 60, { routineId: 'push' }), wo(T - 8 * DAY, [['back-squat', 3]], 90, { routineId: 'legs' })];
  assert.deepEqual(N.usualMinutes(h, 'push'), { min: 55, from: 'routine' });
  assert.deepEqual(N.usualMinutes(h, 'legs'), { min: 60, from: 'recent' });
  assert.equal(N.usualMinutes([], 'x', { exercises: [{ sets: [1, 2, 3, 4] }, { sets: [1, 2, 3, 4] }] }).from, 'estimate');
  assert.equal(N.usualMinutes([], null, null), null);
});

test('time status speaks up only past +5 min', () => {
  const u = { min: 55 };
  assert.equal(N.timeStatus(30 * 60, u).state, 'ok');
  assert.equal(N.timeStatus(52 * 60, u).state, 'near');
  assert.deepEqual(N.timeStatus(65 * 60, u), { state: 'over', over: 10, usual: 55 });
  assert.equal(N.timeStatus(100, null), null);
});

// ---------- muscle balance ----------
test('sets per group: primary full, secondary half, once per group', () => {
  const from = weekStart(T);
  const g = N.setsPerGroup([wo(from + DAY, [['bench-press', 4], ['back-squat', 3]])], cat, from, from + 7 * DAY);
  const bench = cat.get('bench-press').muscles, squat = cat.get('back-squat').muscles;
  assert.equal(bench[0], 'chest');
  assert.equal(g.chest, 4);
  assert.ok(g.arms >= 2 || !bench.includes('triceps'), 'triceps count half');
  assert.equal(squat[0], 'quads');
  assert.equal(g.legs, 3, 'quads + glutes in one group count once');
});

test('balance flags the group most behind, only mid-week with training done', () => {
  const from = weekStart(T);
  const h = [wo(from, [['bench-press', 5], ['overhead-press', 4]]), wo(from + 2 * DAY, [['bench-press', 5], ['lateral-raise', 4]])];
  const b = N.muscleBalance(h, cat, T);
  assert.ok(b.behind, 'something is behind');
  assert.ok(['legs', 'back'].includes(b.behind.group));
  assert.equal(N.muscleBalance(h, cat, from + DAY).behind, null, 'too early in the week');
});

// ---------- deload ----------
const steadyWeeks = (n, now = T) => {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const wk = weekStart(now) - i * 7 * DAY;
    out.push(wo(wk + DAY, [['bench-press', 4]]), wo(wk + 3 * DAY, [['back-squat', 4]]));
  }
  return out;
};

test('deload is offered after 6 steady weeks, not before', () => {
  assert.equal(N.trainingBlock(steadyWeeks(5), T), 5);
  assert.equal(N.deloadStatus(steadyWeeks(5), {}, T), null);
  assert.deepEqual(N.deloadStatus(steadyWeeks(7), {}, T), { state: 'due', weeks: 7 });
  assert.equal(N.deloadStatus(steadyWeeks(7), { deloadSnoozed: T + DAY }, T), null, 'snoozed');
  assert.equal(N.deloadStatus([], { deloadUntil: T + DAY }, T).state, 'active');
});

test('a week off or a deload week resets the block', () => {
  const h = steadyWeeks(8).filter(w => !(w.startedAt > weekStart(T) - 4 * 7 * DAY && w.startedAt < weekStart(T) - 3 * 7 * DAY));
  assert.equal(N.trainingBlock(h, T), 3);
  const d = steadyWeeks(8).map(w => (w.startedAt < weekStart(T) - 2 * 7 * DAY && w.startedAt > weekStart(T) - 3 * 7 * DAY ? { ...w, deload: true } : w));
  assert.equal(N.trainingBlock(d, T), 2);
});

test('deload day: half the sets, ~15% lighter', () => {
  const d = N.deloadDay({ exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 100, reps: 5 }, { kg: 100, reps: 5 }, { kg: 100, reps: 5 }] }, { exerciseId: 'x', sets: [{ kg: null, reps: 10 }] }] });
  assert.equal(d.deload, true);
  assert.equal(d.exercises[0].sets.length, 2);
  assert.equal(d.exercises[0].sets[0].kg, 85);
  assert.equal(d.exercises[1].sets.length, 1);
  assert.equal(d.exercises[1].sets[0].kg, null);
});

// ---------- repeat ----------
test('repeat a workout: same exercises and sets, no warm-ups', () => {
  const w = wo(T, [['bench-press', 3, 80, 8]], 50, { routineId: 'push', name: 'Push' });
  w.exercises[0].sets.unshift(W.makeSet({ kg: 40, reps: 5, type: 'warmup', done: true }));
  w.exercises[0].restSec = 150;
  const t = N.repeatTemplate(w);
  assert.equal(t.routineId, 'push');
  assert.deepEqual(t.exercises[0].sets, [{ kg: 80, reps: 8 }, { kg: 80, reps: 8 }, { kg: 80, reps: 8 }]);
  const again = W.createWorkout(t, T + DAY);
  assert.equal(again.exercises[0].restSec, 150, 'rest comes along');
  assert.equal(W.suggestNext(again.exercises[0], null).kg, 80);
});

// ---------- GPS ----------
const step = (lat, m) => lat + m / 111_195; // metres north → degrees

test('gps: haversine is right for a known distance', () => {
  const d = G.haversine({ lat: 55.6761, lon: 12.5683 }, { lat: 55.6761 + 0.01, lon: 12.5683 });
  assert.ok(Math.abs(d - 1112) < 3, `≈1.11 km, got ${d}`);
});

test('gps: sums a steady run, drops noise, bad fixes and jumps', () => {
  let tr = G.newTrack(), lat = 55.6761, t = 0;
  for (let i = 0; i < 100; i++) { lat = step(lat, 15); t += 5000; tr = G.addFix(tr, { lat, lon: 12.5, acc: 8, t }, 'run'); }
  assert.ok(Math.abs(tr.m - 1485) < 5, `~1.5 km, got ${tr.m}`); // first fix only anchors
  const before = tr.m;
  tr = G.addFix(tr, { lat: step(lat, 3), lon: 12.5, acc: 8, t: t + 5000 }, 'run');
  assert.equal(tr.m, before, 'jitter under the accuracy is ignored');
  tr = G.addFix(tr, { lat: step(lat, 40), lon: 12.5, acc: 80, t: t + 10000 }, 'run');
  assert.equal(tr.m, before, 'inaccurate fix dropped');
  tr = G.addFix(tr, { lat: step(lat, 500), lon: 12.5, acc: 8, t: t + 15000 }, 'run');
  assert.equal(tr.m, before, '500 m in 15 s is a jump');
  tr = G.addFix(tr, { lat: step(lat, 500), lon: 12.5, acc: 8, t: t + 15000 }, 'bike');
  assert.equal(tr.m, before, 'even on a bike (33 m/s)');
});

test('gps: a pause starts a new segment', () => {
  let tr = G.addFix(G.newTrack(), { lat: 55, lon: 12, acc: 5, t: 0 });
  tr = G.addFix(tr, { lat: step(55, 20), lon: 12, acc: 5, t: 5000 });
  tr = G.breakTrack(tr);
  tr = G.addFix(tr, { lat: step(55, 900), lon: 12, acc: 5, t: 600_000 });
  assert.ok(Math.abs(tr.m - 20) < 1, 'the walk home while paused is not counted');
  assert.equal(G.trackKm({ m: 2414.4 }), 2.414);
});

test('press depth: small buttons squish more than cards', async () => {
  const { depthFor } = await import('../js/ui/press.js');
  assert.ok(depthFor(40, 40) < depthFor(100, 50));
  assert.ok(depthFor(100, 50) < depthFor(360, 120));
  assert.ok(depthFor(360, 120) >= 0.98);
});
