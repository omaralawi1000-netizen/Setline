import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoutineImport, validateImport, planToRoutines, isPlanRequest } from '../js/coach.js';
import { createCatalog } from '../js/catalog.js';

const catalog = createCatalog();
const text = `Monday — Legs + Shoulders
- Hack squat — 3 sets × 70 kg loaded weight
- Seated leg curl — 3 sets × 80 kg
- Leg extension — 3 sets × 150 kg`;

test('a pasted routine is an import, a request is a plan', () => {
  assert.ok(isRoutineImport(text));
  assert.ok(isRoutineImport('This is my routine: Monday legs and shoulders, hack squat and leg curls, Wednesday chest and biceps with incline smith press'));
  assert.ok(!isRoutineImport('make me a 4 day upper lower plan'));
  assert.ok(isPlanRequest('make me a 4 day upper lower plan'));
});

test('the copy keeps weights, makes missing exercises, never duplicates', () => {
  let n = 0;
  const raw = { name: 'My split', summary: 'Set up. Rear-delt exercise left out.', days: [
    { name: 'Monday: Legs + Shoulders', exercises: [
      { exercise: 'Hack squat', inCatalog: true, equipment: 'machine', muscle: 'quads', sets: 3, reps: 0, kg: 70 },
      { exercise: 'Seated leg curl', inCatalog: true, equipment: 'machine', muscle: 'hamstrings', sets: 3, reps: 10, kg: 80 },
      { exercise: 'Calf raise', inCatalog: false, equipment: 'machine', muscle: 'calves', sets: 2, reps: 0, kg: 0 }] },
    { name: 'Wednesday: Chest + Biceps', exercises: [
      { exercise: 'Incline Smith press', inCatalog: false, equipment: 'smith', muscle: 'chest', sets: 3, reps: 0, kg: 90 },
      { exercise: 'Incline Smith press', inCatalog: false, equipment: 'smith', muscle: 'chest', sets: 3, reps: 0, kg: 90 }] },
    { name: 'Friday', exercises: [{ exercise: 'Incline smith press', inCatalog: false, equipment: 'smith', muscle: 'chest', sets: 2, reps: 8, kg: 80 }] }
  ] };
  const plan = validateImport(raw, catalog, () => 'c-' + ++n);
  assert.equal(plan.days.length, 3);
  const [hack, curl, calf] = plan.days[0].exercises;
  assert.equal(hack.exerciseId, 'hack-squat'); assert.equal(hack.kg, 70); assert.ok(hack.repsGuessed);
  assert.equal(curl.exerciseId, 'seated-leg-curl'); assert.equal(curl.reps, 10);
  assert.equal(calf.kg, null);
  assert.equal(plan.days[1].exercises.length, 1, 'no duplicates in a day');
  assert.equal(plan.customs.filter(c => /smith/i.test(c.en)).length, 1, 'one custom shared across days');
  assert.equal(plan.days[2].exercises[0].exerciseId, plan.days[1].exercises[0].exerciseId);
  const r = planToRoutines(plan);
  assert.equal(r[0].exercises[0].sets[0].kg, 70);
  assert.equal(r[0].name, 'Monday: Legs + Shoulders');
});
