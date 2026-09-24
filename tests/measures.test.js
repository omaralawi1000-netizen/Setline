import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/measures.js';

test('measurements merge per day and drop bad values', () => {
  let l = M.upsertMeasures([], '2026-09-01', { waist: 84.26, chest: 101, nose: 3, arm: 2 });
  assert.deepEqual(l, [{ date: '2026-09-01', waist: 84.3, chest: 101 }]);
  l = M.upsertMeasures(l, '2026-09-24', { waist: 82 });
  l = M.upsertMeasures(l, '2026-09-24', { arm: 38.5 });
  assert.deepEqual(l[1], { date: '2026-09-24', waist: 82, arm: 38.5 });
  l = M.upsertMeasures(l, '2026-09-24', { waist: null, arm: null });
  assert.equal(l.length, 1, 'an emptied day disappears');
});

test('summary: latest, change since the first, series', () => {
  const l = [{ date: '2026-08-01', waist: 86 }, { date: '2026-09-01', waist: 84.5, arm: 37 }, { date: '2026-09-24', waist: 83 }];
  const s = Object.fromEntries(M.measureSummary(l).map(x => [x.site, x]));
  assert.equal(s.waist.latest, 83);
  assert.equal(s.waist.change, -3);
  assert.equal(s.waist.series.length, 3);
  assert.equal(s.arm.change, null);
  assert.equal(s.neck.latest, null);
});

test('photos by day, and a fair before/after pair', () => {
  const p = [
    { id: 'a', date: '2026-08-01', pose: 'side', t: 1 }, { id: 'b', date: '2026-08-01', pose: 'front', t: 2 },
    { id: 'c', date: '2026-09-24', pose: 'front', t: 3 }, { id: 'd', date: '2026-09-24', pose: 'back', t: 4 }
  ];
  const days = M.photoDays(p);
  assert.deepEqual(days.map(d => d.date), ['2026-09-24', '2026-08-01']);
  assert.deepEqual(days[1].photos.map(x => x.pose), ['front', 'side']);
  assert.deepEqual(M.comparePair(p).map(x => x.id), ['b', 'c'], 'same pose, first and last');
  assert.equal(M.comparePair([p[0]]), null);
});
