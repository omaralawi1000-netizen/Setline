import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPair, changeBetween } from '../js/measures.js';

const DAY = 86_400_000, T = Date.UTC(2026, 8, 24);
const ph = (id, daysAgo, pose = 'front') => ({ id, pose, t: T - daysAgo * DAY, date: new Date(T - daysAgo * DAY).toISOString().slice(0, 10) });

test('pairs the latest photo with the one closest to a month before', () => {
  const p = monthlyPair([ph('a', 90), ph('b', 58), ph('c', 31), ph('d', 10), ph('e', 1), ph('s', 40, 'side')]);
  assert.equal(p.after.id, 'e');
  assert.equal(p.before.id, 'c');
  assert.equal(p.days, 30);
  assert.equal(monthlyPair([ph('a', 12), ph('b', 1)]), null, 'too close together');
  assert.equal(monthlyPair([ph('a', 1)]), null);
});

test('weight and waist change between the two dates', () => {
  const bw = [{ date: '2026-08-20', kg: 84.6 }, { date: '2026-08-25', kg: 84.2 }, { date: '2026-09-22', kg: 82.9 }];
  const ms = [{ date: '2026-08-24', waist: 86 }, { date: '2026-09-23', waist: 84.5, chest: 104 }];
  const c = changeBetween(bw, ms, '2026-08-25', '2026-09-23');
  assert.deepEqual(c.kg, { from: 84.2, to: 82.9, change: -1.3 });
  assert.deepEqual(c.waist, { from: 86, to: 84.5, change: -1.5 });
  assert.equal(changeBetween([], [], '2026-08-25', '2026-09-23').kg, null);
});
