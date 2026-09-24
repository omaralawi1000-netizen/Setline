import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchLocal, searchOnline, localFood } from '../js/fooddb.js';
import { FOODS_DK } from '../data/foods-dk.js';

test('the Danish food list is sane', () => {
  assert.ok(FOODS_DK.length >= 200);
  assert.equal(new Set(FOODS_DK.map(f => f[0])).size, FOODS_DK.length, 'unique ids');
  for (const f of FOODS_DK) {
    assert.equal(f.length, 10, f[0]);
    assert.ok(f[3] >= 0 && f[3] <= 900 && f[4] >= 0 && f[4] <= 100 && f[5] >= 0 && f[5] <= 100 && f[6] >= 0 && f[6] <= 100, f[0]);
    assert.ok(f[7] > 0, f[0] + ' portion');
  }
});

test('local search in Danish and English, typo-tolerant on æøå', () => {
  assert.equal(searchLocal('rugbrød', 'da')[0].code, 'dk:rugbrod');
  assert.equal(searchLocal('rugbrod', 'da')[0].code, 'dk:rugbrod');
  assert.equal(searchLocal('rye bread', 'en')[0].code, 'dk:rugbrod');
  assert.ok(searchLocal('skyr', 'da').some(p => p.code === 'dk:skyr'));
  assert.equal(searchLocal('frikad', 'da')[0].code, 'dk:frikadeller');
  assert.ok(searchLocal('kylling', 'da').length >= 3);
  assert.equal(searchLocal('', 'da').length, 0);
  const p = localFood('havregryn', 'da');
  assert.deepEqual([p.servingG, p.servingLabel, p.per100.protein], [50, '1 portion', 13]);
});

test('online search maps Open Food Facts products', async () => {
  let asked = '';
  const fetchFn = async url => { asked = url; return { ok: true, json: async () => ({ products: [{ code: '5711953068881', product_name: 'Skyr vanilje', brands: 'Cheasy', nutriments: { 'energy-kcal_100g': 55, proteins_100g: 8.6, carbohydrates_100g: 4, fat_100g: 0.2 }, serving_quantity: '500' }, { code: '1', product_name: '' }] }) }; };
  const r = await searchOnline('cheasy skyr', 'da', { fetchFn });
  assert.match(asked, /tag_0=denmark/);
  assert.equal(r.length, 1);
  assert.equal(r[0].per100.protein, 8.6);
  assert.deepEqual(await searchOnline('ab', 'da', { fetchFn }), []);
});
