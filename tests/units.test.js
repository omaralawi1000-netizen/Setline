import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDisplay, fromDisplay, stepWeight, parseNumber, kgToLb } from '../js/units.js';
import * as F from '../js/format.js';

test('kg is stored, lb only converted at the edges', () => {
  assert.equal(toDisplay(100, 'kg'), 100);
  assert.equal(toDisplay(100, 'lb'), 220.5);
  assert.equal(toDisplay(82.5, 'kg'), 82.5);
  assert.ok(Math.abs(kgToLb(1) - 2.2046) < 1e-4);
});

test('lb round trip shows the number the user typed', () => {
  for (const lb of [45, 135, 185, 225, 227.5, 315, 405]) {
    assert.equal(toDisplay(fromDisplay(lb, 'lb'), 'lb'), lb);
  }
  assert.equal(fromDisplay(82.5, 'kg'), 82.5);
  assert.equal(fromDisplay(NaN, 'kg'), null);
});

test('stepWeight moves 2.5 kg or 5 lb and snaps to the grid', () => {
  assert.equal(stepWeight(80, 1, 'kg'), 82.5);
  assert.equal(stepWeight(80, -1, 'kg'), 77.5);
  assert.equal(stepWeight(81, 1, 'kg'), 82.5);
  assert.equal(stepWeight(81, -1, 'kg'), 80);
  assert.equal(stepWeight(0, -1, 'kg'), 0);
  assert.equal(stepWeight(1, -1, 'kg'), 0);
  assert.equal(toDisplay(stepWeight(fromDisplay(135, 'lb'), 1, 'lb'), 'lb'), 140);
  assert.equal(toDisplay(stepWeight(fromDisplay(135, 'lb'), -1, 'lb'), 'lb'), 130);
});

test('parseNumber accepts comma and dot decimals', () => {
  assert.equal(parseNumber('82,5'), 82.5);
  assert.equal(parseNumber('82.5'), 82.5);
  assert.equal(parseNumber(' 100 '), 100);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('-5'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('1e3'), null);
});

test('format numbers per language', () => {
  assert.equal(F.weight(82.5, 'kg', 'en'), '82.5');
  assert.equal(F.weight(82.5, 'kg', 'da'), '82,5');
  assert.equal(F.total(4820, 'kg', 'en'), '4,820');
  assert.equal(F.total(4820, 'kg', 'da'), '4.820');
  assert.equal(F.clock(32 * 60 + 14), '32:14');
  assert.equal(F.clock(3729), '1:02:09');
  assert.equal(F.mss(72), '1:12');
  assert.equal(F.mss(71.2), '1:12');
  assert.equal(F.minutes(52 * 60), '52 min');
  assert.equal(F.greetingKey(19), 'greet.evening');
  assert.equal(F.greetingKey(8), 'greet.morning');
});
