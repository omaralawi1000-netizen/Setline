import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAppChanges, planAppChanges } from '../js/appedit.js';

test('splitAppChanges keeps plan changes apart from app changes', () => {
  const { app, plan } = splitAppChanges([{ day: '2026-09-26', rest: true }, { setting: 'restSec', value: 120 }, { do: 'log 2 eggs' }, { open: 'food' }]);
  assert.equal(plan.length, 1);
  assert.equal(app.length, 3);
});

test('settings are validated and remembered for undo', () => {
  const r = planAppChanges([{ setting: 'restSec', value: 118 }, { setting: 'unit', value: 'lb' }, { setting: 'haptics', value: 'off' }], { restSec: 90, unit: 'kg', haptics: true });
  assert.deepEqual(r.settings, { restSec: 120, unit: 'lb', haptics: false });
  assert.deepEqual(r.before, { restSec: 90, unit: 'kg', haptics: true });
  assert.equal(r.done.length, 3);
});

test('unknown or out-of-range settings are refused', () => {
  const r = planAppChanges([{ setting: 'restSec', value: 5000 }, { setting: 'googleKey', value: 'x' }, { setting: 'accent', value: 'pink' }]);
  assert.deepEqual(r.settings, {});
  assert.equal(r.failed.length, 3);
});

test('do and open', () => {
  const r = planAppChanges([{ do: 'log 2 eggs and toast' }, { open: 'train' }, { open: 'nowhere' }]);
  assert.deepEqual(r.dos, ['log 2 eggs and toast']);
  assert.equal(r.open, 'workout');
  assert.equal(r.failed.length, 1);
});

import { splitActions, hideActionTail, isAffirm } from '../js/appedit.js';
test('splitActions reads offers and hides them from the reply', () => {
  const r = splitActions('Legs fit better on Friday.\nACTION: {"label":"Move legs to Friday","changes":[{"routine":"Legs","weekday":"Fri"}]}\nACTION: {"label":"Log 2 eggs","do":"log 2 eggs"}\nACTION: {"label":"Third","do":"x"}');
  assert.equal(r.text, 'Legs fit better on Friday.');
  assert.equal(r.actions.length, 2);
  assert.deepEqual(r.actions[1], { label: 'Log 2 eggs', changes: [{ do: 'log 2 eggs' }] });
});
test('splitActions skips broken offers', () => {
  const r = splitActions('Hi\nACTION: {"label":"No changes"}\nACTION: {not json}');
  assert.equal(r.text, 'Hi');
  assert.equal(r.actions.length, 0);
});
test('hideActionTail hides a half-streamed offer', () => {
  assert.equal(hideActionTail('Sure.\nACTION: {"label":"Mo'), 'Sure.');
  assert.equal(hideActionTail('Sure.\nACTI'), 'Sure.');
});
test('isAffirm', () => {
  for (const s of ['yes', 'Do it!', 'ja tak', 'gør det', 'go ahead']) assert.equal(isAffirm(s), true, s);
  for (const s of ['yes but later', 'do it tomorrow', 'no']) assert.equal(isAffirm(s), false, s);
});
