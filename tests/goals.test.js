import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/goals.js';
import { makeSet } from '../js/workout.js';

const DAY = 86_400_000, WEEK = 7 * DAY;
const now = Date.parse('2026-09-24T12:00:00');
const session = (t, kg, reps) => ({ id: 'w' + t, startedAt: t, finishedAt: t + 3600_000, exercises: [{ exerciseId: 'bench-press', sets: [makeSet({ kg, reps, done: true })] }] });
// 8 weeks, +1.25 kg a week at 5 reps
const hist = Array.from({ length: 16 }, (_, i) => session(now - (56 - i * 3.5) * DAY, 80 + i * 0.625, 5));

test('trend and current estimated max', () => {
  const s = G.e1rmSessions(hist, 'bench-press');
  assert.equal(s.length, 16);
  const tr = G.trendPerWeek(s, now);
  assert.ok(Math.abs(tr - 1.46) < 0.1, `≈ +1.25 kg × 7/6 e1RM per week, got ${tr}`);
  assert.equal(G.trendPerWeek(s.slice(-2), now), null);
});

test('a reachable goal is on track or ahead; a far one is behind; this week has an aim', () => {
  const g = G.makeGoal({ exerciseId: 'bench-press', kg: 115, reps: 1, deadline: now + 12 * WEEK }, hist, now);
  const st = G.goalStatus(g, hist, now);
  assert.ok(['ahead', 'on-track'].includes(st.state), st.state);
  assert.equal(st.aim.reps, 5);
  assert.ok(st.aim.kg >= 85 && st.aim.kg <= 95, `aim ${st.aim.kg}`);
  const far = G.makeGoal({ exerciseId: 'bench-press', kg: 150, reps: 1, deadline: now + 8 * WEEK }, hist, now);
  assert.equal(G.goalStatus(far, hist, now).state, 'behind');
  const done = G.makeGoal({ exerciseId: 'bench-press', kg: 80, reps: 5, deadline: now + 4 * WEEK }, hist, now);
  assert.equal(G.goalStatus(done, hist, now).state, 'done');
  const fresh = G.makeGoal({ exerciseId: 'squat', kg: 140, reps: 1, deadline: now + 8 * WEEK }, hist, now);
  assert.equal(G.goalStatus(fresh, hist, now).state, 'new');
  assert.equal(G.goalStatus({ ...g, deadline: now - DAY }, hist, now).state, 'missed');
});

test('goal dates from speech', () => {
  const d = t => new Date(t);
  assert.equal(d(G.parseGoalDate('december', now)).getMonth(), 11);
  assert.equal(d(G.parseGoalDate('december', now)).getDate(), 31);
  assert.equal(d(G.parseGoalDate('jul', now)).getDate(), 24);
  assert.equal(G.parseGoalDate('in 12 weeks', now), now + 12 * WEEK);
  assert.equal(d(G.parseGoalDate('om 3 måneder', now)).getMonth(), 11);
  assert.equal(d(G.parseGoalDate('march', now)).getFullYear(), 2027);
  assert.equal(d(G.parseGoalDate('20 december', now)).getDate(), 20);
  assert.equal(G.parseGoalDate('someday', now), null);
});

test('goals are sanitized', () => {
  const ok = G.makeGoal({ exerciseId: 'bench-press', kg: 100, reps: 1, deadline: now + WEEK }, hist, now, 'g1');
  assert.deepEqual(G.sanitizeGoals([ok, { id: 'x' }, null]).map(g => g.id), ['g1']);
});

test('goals by voice', async () => {
  const { parse } = await import('../js/parser.js');
  const { createCatalog } = await import('../js/catalog.js');
  const ctx = { lang: 'auto', unit: 'kg', catalog: createCatalog(), usage: {}, routines: [], workoutExerciseIds: [], current: null, restRunning: false, now };
  const a = parse('goal 85 kg bench press for 5 by december', ctx);
  assert.deepEqual([a.type, a.exerciseId, a.kg, a.reps], ['SetGoal', 'bench-press', 85, 5]);
  assert.equal(parse('i want to squat 140 by christmas', ctx).exerciseId, 'back-squat');
  assert.equal(parse('mål 100 kilo bænkpres til jul', ctx).kg, 100);
  assert.equal(parse('80 kilo 8 reps', ctx).type, 'LogSet');
});
