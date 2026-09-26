import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitChanges, hideChangeTail, applyChanges, dayOf, weekText, sanitizeDayPlan, dayKey } from '../js/planedit.js';
import { nextRoutine } from '../js/routines.js';
import { createCatalog } from '../js/catalog.js';
import { translator } from '../js/i18n.js';

const catalog = createCatalog();
const t = translator('en');
const friday = new Date(2026, 8, 25, 10).getTime(); // a Friday (rest in this plan)
const rs = () => [
  { id: 'mon', name: 'Monday: Legs + Shoulders', createdAt: 1, exercises: [{ exerciseId: 'hack-squat', sets: [{ reps: 8, kg: 120 }, { reps: 8, kg: 120 }] }, { exerciseId: 'leg-extension', sets: [{ reps: 12, kg: 60 }] }] },
  { id: 'sat', name: 'Saturday: Chest + Biceps', createdAt: 2, exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8, kg: 80 }] }] }
];

test('the Coach\'s change lines are hidden and read', () => {
  const { text, changes } = splitChanges('Got it, wrestling today.\nCHANGE: {"day":"2026-09-25","label":"Wrestling"}\nREMEMBER: wrestles on Fridays');
  assert.equal(text, 'Got it, wrestling today.\nREMEMBER: wrestles on Fridays');
  assert.deepEqual(changes, [{ day: '2026-09-25', label: 'Wrestling' }]);
  assert.equal(hideChangeTail('Sure.\nCHANGE: {"da'), 'Sure.');
  assert.equal(splitChanges('CHANGE: {not json}').changes.length, 0);
});

test('"I have wrestling today" on a rest day: the day says Wrestling', () => {
  const r = applyChanges({ routines: rs(), dayPlan: {} }, [{ day: dayKey(friday), label: 'Wrestling' }], { catalog, now: friday, t });
  assert.deepEqual(r.dayPlan, { [dayKey(friday)]: { label: 'Wrestling' } });
  assert.deepEqual(r.done, ['Today: Wrestling']);
  const d = dayOf(dayKey(friday), r.routines, r.dayPlan);
  assert.equal(d.label, 'Wrestling');
  assert.ok(d.changed);
});

test('wrestling on a lifting day: that day is skipped by Up next', () => {
  const sat = dayKey(friday + 86_400_000);
  assert.equal(nextRoutine(rs(), [], friday, {}).id, 'sat');
  const r = applyChanges({ routines: rs(), dayPlan: {} }, [{ day: 'saturday', label: 'Wrestling' }], { catalog, now: friday, t });
  assert.equal(r.dayPlan[sat].label, 'Wrestling');
  assert.equal(nextRoutine(r.routines, [], friday, r.dayPlan).id, 'mon');
});

test('a routine on another day, moving it for good, and back to the plan', () => {
  const tue = dayKey(friday + 4 * 86_400_000);
  let r = applyChanges({ routines: rs(), dayPlan: {} }, [{ day: tue, routine: 'Chest + Biceps' }], { catalog, now: friday, t });
  assert.equal(dayOf(tue, r.routines, r.dayPlan).routine.id, 'sat');
  r = applyChanges(r, [{ day: tue, clear: true }], { catalog, now: friday, t });
  assert.equal(dayOf(tue, r.routines, r.dayPlan).rest, true);
  r = applyChanges(r, [{ routine: 'Legs + Shoulders', weekday: 'Thursday' }], { catalog, now: friday, t });
  const legs = r.routines.find(x => x.id === 'mon');
  assert.equal(legs.weekday, 4);
  assert.equal(legs.name, 'Legs + Shoulders');
  assert.deepEqual(r.done, ['Legs + Shoulders moved to Thursday']);
});

test('exercises: change sets, add, remove, swap', () => {
  let r = applyChanges({ routines: rs(), dayPlan: {} }, [
    { routine: 'monday', exercise: 'hack squat', sets: 4, reps: 6 },
    { routine: 'Legs + Shoulders', exercise: 'lateral raise', sets: 3, reps: 15, kg: 10 },
    { routine: 'Legs + Shoulders', remove: 'leg extension' },
    { routine: 'Chest + Biceps', swap: 'bench press', for: 'incline dumbbell press' }
  ], { catalog, now: friday, t });
  const legs = r.routines.find(x => x.id === 'mon'), chest = r.routines.find(x => x.id === 'sat');
  assert.deepEqual(legs.exercises.map(e => [e.exerciseId, e.sets.length, e.sets[0].reps]), [['hack-squat', 4, 6], ['lateral-raise', 3, 15]]);
  assert.equal(legs.exercises[0].sets[0].kg, 120, 'weights kept');
  assert.equal(chest.exercises[0].exerciseId, 'incline-dumbbell-press');
  assert.equal(r.done.length, 4);
  assert.equal(r.failed.length, 0);
});

test('unknown routines are reported, not guessed', () => {
  const r = applyChanges({ routines: rs(), dayPlan: {} }, [{ routine: 'Pull day', exercise: 'row', sets: 3 }], { catalog, now: friday, t });
  assert.equal(r.done.length, 0);
  assert.equal(r.failed.length, 1);
});

test('the Coach sees the week with dates', () => {
  const w = weekText(rs(), { [dayKey(friday)]: { label: 'Wrestling' } }, friday);
  assert.match(w, /2026-09-25 Friday \(today\): Wrestling \(changed for that day\)/);
  assert.match(w, /2026-09-26 Saturday \(tomorrow\): Saturday: Chest \+ Biceps/);
});

test('the day plan keeps only a few weeks around today', () => {
  const s = sanitizeDayPlan({ '2026-09-25': { label: 'Wrestling' }, '2020-01-01': { rest: true }, nope: { label: 'x' }, '2026-09-27': { routineId: 'sat' } }, friday);
  assert.deepEqual(Object.keys(s), ['2026-09-25', '2026-09-27']);
});
