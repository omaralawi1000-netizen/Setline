import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routineDay, withoutDay, nextRoutine, daysUntil } from '../js/routines.js';

test('weekday from name or setting', () => {
  assert.equal(routineDay({ name: 'Monday: Legs + Shoulders' }), 1);
  assert.equal(routineDay({ name: 'Onsdag – bryst og biceps' }), 3);
  assert.equal(routineDay({ name: 'Mon - Legs' }), 1);
  assert.equal(routineDay({ name: 'Back + Triceps' }), null);
  assert.equal(routineDay({ name: 'Manual work', weekday: 5 }), 5);
  assert.equal(routineDay({ name: 'Push day' }), null);
  assert.equal(withoutDay('Monday: Legs + Shoulders'), 'Legs + Shoulders');
});

test("today's routine comes first until you've trained today", () => {
  const monday = new Date(2026, 8, 28, 9).getTime(); // a Monday
  const rs = [{ id: 'a', name: 'Back + Triceps', createdAt: 1 }, { id: 'b', name: 'Monday: Legs', createdAt: 2 }, { id: 'c', name: 'Wednesday: Chest', createdAt: 3 }];
  assert.equal(nextRoutine(rs, [], monday).id, 'b');
  assert.equal(nextRoutine(rs, [{ routineId: 'b', startedAt: monday - 3600e3 }], monday).id, 'c', 'done today: the next day in the week');
});

test('a rest day shows the next day in the plan, not the one done longest ago', () => {
  const friday = new Date(2026, 8, 25, 9).getTime(); // a Friday (rest)
  const rs = [
    { id: 'mon', name: 'Monday: Legs + Shoulders', createdAt: 1 }, { id: 'wed', name: 'Wednesday: Chest + Biceps', createdAt: 2 },
    { id: 'thu', name: 'Thursday: Back + Triceps', createdAt: 3 }, { id: 'sat', name: 'Saturday: Chest + Biceps', createdAt: 4 }, { id: 'sun', name: 'Sunday: Back + Triceps', createdAt: 5 }
  ];
  const hist = [{ routineId: 'thu', startedAt: friday - 86_400e3 }];
  assert.equal(nextRoutine(rs, hist, friday).id, 'sat');
  assert.equal(daysUntil(rs[3], hist, friday), 1, 'tomorrow');
  const sunday = new Date(2026, 8, 27, 20).getTime();
  assert.equal(nextRoutine(rs, [{ routineId: 'sun', startedAt: sunday - 3600e3 }], sunday).id, 'mon', 'trained today: the week wraps round to Monday');
});
