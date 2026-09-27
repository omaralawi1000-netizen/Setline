import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTranscript, buildPrompt, isEcho, dedupeSentences } from '../js/stt.js';
import { makeReport, reportTitle, reportBody, issueUrl, reportIntent, pushError, sanitizeReports } from '../js/reports.js';
import { monthRecap, recapMonth } from '../js/recap.js';
import { lighterToday } from '../js/review.js';
import { createWorkout, addWarmups, completeWarmup, WARMUP_REST } from '../js/workout.js';
import { topUpExercise } from '../js/insights.js';
import { createCatalog } from '../js/catalog.js';
import { parse } from '../js/parser.js';

const catalog = createCatalog();

test('silence that comes back as the prompt is dropped, real sets are kept', () => {
  const P = buildPrompt({ current: 'bench-press', catalog });
  assert.equal(cleanTranscript({ text: 'Bænkpres 37,5 kilo 11 gentagelser. Bænkpres 37,5 kilo 11 gentagelser.' }, P).text, '');
  assert.equal(cleanTranscript({ text: 'Bænkpres, Bench press.' }, P).text, '');
  assert.equal(cleanTranscript({ text: 'Samme igen. Læg 2,5 til. Skip rest.' }, P).text, '');
  assert.equal(cleanTranscript({ text: 'Bænkpres 82,5 kilo 8 gentagelser.' }, P).text, 'Bænkpres 82,5 kilo 8 gentagelser.');
  assert.equal(cleanTranscript({ text: 'samme igen' }, P).text, 'samme igen');
  assert.equal(isEcho('bench 80 for 8', P), false);
  assert.equal(dedupeSentences('Bench 80 for 8. Bench 80 for 8.'), 'Bench 80 for 8.');
});

test('reports: title, body with context, a GitHub link that fits', () => {
  const r = makeReport({ kind: 'bug', text: 'I said nothing and it logged bench\nmore detail', context: { version: '1.50.0', screen: 'workout', heard: ['Bænkpres 37,5'], errors: [{ at: 0, msg: 'x is undefined', where: 'app.js:1' }] } }, 1000);
  assert.equal(reportTitle(r), '[Bug] I said nothing and it logged bench');
  assert.match(reportBody(r), /1\.50\.0 · screen: workout/);
  assert.match(reportBody(r), /x is undefined/);
  const u = issueUrl({ ...r, text: 'x'.repeat(2000) });
  assert.ok(u.startsWith('https://github.com/omaralawi1000-netizen/Setline/issues/new?title='));
  assert.ok(u.length <= 7000);
  assert.equal(sanitizeReports([{ id: 'a', text: '' }, r]).length, 1);
});

test('reports: said or typed anywhere', () => {
  assert.deepEqual(reportIntent('bug: the timer froze'), { type: 'Report', kind: 'bug', text: 'the timer froze' });
  assert.equal(reportIntent('idea: a darker theme').kind, 'idea');
  assert.equal(reportIntent('I have a bug bite'), null);
  assert.equal(parse('report a bug: the orb is stuck').type, 'Report');
});

test('the same error in a loop is kept once', () => {
  let l = pushError([], { msg: 'boom' }, 1000);
  l = pushError(l, { msg: 'boom' }, 2000);
  l = pushError(l, { msg: 'other' }, 3000);
  assert.equal(l.length, 2);
});

test('a warm-up starts a short timer that knows what comes next', () => {
  let w = createWorkout({ exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 100, reps: 5 }] }] }, 0);
  w = addWarmups(w, 0, [{ kg: 40, reps: 8 }, { kg: 60, reps: 5 }]);
  const [a, b] = w.exercises[0].sets;
  let c = completeWarmup(w, 0, a.id, 1000);
  assert.equal(c.rest.endsAt, 1000 + WARMUP_REST.between * 1000);
  assert.deepEqual(c.rest.cue, { kg: 60, reps: 5, warm: true });
  c = completeWarmup(c, 0, b.id, 5000);
  assert.equal(c.rest.endsAt, 5000 + WARMUP_REST.last * 1000);
  assert.deepEqual(c.rest.cue, { kg: 100, reps: 5, warm: false });
});

test('a lighter day is offered after a short night, low energy or a sport day', () => {
  assert.equal(lighterToday({ checkin: { sleepH: 5 } }).why, 'sleep');
  assert.equal(lighterToday({ checkin: { energy: 2 } }).why, 'energy');
  assert.equal(lighterToday({ yesterday: { label: 'Wrestling' } }).what, 'Wrestling');
  assert.equal(lighterToday({ checkin: { sleepH: 8, energy: 4 } }), null);
});

test('topping up a group uses the lift you do most for it', () => {
  assert.equal(topUpExercise('chest', { 'dumbbell-bench-press': 5, 'bench-press': 2, 'back-squat': 9 }, catalog), 'dumbbell-bench-press');
  assert.equal(topUpExercise('legs', {}, catalog), 'back-squat');
});

test('the month in numbers', () => {
  const now = new Date(2026, 8, 20).getTime();
  const range = recapMonth(now);
  assert.equal(range.whole, false);
  assert.equal(recapMonth(new Date(2026, 9, 3).getTime()).whole, true);
  const set = (kg, reps) => ({ type: 'normal', kg, reps, done: true });
  const hist = [
    { startedAt: new Date(2026, 7, 20).getTime(), exercises: [{ exerciseId: 'bench-press', sets: [set(80, 5)] }] },
    { startedAt: new Date(2026, 8, 5).getTime(), exercises: [{ exerciseId: 'bench-press', sets: [set(85, 5)] }] },
    { startedAt: new Date(2026, 8, 12).getTime(), exercises: [{ exerciseId: 'bench-press', sets: [set(87.5, 5)] }] }
  ];
  const r = monthRecap({ history: hist, bodyweight: [{ date: '2026-09-02', kg: 90 }, { date: '2026-09-18', kg: 89 }] }, range);
  assert.equal(r.sessions, 2);
  assert.equal(r.moves[0].id, 'bench-press');
  assert.ok(r.moves[0].change > 0);
  assert.deepEqual(r.bodyweight, { from: 90, to: 89 });
  assert.equal(monthRecap({ history: [] }, range), null);
});
