import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/meals.js';
import { addProtein } from '../js/body.js';
import { validateBackup, BACKUP_KIND } from '../js/backup.js';

const T = new Date(2026, 8, 24, 13).getTime();
const raw = { food: true, name: 'Chicken, rice and broccoli', confidence: 'medium', protein: 52, kcal: 690, carbs: 80, fat: 14,
  items: [{ name: 'Chicken breast', grams: 180, protein: 45, kcal: 300 }, { name: 'Rice', grams: 250, protein: 6, kcal: 330 }, { name: 'Broccoli', grams: 100, protein: 3, kcal: 35 }] };

test('a sensible answer becomes a draft', () => {
  const d = M.validateMeal(raw);
  assert.equal(d.name, 'Chicken, rice and broccoli');
  assert.equal(d.protein, 52);
  assert.equal(d.items.length, 3);
});

test('not food, junk, or nonsense totals', () => {
  assert.equal(M.validateMeal({ ...raw, food: false }), null);
  assert.equal(M.validateMeal(null), null);
  assert.equal(M.validateMeal({ food: true, name: 'x', items: [], protein: 0, kcal: 0, confidence: 'low' }), null);
  // totals far from the items: the items win
  const d = M.validateMeal({ ...raw, protein: 400, kcal: 99999 });
  assert.equal(d.protein, 54);
  assert.equal(d.kcal, 665);
  assert.equal(M.validateMeal({ ...raw, confidence: 'weird' }).confidence, 'medium');
});

test('portions scale from the original estimate', () => {
  const d = M.validateMeal(raw);
  const big = M.scaleMeal(d, 1.5);
  assert.equal(big.protein, 78);
  assert.equal(big.items[0].grams, 270);
  assert.equal(M.scaleMeal(d, 1).protein, 52, 'back to 1× from the base');
  assert.equal(M.scaleMeal(d, 10).portion, 4);
});

test('meals add to the day and come off again; quick protein keeps them', () => {
  let { entries, meal } = M.addMeal([], '2026-09-24', { ...M.validateMeal(raw), source: 'photo', thumb: 'data:image/jpeg;base64,AAAA' }, T, 'm1');
  assert.equal(meal.thumb, 'data:image/jpeg;base64,AAAA');
  entries = addProtein(entries, '2026-09-24', 30);
  const day = M.dayOf(entries, '2026-09-24');
  assert.equal(day.protein, 82);
  assert.equal(day.kcal, 690);
  assert.equal(day.meals.length, 1, 'quick +30 kept the meal');
  entries = M.removeMeal(entries, '2026-09-24', 'm1');
  assert.equal(M.dayOf(entries, '2026-09-24').protein, 30);
  assert.equal(M.dayOf(entries, '2026-09-24').kcal, 0);
});

test('thumbs are only small JPEG data URLs', () => {
  assert.ok(M.validThumb('data:image/jpeg;base64,/9j/4AAQ=='));
  assert.ok(!M.validThumb('javascript:alert(1)'));
  assert.ok(!M.validThumb('data:image/jpeg;base64,AA" onerror="x'));
  const { meal } = M.addMeal([], '2026-09-24', { name: 'x', protein: 10, kcal: 100, thumb: '" onerror="alert(1)' }, T, 'm2');
  assert.equal(meal.thumb, undefined);
});

test('backups carry meals and reject a poisoned thumb', () => {
  const base = { kind: BACKUP_KIND, version: 1, data: { nutrition: [{ date: '2026-09-24', protein: 50, kcal: 600, meals: [{ id: 'm1', t: T, name: 'Eggs', protein: 20, kcal: 200, thumb: 'data:image/jpeg;base64,AAAA' }] }] } };
  assert.equal(validateBackup(base).ok, true);
  const bad = structuredClone(base);
  bad.data.nutrition[0].meals[0].thumb = '"><script>';
  assert.equal(validateBackup(bad).ok, false);
});

test('prompt carries the description and language', () => {
  assert.match(M.mealPrompt('2 eggs', 'da'), /Danish/);
  assert.match(M.mealPrompt('2 eggs', 'en'), /2 eggs/);
});

test('voice: meals are recognised, sets and protein are not mistaken for meals', async () => {
  const { parse } = await import('../js/parser.js');
  const { createCatalog } = await import('../js/catalog.js');
  const ctx = { lang: 'auto', unit: 'kg', catalog: createCatalog(), usage: {}, routines: [], workoutExerciseIds: [], current: null, restRunning: false };
  const p = q => parse(q, ctx);
  assert.deepEqual([p('I ate 3 eggs and toast').type, p('I ate 3 eggs and toast').text], ['LogMeal', '3 eggs and toast']);
  assert.equal(p('jeg spiste kylling og ris').type, 'LogMeal');
  assert.equal(p('I had 30 g protein').type, 'LogProtein');
  assert.equal(p('had 8 reps').type === 'LogMeal', false);
  assert.equal(p('80 kilo 8 reps').type, 'LogSet');
});

test('favourites: starred first, then repeated meals, newest values', () => {
  const day = (date, meals) => ({ date, protein: 0, meals });
  const now = Date.parse('2026-09-24T12:00:00');
  const d = t => now - t * 86_400_000;
  const entries = [
    day('2026-09-20', [{ id: 1, t: d(4), name: 'Protein shake', protein: 30, kcal: 150 }, { id: 2, t: d(4), name: 'Chicken rice', protein: 50, kcal: 650 }]),
    day('2026-09-23', [{ id: 3, t: d(1), name: 'protein  shake', protein: 32, kcal: 160 }, { id: 4, t: d(1), name: 'Pizza', protein: 35, kcal: 1100 }]),
    day('2026-09-24', [{ id: 5, t: d(0), name: 'Oats', protein: 15, kcal: 380 }])
  ];
  const f = M.favouriteMeals(entries, ['Oats'], now);
  assert.deepEqual(f.map(x => x.key), ['oats', 'protein shake']);
  assert.equal(f[1].meal.protein, 32, 'latest version');
  assert.equal(f[1].count, 2);
});
