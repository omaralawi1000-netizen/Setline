import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartRamp, needsWarmup, warmupsFor, pendingWarmup } from '../js/warmup.js';
import { createCatalog } from '../js/catalog.js';
import * as W from '../js/workout.js';

const cat = createCatalog();
const kgs = r => r.map(s => `${s.kg}x${s.reps}`).join(' ');

test('smart ramp fits the kit and the load', () => {
  assert.equal(kgs(smartRamp(100)), '20x10 50x5 70x3 85x2');
  assert.equal(kgs(smartRamp(50)), '20x10 30x5');
  assert.equal(smartRamp(30).length, 0, 'too light for a ramp');
  assert.equal(kgs(smartRamp(180)), '20x8 72.5x5 107.5x3 135x2 157.5x1', 'heavy: more, smaller steps');
  assert.equal(kgs(smartRamp(32, { equipment: 'dumbbell', round: 2 })), '16x8 24x4', 'no bar for dumbbells');
  assert.equal(kgs(smartRamp(60, { equipment: 'machine' })), '30x10 45x5');
  assert.equal(kgs(smartRamp(100, { light: true })), '70x3', 'one feeler set when warm');
  assert.equal(smartRamp(80, { equipment: 'bodyweight' }).length, 0);
  for (const s of smartRamp(140)) assert.ok(s.kg < 140 && s.type === 'warmup');
});

test('needs a warm-up: first lift for a muscle, light after, never twice', () => {
  const bench = cat.search('bench press')[0].id, incline = cat.search('incline dumbbell press')[0].id, squat = cat.search('squat')[0].id;
  let w = W.createWorkout({ exercises: [{ exerciseId: bench, sets: [{ kg: 100, reps: 5 }] }, { exerciseId: incline, sets: [{ kg: 30, reps: 8 }] }, { exerciseId: squat, sets: [{ kg: 120, reps: 5 }] }] });
  assert.equal(needsWarmup(w, 0, cat), 'full');
  const ramp = warmupsFor(w, 0, { catalog: cat });
  assert.ok(ramp.length >= 3);
  w = W.addWarmups(w, 0, ramp);
  assert.equal(needsWarmup(w, 0, cat), null, 'already has them');
  assert.equal(pendingWarmup(w.exercises[0]).kg, 20);
  w = W.logSet(w, 0, { kg: 100, reps: 5 }).workout;
  assert.equal(w.exercises[0].sets.filter(s => s.type === 'warmup').length, 0, 'unticked warm-ups dropped at the first work set');
  assert.equal(needsWarmup(w, 1, cat), null, 'dumbbells on warm chest: none');
  assert.equal(warmupsFor(w, 1, { catalog: cat, force: true }).length, 2, 'asked for: full');
  assert.equal(needsWarmup(w, 2, cat), 'full', 'new muscle');
  w = W.addWarmups(w, 2, warmupsFor(w, 2, { catalog: cat }));
  w = { ...w, exercises: w.exercises.map((e, i) => i === 2 ? { ...e, sets: e.sets.filter(s => s.type !== 'warmup') } : e) };
  assert.equal(needsWarmup(w, 2, cat), null, 'removed by hand: not added again');
});
