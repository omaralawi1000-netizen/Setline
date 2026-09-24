import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../data/exercises.js';
import { createCatalog, normalize, makeCustom, MUSCLES, EQUIPMENT } from '../js/catalog.js';

test('catalog has about 60 unique, complete exercises', () => {
  assert.ok(EXERCISES.length >= 55 && EXERCISES.length <= 75, `count ${EXERCISES.length}`);
  const ids = new Set(), en = new Set(), da = new Set();
  for (const e of EXERCISES) {
    assert.ok(e.id && e.en && e.da, e.id);
    assert.ok(!ids.has(e.id), 'dup id ' + e.id); ids.add(e.id);
    assert.ok(!en.has(e.en), 'dup en ' + e.en); en.add(e.en);
    assert.ok(!da.has(e.da), 'dup da ' + e.da); da.add(e.da);
    assert.ok(e.muscles.length && e.muscles.every(m => MUSCLES.includes(m)), e.id);
    assert.ok(EQUIPMENT.includes(e.equipment), e.id);
  }
});

test('no alias points at two exercises', () => {
  const seen = new Map();
  for (const e of EXERCISES) for (const t of new Set([e.en, e.da, ...e.aliases].map(normalize))) {
    assert.ok(!seen.has(t) || seen.get(t) === e.id, `"${t}" used by ${seen.get(t)} and ${e.id}`);
    seen.set(t, e.id);
  }
});

test('normalize folds Danish letters and punctuation', () => {
  assert.equal(normalize('Bænkpres'), 'baenkpres');
  assert.equal(normalize('Dødløft'), 'doedloeft');
  assert.equal(normalize('Pull-ups'), 'pullups');
  assert.equal(normalize('Knæbøj'), normalize('knaeboej'));
});

const cat = createCatalog();
const top = (q, o) => cat.search(q, o)[0]?.id;

test('search finds English, Danish and aliases', () => {
  assert.equal(top('bench'), 'bench-press');
  assert.equal(top('bænkpres'), 'bench-press');
  assert.equal(top('dødløft'), 'deadlift');
  assert.equal(top('militærpres'), 'overhead-press');
  assert.equal(top('knæbøj'), 'back-squat');
  assert.equal(top('squat'), 'back-squat');
  assert.equal(top('roning'), 'barbell-row');
  assert.equal(top('pullups'), 'pull-up');
  assert.equal(top('pull-ups'), 'pull-up');
  assert.equal(top('ohp'), 'overhead-press');
  assert.equal(top('rdl'), 'romanian-deadlift');
});

test('search tolerates small typos and word order', () => {
  assert.equal(top('benchpress'), 'bench-press');
  assert.equal(top('bench pres'), 'bench-press');
  assert.equal(top('deadlfit'), 'deadlift');
  assert.equal(top('latteral raise'), 'lateral-raise');
  assert.equal(top('press bench'), 'bench-press');
});

test('usage frequency nudges ties', () => {
  assert.notEqual(top('raise'), 'cable-lateral-raise');
  assert.equal(top('raise', { usage: { 'cable-lateral-raise': 9 } }), 'cable-lateral-raise');
  assert.equal(top('', { usage: { 'hammer-curl': 3 } }), 'hammer-curl');
});

test('names by language and custom exercises', () => {
  assert.equal(cat.name('bench-press', 'da'), 'Bænkpres');
  assert.equal(cat.name('bench-press', 'en'), 'Bench press');
  const c = makeCustom({ name: '  Landmine  press ', muscle: 'shoulders', equipment: 'barbell' }, 'c-1');
  assert.equal(c.ok, true);
  assert.equal(c.exercise.en, 'Landmine press');
  const withCustom = createCatalog([c.exercise]);
  assert.equal(withCustom.search('landmine')[0].id, 'c-1');
  assert.equal(withCustom.get('c-1').custom, true);
  assert.equal(makeCustom({ name: 'x', muscle: 'chest', equipment: 'barbell' }).ok, false);
  assert.equal(makeCustom({ name: 'Thing', muscle: 'nope', equipment: 'barbell' }).ok, false);
  assert.equal(cat.findExact('Bænkpres').id, 'bench-press');
  assert.equal(cat.findExact('landmine press'), null);
});
