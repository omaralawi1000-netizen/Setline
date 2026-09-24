import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { resolve } from '../js/commands.js';
import { createCatalog } from '../js/catalog.js';
import { translator } from '../js/i18n.js';
import * as W from '../js/workout.js';

const catalog = createCatalog();
const ctx = { lang: 'auto', unit: 'kg', catalog, usage: {}, current: { exerciseId: 'bench-press', lastSet: null, planned: { kg: 80, reps: 8 } }, workoutExerciseIds: ['bench-press'], routines: [] };

test('a change told about a named lift', () => {
  const cases = {
    'I did one more rep on tricep pushdown today': { exerciseId: 'triceps-pushdown', repsDelta: 1 },
    'one more rep on triceps pushdowns': { exerciseId: 'triceps-pushdown', repsDelta: 1 },
    'I did 2 kilos more on the leg press': { exerciseId: 'leg-press', kgDelta: 2 },
    'one rep less on bench': { exerciseId: 'bench-press', repsDelta: -1 },
    'I did 12 on pushdowns today': { exerciseId: 'triceps-pushdown', reps: 12 },
    'Jeg tog en gentagelse mere på triceps pushdown': { exerciseId: 'triceps-pushdown', repsDelta: 1 }
  };
  for (const [s, want] of Object.entries(cases)) {
    const r = parse(s, ctx);
    assert.equal(r.type, 'LogRel', s);
    for (const [k, v] of Object.entries(want)) assert.equal(r[k], v, `${s}: ${k}`);
    assert.equal(r.heard, s);
  }
  assert.equal(parse('I needed one more rep', ctx).repsDelta, -1, 'one short');
});

test('resolved against that lift\'s plan', () => {
  const routines = [{ id: 'r', name: 'Back + Triceps', exercises: [{ exerciseId: 'triceps-pushdown', sets: [{ reps: 10, kg: 73 }, { reps: 10, kg: 73 }] }] }];
  const w = W.createWorkout({ exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 80, reps: 8 }] }] });
  const snap = { active: w, history: [], prs: {}, routines, undoCount: 0, settings: { unit: 'kg', restSec: 90, spoken: 'minimal', restByEx: {}, autoAdvance: true }, catalog, now: Date.now() };
  const t = translator('en');
  const c = resolve(parse('I did one more rep on tricep pushdown today', ctx), snap, t, 'en');
  assert.equal(c.kind, 'auto');
  const after = c.run.fn(w, Date.now());
  const ex = after.exercises.find(e => e.exerciseId === 'triceps-pushdown');
  assert.deepEqual([ex.sets[0].kg, ex.sets[0].reps], [73, 11]);
  // unknown weight anywhere: ask
  const q = resolve(parse('one more rep on hammer curls', ctx), { ...snap, routines: [] }, t, 'en');
  assert.equal(q.kind, 'ask');
});
