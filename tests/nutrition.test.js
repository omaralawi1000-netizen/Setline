import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/nutrition.js';

const at = (h, m = 0) => new Date(2026, 8, 24, h, m).getTime();

test('meals fall into the right slot', () => {
  assert.equal(N.slotAt(at(7, 30)), 'breakfast');
  assert.equal(N.slotAt(at(12)), 'lunch');
  assert.equal(N.slotAt(at(16)), 'snack');
  assert.equal(N.slotAt(at(19)), 'dinner');
  assert.equal(N.slotAt(at(23)), 'snack');
  assert.equal(N.slotOf({ t: at(8), slot: 'dinner' }), 'dinner', 'a chosen slot wins');
});

test('targets follow the profile and add up', () => {
  const p = { birthYear: 1999, sex: 'male', heightCm: 183, days: 5, goal: 'muscle', cardio: 'some' };
  const t = N.autoTargets({ profile: p, bodyweightKg: 84, proteinPerKg: 1.8, now: at(12) });
  assert.ok(t.kcal > 2800 && t.kcal < 3600, t.kcal);
  assert.equal(t.protein, 150);
  assert.ok(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal) < 40, 'macros add up to the calories');
  const cut = N.autoTargets({ profile: { ...p, goal: 'fatloss' }, bodyweightKg: 84, now: at(12) });
  assert.ok(cut.kcal < t.kcal * 0.8, 'fat loss eats less');
  assert.ok(N.autoTargets().kcal > 1200, 'works with no profile');
  assert.deepEqual(N.targetsFor(t, { kcal: 2500 }).kcal, 2500);
  assert.equal(N.sanitizeTargets({ kcal: 99999, junk: 1 }).kcal, 6000);
  assert.equal(N.sanitizeTargets({}), null);
});

test('day totals count meals and quick protein; water and slots', () => {
  const entry = { date: '2026-09-24', protein: 90, kcal: 900, meals: [
    { id: 'a', t: at(8), protein: 30, kcal: 500, carbs: 60, fat: 10 },
    { id: 'b', t: at(12), protein: 40, kcal: 400, carbs: 20, fat: 15, slot: 'dinner' }] };
  const d = N.dayTotals(entry);
  assert.deepEqual([d.kcal, d.protein, d.carbs, d.fat, d.quickProtein], [900, 90, 80, 25, 20]);
  const s = N.bySlot(entry);
  assert.equal(s.breakfast[0].id, 'a');
  assert.equal(s.dinner[0].id, 'b');
  let es = N.addWater([entry], '2026-09-24', 250);
  es = N.addWater(es, '2026-09-24', 250);
  assert.equal(es[0].water, 500);
  assert.equal(es[0].meals.length, 2, 'meals stay');
  assert.equal(N.setSlot(es, '2026-09-24', 'a', 'snack')[0].meals[0].slot, 'snack');
  const wk = N.weekOf(es, '2026-09-24');
  assert.equal(wk.length, 7);
  assert.equal(wk[6].kcal, 900);
  assert.equal(wk[0].date, '2026-09-18');
  const sp = N.energySplit({ protein: 100, carbs: 100, fat: 0 });
  assert.equal(sp.protein, 0.5);
});
