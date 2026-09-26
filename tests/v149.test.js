import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewLift, reviewSession, weekBehind, nextTargets } from '../js/review.js';
import { createWorkout, targetFromSets } from '../js/workout.js';
import { loadable, suggest, configureSteps } from '../js/progression.js';
import { weightTrend } from '../js/body.js';
import { hardDays } from '../js/planedit.js';
import { usualMeals } from '../js/meals.js';
import { repeatMeal, parse } from '../js/parser.js';
import { sanitizePin } from '../js/settings.js';
import { createCatalog } from '../js/catalog.js';

const catalog = createCatalog();
const done = (kg, reps) => ({ id: Math.random().toString(36), type: 'normal', kg, reps, done: true, completedAt: 1 });
const open = (kg, reps) => ({ id: Math.random().toString(36), type: 'normal', kg, reps, done: false });

test('the plan is kept on each exercise when a workout starts', () => {
  const w = createWorkout({ exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 80, reps: 8 }, { kg: 80, reps: 8 }, { kg: 80, reps: 8 }] }] });
  assert.deepEqual(w.exercises[0].target, { kg: 80, reps: 8, sets: 3 });
  assert.equal(targetFromSets([{ kg: null, reps: null }]), null);
});

test('a lift hits, misses or is skipped', () => {
  const target = { kg: 80, reps: 8, sets: 3 };
  assert.equal(reviewLift({ sets: [done(80, 8), done(80, 8), done(80, 9)] }, target).status, 'hit');
  assert.equal(reviewLift({ sets: [done(80, 8), done(80, 7), done(80, 6)] }, target).status, 'missed');
  assert.equal(reviewLift({ sets: [done(80, 8), done(80, 8), open(80, 8)] }, target).status, 'missed');
  assert.equal(reviewLift({ sets: [done(75, 8), done(75, 8), done(75, 8)] }, target).status, 'missed');
  assert.equal(reviewLift({ sets: [open(80, 8)] }, target).status, 'skipped');
  assert.equal(reviewLift({ sets: [done(80, 8)] }, null).status, 'logged');
});

test('missing most of the plan is a concern worth pinning', () => {
  const t = { kg: 80, reps: 8, sets: 2 };
  const w = { id: 'w1', startedAt: 1000, finishedAt: 2000, exercises: [
    { exerciseId: 'bench-press', target: t, sets: [done(80, 8), done(80, 6)] },
    { exerciseId: 'back-squat', target: { kg: 100, reps: 5, sets: 2 }, sets: [done(100, 4), done(100, 3)] },
    { exerciseId: 'barbell-row', target: { kg: 60, reps: 10, sets: 2 }, sets: [done(60, 10), done(60, 10)] }] };
  const r = reviewSession(w, [w], catalog);
  assert.equal(r.missed, 2);
  assert.equal(r.hit, 1);
  assert.equal(r.concern, 'missed');
  const next = r.lifts.find(l => l.exerciseId === 'barbell-row').next;
  assert.equal(next.reason, 'up');
});

test('the week falls behind only when the days left cannot hold it', () => {
  const thu = new Date(2026, 8, 24, 10).getTime(); // a Thursday: Thu–Sun left
  const mon = new Date(2026, 8, 21, 10).getTime();
  assert.equal(weekBehind([], 3, thu), null); // 3 needed, 4 days
  assert.ok(weekBehind([], 4, thu)); // every day left
  assert.equal(weekBehind([], 5, thu).lost, true);
  assert.equal(weekBehind([{ startedAt: mon }, { startedAt: mon + 86_400_000 }], 3, thu), null);
  assert.ok(weekBehind([], 3, thu, 1)); // one of those days is wrestling
});

test('plate-aware: only weights you can load', () => {
  configureSteps(null);
  const bb = catalog.get('bench-press'), db = catalog.get('dumbbell-bench-press');
  assert.equal(loadable(81, bb), 80);
  assert.equal(loadable(81, bb, 1), 82.5);
  assert.equal(loadable(15, bb), 20); // never under the empty bar
  assert.equal(loadable(23, db), 24);
  const hist = [{ startedAt: 1, exercises: [{ exerciseId: 'bench-press', sets: [done(81, 8), done(81, 8)] }] }];
  assert.equal(suggest(hist, bb, 8).kg, 85); // 81 + 2.5 → the next loadable weight
  configureSteps({ barbell: 1 });
  assert.equal(loadable(81.4, bb), 81);
  configureSteps(null);
});

test('next targets for a routine', () => {
  const hist = [{ startedAt: 1, exercises: [{ exerciseId: 'bench-press', sets: [done(80, 8), done(80, 8)] }] }];
  const nt = nextTargets({ exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8 }] }, { exerciseId: 'back-squat', sets: [{ reps: 5 }] }] }, hist, catalog);
  assert.deepEqual(nt, [{ exerciseId: 'bench-press', kg: 82.5, reps: 8, reason: 'up' }]);
});

test('weight trend smooths the swings and gives a weekly rate', () => {
  const list = Array.from({ length: 21 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, kg: 85 - i * 0.1 + (i % 2 ? 0.6 : -0.6) }));
  const tr = weightTrend(list);
  assert.ok(tr.perWeek < 0 && tr.perWeek > -1.2, String(tr.perWeek));
  assert.ok(tr.pctPerWeek < 0);
  assert.equal(weightTrend(list.slice(0, 3)), null);
});

test('hard days: legs next to wrestling', () => {
  const legs = { id: 'l', name: 'Legs', exercises: [{ exerciseId: 'back-squat', sets: [] }, { exerciseId: 'romanian-deadlift', sets: [] }] };
  const now = new Date(2026, 8, 21, 10).getTime(); // Monday
  const out = hardDays([legs], { '2026-09-22': { routineId: 'l' }, '2026-09-23': { label: 'Wrestling' } }, catalog, now);
  assert.equal(out.length, 1);
  assert.match(out[0], /day before Wrestling/);
});

test('usual meals: the same foods together on two days', () => {
  const at = (d, h) => new Date(2026, 8, d, h).getTime();
  const day = (d, names) => ({ date: `2026-09-${d}`, meals: names.map(n => ({ name: n, kcal: 100, protein: 10, t: at(d, 8) })) });
  const u = usualMeals([day(20, ['Skyr', 'Oats']), day(21, ['Oats', 'Skyr']), day(22, ['Toast'])], at(23, 9));
  assert.equal(u.length, 1);
  assert.equal(u[0].slot, 'breakfast');
  assert.equal(u[0].kcal, 200);
});

test('"same as yesterday\'s lunch"', () => {
  assert.deepEqual(repeatMeal("same as yesterday's lunch").slot, 'lunch');
  assert.equal(repeatMeal('samme morgenmad som i går').slot, 'breakfast');
  assert.equal(parse('same again').type, 'RepeatLast');
});

test('pins are sanitized', () => {
  assert.equal(sanitizePin({ id: 'x', kind: 'nope', title: 'a' }), null);
  assert.deepEqual(sanitizePin({ id: 'x', kind: 'behind', title: 'a', at: 5 }), { id: 'x', kind: 'behind', title: 'a', sub: '', ask: '', at: 5 });
});
