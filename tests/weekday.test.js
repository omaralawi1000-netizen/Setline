import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routineDay, withoutDay, nextRoutine } from '../js/routines.js';

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
  assert.equal(nextRoutine(rs, [{ routineId: 'b', startedAt: monday - 3600e3 }], monday).id, 'a', 'done today: back to rotation');
});
