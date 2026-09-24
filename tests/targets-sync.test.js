import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncTargets } from '../js/nutrition.js';

const base = { kcal: 2600, protein: 180, carbs: 300, fat: 75, water: 3000 };
const sum = x => x.protein * 4 + x.carbs * 4 + x.fat * 9;

test('calories move carbs, protein stays', () => {
  const t = syncTargets(base, 'kcal', 2400);
  assert.equal(t.protein, 180);
  assert.equal(t.fat, 75);
  assert.ok(t.carbs < 300);
  assert.equal(t.kcal, sum(t));
  assert.ok(Math.abs(t.kcal - 2400) <= 4);
});

test('a low calorie target takes fat once carbs hit the floor', () => {
  const t = syncTargets(base, 'kcal', 1500);
  assert.equal(t.protein, 180);
  assert.ok(t.carbs >= 50 && t.fat < 75);
  assert.equal(t.kcal, sum(t));
});

test('macros move calories', () => {
  const t = syncTargets(base, 'protein', 200);
  assert.equal(t.kcal, sum({ ...base, protein: 200 }));
  assert.equal(syncTargets(base, 'fat', 60).kcal, sum({ ...base, fat: 60 }));
  assert.equal(syncTargets(base, 'water', 3500).kcal, 2600);
});
