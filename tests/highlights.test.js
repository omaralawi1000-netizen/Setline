import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionHighlights, previousOf, topSet } from '../js/highlights.js';

const D = 86_400_000, T = Date.UTC(2026, 8, 24, 12);
const set = (kg, reps, done = true) => ({ id: Math.random().toString(36), kg, reps, done });
const wk = (id, t, exs, extra = {}) => ({ id, name: 'Push', routineId: 'r1', startedAt: t, finishedAt: t + 3600e3, exercises: exs.map(([exerciseId, sets]) => ({ id: exerciseId + id, exerciseId, sets })), ...extra });

test('a session against the last time', () => {
  const old = wk('a', T - 7 * D, [['bench-press', [set(80, 8), set(80, 7)]], ['dip', [set(0, 10)]]]);
  const now = wk('b', T, [['bench-press', [set(82.5, 8), set(82.5, 8)]], ['lateral-raise', [set(10, 15)]]]);
  const h = sessionHighlights(now, [old, now], { weeklyGoal: 4 });
  assert.equal(h.lifts[0].trend, 'up');
  assert.ok(h.lifts[0].delta > 2);
  assert.equal(h.lifts[1].trend, 'new');
  assert.equal(h.up, 1);
  assert.ok(h.vsLast.pct > 0);
  assert.equal(h.week.goal, 4);
  assert.equal(topSet({ sets: [set(100, 1), set(90, 5), set(95, 3, false)] }).kg, 90);
  assert.equal(previousOf(now, [old, now]).id, 'a');
  assert.equal(sessionHighlights(old, [old]).vsLast, null, 'nothing before the first one');
});
