import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/food.js';

const skyr = { code: '5701234567899', product_name: 'Skyr naturel', product_name_da: 'Skyr naturel', brands: 'Arla,Arla Foods', product_quantity: '1000', quantity: '1 kg', serving_quantity: '150',
  image_front_small_url: 'https://images.openfoodfacts.org/images/products/x.jpg', nutriments: { proteins_100g: 11, 'energy-kcal_100g': 63, carbohydrates_100g: 4, fat_100g: 0.2 } };

test('barcode check digits', () => {
  assert.ok(F.validBarcode('5701234567899'));
  assert.ok(F.validBarcode('4006381333931'));
  assert.ok(F.validBarcode('96385074'));
  assert.ok(F.validBarcode('036000291452'));
  assert.ok(!F.validBarcode('5701234567892'));
  assert.ok(!F.validBarcode('abc'));
});

test('Open Food Facts product → ours', () => {
  const p = F.fromOff(skyr, 'da');
  assert.equal(p.name, 'Skyr naturel');
  assert.equal(p.brand, 'Arla');
  assert.deepEqual(p.per100, { protein: 11, kcal: 63, carbs: 4, fat: 0.2 });
  assert.equal(p.servingG, 150);
  assert.equal(p.packG, 1000);
  // kJ only
  assert.equal(F.fromOff({ nutriments: { energy_100g: 418.4, proteins_100g: 5 } }).per100.kcal, 100);
  assert.equal(F.fromOff({ nutriments: {} }), null);
  assert.equal(F.fromOff({ ...skyr, image_front_small_url: 'javascript:x' }).image, null);
  assert.equal(F.fromOff({ ...skyr, product_quantity: null, quantity: '500 g' }).packG, 500);
});

test('amounts and nutrition for them', () => {
  const p = F.fromOff(skyr);
  assert.deepEqual(F.amountChoices(p).map(a => a.kind), ['serving', '100', 'pack']);
  assert.deepEqual(F.forAmount(p, 150), { protein: 17, kcal: 95, carbs: 6, fat: 0 });
});

test('a label read from a photo', () => {
  const p = F.fromLabel({ label: true, name: 'Protein bar', protein100: 33, kcal100: 360, carbs100: 30, fat100: 12, servingG: 60 }, '123');
  assert.equal(p.per100.protein, 33);
  assert.equal(p.servingG, 60);
  assert.equal(F.fromLabel({ label: false }), null);
  assert.equal(F.fromLabel({ label: true, protein100: 300, kcal100: 50 }), null, 'impossible values');
});

test('lookup: found, missing, offline', async () => {
  const ok = await F.lookup('5701234567899', 'en', async () => ({ ok: true, status: 200, json: async () => ({ status: 1, product: skyr }) }));
  assert.equal(ok.status, 'ok');
  assert.equal(ok.product.code, '5701234567899');
  assert.equal((await F.lookup('1', 'en', async () => ({ ok: true, status: 200, json: async () => ({ status: 0 }) }))).status, 'missing');
  assert.equal((await F.lookup('1', 'en', async () => ({ ok: false, status: 404 }))).status, 'missing');
  assert.equal((await F.lookup('1', 'en', async () => { throw new Error('x'); })).status, 'failed');
});

test('remembered products', () => {
  let l = F.remember([], { code: 'a', name: 'A' }, 1);
  l = F.remember(l, { code: 'b', name: 'B' }, 2);
  l = F.remember(l, { code: 'a', name: 'A2' }, 3);
  assert.deepEqual(l.map(p => p.name), ['A2', 'B']);
});
