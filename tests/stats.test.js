import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thisWeek, weekStart, lastSessionSummary, latestPR, e1rmSeries, sparkline } from '../js/stats.js';
import { makeSet } from '../js/workout.js';
import { applyWorkout } from '../js/pr.js';

const at = (y, m, d, h = 18) => new Date(y, m - 1, d, h).getTime();
const wo = (id, t, sets = [[60, 5]], ex = 'bench-press') => ({ id, startedAt: t, finishedAt: t + 50 * 60_000, exercises: [{ exerciseId: ex, sets: sets.map(([kg, reps]) => makeSet({ kg, reps, done: true, completedAt: t })) }] });

test('week starts on Monday and counts workouts per day', () => {
  const wed = at(2026, 9, 23);
  assert.equal(new Date(weekStart(wed)).getDay(), 1);
  const h = [wo('a', at(2026, 9, 21)), wo('b', at(2026, 9, 23)), wo('c', at(2026, 9, 23, 7)), wo('old', at(2026, 9, 20))];
  const r = thisWeek(h, wed);
  assert.equal(r.count, 3);
  assert.deepEqual(r.days, [true, false, true, false, false, false, false]);
  assert.equal(r.today, 2);
  assert.equal(thisWeek([], wed).count, 0);
});

test('last session summary', () => {
  const r = lastSessionSummary([wo('a', at(2026, 9, 21), [[80, 8]]), wo('b', at(2026, 9, 22), [[100, 5], [100, 5]])]);
  assert.equal(r.workout.id, 'b');
  assert.equal(r.volume, 1000);
  assert.equal(r.minutes, 50);
  assert.equal(lastSessionSummary([]), null);
});

test('latest PR prefers heaviest and reports the gain', () => {
  let records = [];
  const hist = [];
  for (const w of [wo('a', at(2026, 9, 14), [[80, 5]]), wo('b', at(2026, 9, 17), [[82.5, 5]]), wo('c', at(2026, 9, 21), [[85, 5], [70, 12]])]) {
    const r = applyWorkout(records, w); records = r.records; w.prs = r.prs; hist.push(w);
  }
  const p = latestPR(hist);
  assert.equal(p.workout.id, 'c');
  assert.equal(p.pr.kind, 'weight');
  assert.equal(p.pr.kg, 85);
  assert.equal(p.deltaKg, 2.5);
  assert.equal(p.series.length, 3);
  assert.equal(latestPR([wo('x', 1, [[80, 5]])]), null, 'no PRs yet');
});

test('e1RM series and sparkline geometry', () => {
  const s = e1rmSeries([wo('b', 2, [[100, 1]]), wo('a', 1, [[90, 1]])], 'bench-press');
  assert.deepEqual(s.map(p => p.v), [90, 100]);
  const sp = sparkline(s, 116, 56, 9);
  assert.equal(sp.line, '0,47 116,9');
  assert.deepEqual(sp.last, { x: 116, y: 9 });
  assert.equal(sparkline([{ t: 1, v: 5 }]), null);
});
