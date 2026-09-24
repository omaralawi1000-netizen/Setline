import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, translator, resolveLang, joinList } from '../js/i18n.js';
import { VERSION } from '../js/version.js';
import { sanitize, DEFAULTS } from '../js/settings.js';
import { starterRoutines, estimateMinutes } from '../js/routines.js';
import { createCatalog } from '../js/catalog.js';

test('English and Danish have the same keys', () => {
  const en = Object.keys(STRINGS.en).sort(), da = Object.keys(STRINGS.da).sort();
  assert.deepEqual(da.filter(k => !en.includes(k)), []);
  assert.deepEqual(en.filter(k => !da.includes(k)), []);
});

test('translator handles params and plurals', () => {
  const t = translator('en'), d = translator('da');
  assert.equal(t('workout.logSet', { n: 3 }), 'Log set 3');
  assert.equal(d('workout.logSet', { n: 3 }), 'Log sæt 3');
  assert.equal(t('history.sets', { n: 1 }), '1 set');
  assert.equal(t('missing.key'), 'missing.key');
  assert.equal(resolveLang('auto', 'da-DK'), 'da');
  assert.equal(resolveLang('auto', 'en-US'), 'en');
  assert.equal(resolveLang('en', 'da-DK'), 'en');
  assert.equal(joinList(['chest', 'triceps'], 'en'), 'chest and triceps');
  assert.equal(joinList(['bryst', 'triceps', 'skuldre'], 'da'), 'bryst, triceps og skuldre');
});

test('service worker version matches the app version', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, new RegExp(`const VERSION = '${VERSION.replace(/\./g, '\\.')}'`));
});

test('service worker precaches files that exist', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  for (const p of list) if (p !== './') readFileSync(new URL('../' + p, import.meta.url));
  for (const f of ['js/app.js', 'css/app.css', 'css/tokens.css', 'data/exercises.js', 'manifest.webmanifest']) {
    assert.ok(list.includes(f), 'missing ' + f);
  }
});

test('settings sanitize rejects junk and clamps rest', () => {
  assert.deepEqual(sanitize(null), DEFAULTS);
  assert.equal(sanitize({ restSec: 10 }).restSec, 30);
  assert.equal(sanitize({ restSec: 999 }).restSec, 300);
  assert.equal(sanitize({ restSec: 100 }).restSec, 105);
  assert.equal(sanitize({ unit: 'stone' }).unit, 'kg');
  assert.equal(sanitize({ apiKey: 'x' }).apiKey, undefined);
});

test('Push day uses real catalog exercises', () => {
  const cat = createCatalog();
  const [push] = starterRoutines();
  assert.equal(push.exercises.length, 5);
  for (const e of push.exercises) assert.ok(cat.get(e.exerciseId), e.exerciseId);
  assert.equal(estimateMinutes(push), 55);
});
