import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, platesToKg, relPhrase } from '../js/parser.js';
import { resolve } from '../js/commands.js';
import { createCatalog } from '../js/catalog.js';
import { starterRoutines } from '../js/routines.js';
import { translator } from '../js/i18n.js';
import * as W from '../js/workout.js';

const catalog = createCatalog();

// drive parse → resolve → run against a workout, like the app does
function session(template) {
  const st = { w: W.createWorkout(template, 1_000_000), now: 1_000_000 };
  const ctx = () => {
    const ex = st.w.exercises[st.w.current];
    const li = W.lastDoneIndex(ex), pi = W.firstPlannedIndex(ex);
    return { lang: 'auto', unit: 'kg', catalog, usage: {}, routines: [], workoutExerciseIds: st.w.exercises.map(e => e.exerciseId),
      current: { exerciseId: ex.exerciseId, lastSet: li >= 0 ? ex.sets[li] : null, planned: pi >= 0 ? ex.sets[pi] : null, shown: W.suggestNext(ex, null, 20) }, restRunning: false };
  };
  const say = (text, advance = 5_000) => {
    st.now += advance;
    const intent = parse(text, ctx());
    const cmd = resolve(intent, { active: st.w, history: [], prs: [], routines: starterRoutines(), undoCount: 0, settings: { unit: 'kg', restSec: 90, spoken: 'minimal' }, catalog, now: st.now }, translator(intent.lang), intent.lang);
    if (cmd.run?.op === 'update' && (cmd.kind === 'auto' || cmd.kind === 'confirm')) st.w = cmd.run.fn(st.w, st.now);
    return { intent, cmd };
  };
  const done = () => st.w.exercises[st.w.current].sets.filter(s => s.done).map(s => [s.kg, s.reps]);
  return { say, done, st };
}
const plan = (id, kg, reps, n = 3) => ({ exercises: [{ exerciseId: id, sets: Array.from({ length: n }, () => ({ kg, reps })) }] });

test('"I got 9 reps this time" logs the planned weight with 9 reps', () => {
  const s = session(plan('t-bar-row', 80, 8));
  const { cmd } = s.say('I got 9 reps this time.');
  assert.equal(cmd.kind, 'auto');
  assert.deepEqual(s.done(), [[80, 9]]);
});

test('plan-relative sets: "2 kg more", "one rep more", "as planned"', () => {
  const s = session(plan('bench-press', 80, 8, 4));
  s.say('I hit 2 kg more');
  assert.deepEqual(s.done(), [[82, 8]]);
  s.say('as planned', 150_000);
  assert.deepEqual(s.done(), [[82, 8], [80, 8]]);
  // long after the last set, "one rep more" is a new set: planned + 1
  s.say('one rep more', 150_000);
  assert.deepEqual(s.done(), [[82, 8], [80, 8], [80, 9]]);
  // right after, it corrects that set instead
  s.say('one more rep', 8_000);
  assert.deepEqual(s.done(), [[82, 8], [80, 8], [80, 10]]);
});

test('combined: "I hit 10 reps with 2 kilos more", and Danish', () => {
  const s = session(plan('bench-press', 80, 8));
  s.say('I hit 10 reps with 2 kilos more');
  assert.deepEqual(s.done(), [[82, 10]]);
  s.say('jeg tog 9 gentagelser', 120_000);
  assert.deepEqual(s.done(), [[82, 10], [80, 9]]);
  const { cmd } = s.say('2 kilo mere', 200_000);
  assert.match(cmd.sub, /\+2 kg/);
  assert.deepEqual(s.done().at(-1), [82, 8]);
});

test('plates: one-end loaded vs barbell', () => {
  const ex = id => catalog.get(id);
  assert.equal(platesToKg({ n: 4, size: null, perSide: false }, ex('t-bar-row'), 't-bar-row'), 80);
  assert.equal(platesToKg({ n: 2, size: null, perSide: false }, ex('bench-press'), 'bench-press'), 100);
  assert.equal(platesToKg({ n: 1, size: 10, perSide: true }, ex('back-squat'), 'back-squat'), 40);
  const s = session(plan('t-bar-row', null, 8));
  s.say('I got 9 reps on the T-bar row. 4 plates.');
  assert.deepEqual(s.done(), [[80, 9]]);
});

test('relative phrase pieces', () => {
  assert.deepEqual(relPhrase('9 reps with 2 kg more'), { reps: 9, kgDelta: 2, relative: true });
  assert.deepEqual(relPhrase('2 reps short'), { repsDelta: -2, relative: true });
  assert.equal(relPhrase('bench press'), null);
  assert.equal(relPhrase('9 reps and 10 reps'), null);
});

test('"did it" is the planned set, not an exercise; sleep stays a check-in', () => {
  const ctx = { lang: 'auto', unit: 'kg', catalog, usage: {}, routines: [], workoutExerciseIds: [], current: null, restRunning: false };
  assert.equal(parse('did it', ctx).type, 'LogRel');
  assert.equal(parse('i got 5 hours of sleep', ctx).type, 'CheckIn');
  assert.equal(parse('got it', ctx).type === 'LogRel', false, '"got it" is not a set (could be a reply to the app)');
});

test('a set by its number: "set one is done, but I only did nine reps instead of ten"', () => {
  const s = session(plan('bench-press', 80, 10, 3));
  s.say('Set one is done, but I only did nine reps instead of ten.');
  assert.deepEqual(s.done(), [[80, 9]]);
  s.say('set 2 done', 120_000);
  assert.deepEqual(s.done(), [[80, 9], [80, 10]]);
  s.say('first set was 8 reps', 20_000); // already done: corrected
  assert.deepEqual(s.done(), [[80, 8], [80, 10]]);
  s.say('sæt 3 er færdigt men kun ni gentagelser', 120_000);
  assert.deepEqual(s.done(), [[80, 8], [80, 10], [80, 9]]);
});

test('"set" as a verb or in "3 sets" is not a set number', () => {
  const s = session(plan('bench-press', 80, 10, 3));
  assert.notEqual(s.say('set my calories to 2400').intent.type, 'LogSetNo');
  assert.notEqual(s.say('3 sets of 8 at 80').intent.type, 'LogSetNo');
});
