import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMeal, addMeal } from '../js/meals.js';
import { parseMealLocal } from '../js/fooddb.js';
import { sanitize, ACCENTS } from '../js/settings.js';
import { isNoise } from '../js/coach.js';

test('a meal said in one go splits into items that share a group', () => {
  const m = { name: 'Blueberries and skyr', source: 'voice', slot: 'breakfast', kcal: 338, protein: 15, carbs: 64, fat: 2,
    items: [{ name: 'Blueberries', grams: 500, kcal: 275, protein: 4, carbs: 60, fat: 2 }, { name: 'Skyr', grams: 100, kcal: 63, protein: 11, carbs: 4, fat: 0 }] };
  const out = splitMeal(m, 'g-1');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(x => [x.name, x.kcal, x.protein, x.group, x.slot]), [['Blueberries · 500 g', 275, 4, 'g-1', 'breakfast'], ['Skyr · 100 g', 63, 11, 'g-1', 'breakfast']]);
});

test('a single food, or items without numbers, stay one meal', () => {
  const one = { name: 'Banana', kcal: 100, protein: 1, items: [{ name: 'Banana', kcal: 100 }] };
  assert.deepEqual(splitMeal(one), [one]);
  const vague = { name: 'Pasta', kcal: 700, protein: 25, items: [{ name: 'Pasta' }, { name: 'Sauce' }] };
  assert.deepEqual(splitMeal(vague), [vague]);
});

test('items with no macros get a share of the meal by calories', () => {
  const out = splitMeal({ name: 'x', kcal: 400, protein: 40, carbs: 0, fat: 0, items: [{ name: 'A', kcal: 300 }, { name: 'B', kcal: 100 }] }, 'g');
  assert.deepEqual(out.map(x => x.protein), [30, 10]);
});

test('the group survives being stored', () => {
  const { meal } = addMeal([], '2026-09-24', { name: 'Skyr', kcal: 63, protein: 11, group: 'g-1' });
  assert.equal(meal.group, 'g-1');
});

test('local food parse keeps each item', () => {
  const r = parseMealLocal('500 g blueberries and 100 g skyr', 'en');
  assert.ok(r && r.items.length === 2, JSON.stringify(r));
  assert.ok(r.items.every(i => i.kcal > 0 && i.grams > 0));
});

test('the quiet palette, with old colours mapped to their neighbour', () => {
  assert.deepEqual(ACCENTS, ['violet', 'aurora', 'sunset', 'ocean', 'slate', 'sage', 'sand', 'clay', 'mono']);
  assert.equal(sanitize({ accent: 'ocean' }).accent, 'ocean'); // a two-tone theme again (1.48)
  assert.equal(sanitize({ accent: 'crimson' }).accent, 'clay');
  assert.equal(sanitize({ accent: 'lime' }).accent, 'sage');
  assert.equal(sanitize({ accent: 'nope' }).accent, 'violet');
});

test('talk mode ignores a lone noise word but not a real short answer', () => {
  assert.ok(isNoise('Sink.'));
  assert.ok(isNoise(''));
  assert.ok(!isNoise('Yes.'));
  assert.ok(!isNoise('Nej'));
  assert.ok(!isNoise('What should I eat?'));
  assert.ok(!isNoise('100'));
});
