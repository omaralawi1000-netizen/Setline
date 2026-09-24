import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { resolve } from '../js/commands.js';
import { createCatalog } from '../js/catalog.js';
import { translator } from '../js/i18n.js';
import * as W from '../js/workout.js';

const catalog = createCatalog();
const ctx = { lang: 'en', unit: 'kg', catalog, usage: {}, current: null, workoutExerciseIds: [], routines: [] };

test('warm-up phrases', () => {
  for (const s of ['warm up', 'add warm up sets', 'give me a warm-up', 'lets warm up', 'opvarmning', 'jeg skal varme op']) assert.equal(parse(s, ctx).type, 'AddWarmup', s);
  for (const s of ['warm up done', 'next warm up', 'done with the warm-up', 'opvarmning færdig', 'næste opvarmning']) assert.equal(parse(s, ctx).type, 'WarmupDone', s);
  assert.equal(parse('done', ctx).type, 'Finish');
});

test('warm-up commands', () => {
  const bench = catalog.search('bench press')[0].id;
  let w = W.createWorkout({ exercises: [{ exerciseId: bench, sets: [{ kg: 100, reps: 5 }] }] });
  const snap = () => ({ active: w, history: [], prs: {}, routines: [], undoCount: 0, settings: { unit: 'kg', restSec: 90, spoken: 'minimal', restByEx: {}, autoAdvance: true }, catalog, now: Date.now() });
  const t = translator('en');
  const add = resolve({ type: 'AddWarmup', heard: 'warm up' }, snap(), t, 'en');
  assert.equal(add.kind, 'auto');
  w = add.run.fn(w, Date.now());
  assert.ok(w.exercises[0].sets.filter(s => s.type === 'warmup').length >= 3);
  const done = resolve({ type: 'WarmupDone', heard: 'warm up done' }, snap(), t, 'en');
  assert.match(done.say, /Next warm-up/);
  w = done.run.fn(w, Date.now());
  // "50 for 5" matches the next warm-up
  const as = resolve({ ...parse('50 for 5', ctx), heard: '50 for 5' }, snap(), t, 'en');
  assert.equal(as.title, t('warmup.done'));
});
