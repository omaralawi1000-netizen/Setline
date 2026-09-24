import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { resolve } from '../js/commands.js';
import { createCatalog } from '../js/catalog.js';
import { starterRoutines } from '../js/routines.js';
import { translator } from '../js/i18n.js';
import * as W from '../js/workout.js';
import { applyWorkout } from '../js/pr.js';

const catalog = createCatalog();

// A tiny in-memory stand-in for the store, driving parse → resolve → run.
function session({ history = [], prs = [], spoken = 'full' } = {}) {
  const st = { active: null, history, prs, undo: [], now: 1_700_000_000_000 };
  const settings = { unit: 'kg', restSec: 90, spoken };
  const ctx = () => {
    const w = st.active;
    const ex = w?.exercises[w.current];
    const li = ex ? W.lastDoneIndex(ex) : -1;
    const pi = ex ? W.firstPlannedIndex(ex) : -1;
    return {
      lang: 'auto', unit: 'kg', catalog, usage: {}, routines: starterRoutines(),
      workoutExerciseIds: w ? w.exercises.map(e => e.exerciseId) : [],
      current: ex ? { exerciseId: ex.exerciseId, lastSet: li >= 0 ? ex.sets[li] : null, planned: pi >= 0 ? ex.sets[pi] : null } : null,
      restRunning: !!(w && W.restRemaining(w.rest, st.now) > 0)
    };
  };
  function run(cmd) {
    const r = cmd.run;
    if (!r) return;
    if (r.op === 'update') { st.undo.push(st.active); st.active = r.fn(st.active, st.now); }
    else if (r.op === 'start') { st.active = W.createWorkout(r.template, st.now); st.undo = []; }
    else if (r.op === 'undo') st.active = st.undo.pop();
    else if (r.op === 'finish') { const done = W.finishWorkout(st.active, st.now); const a = applyWorkout(st.prs, done); st.prs = a.records; done.prs = a.prs; st.history.unshift(done); st.active = null; }
    else if (r.op === 'discard') st.active = null;
  }
  function say(text, { confirm = false } = {}) {
    const intent = parse(text, ctx());
    const lang = intent.lang;
    const cmd = resolve(intent, { ...st, routines: starterRoutines(), undoCount: st.undo.length, settings, catalog }, translator(lang), lang);
    if (cmd.kind === 'auto' || (cmd.kind === 'confirm' && confirm)) run(cmd);
    st.now += 5_000;
    return cmd;
  }
  return { st, say, run };
}

const ex = (s, i) => s.st.active.exercises[i ?? s.st.active.current];
const sets = (s, i) => ex(s, i).sets.filter(x => x.done).map(x => [x.kg, x.reps]);

test('definition of done: hands-free push day', () => {
  const s = session();
  assert.equal(s.say('Start push day').kind, 'auto');
  assert.equal(s.st.active.routineId, 'push-day');

  let c = s.say('80 kilo 8 gentagelser');
  assert.equal(c.kind, 'auto');
  assert.equal(c.title, 'Bænkpres');
  assert.match(c.say, /80 kilo, 8 gentagelser\. Sæt 1\. Pause 90 sekunder\./);
  assert.deepEqual(sets(s), [[80, 8]]);
  assert.ok(s.st.active.rest, 'rest started');

  s.say('samme igen');
  assert.deepEqual(sets(s), [[80, 8], [80, 8]]);

  c = s.say('læg 2,5 til');
  assert.deepEqual(sets(s), [[80, 8], [82.5, 8]], 'adjusts the last set');
  assert.match(c.sub, /Sæt 2, var 80 kg × 8/);

  s.say('one more rep');
  assert.deepEqual(sets(s), [[80, 8], [82.5, 9]]);

  c = s.say('skip rest');
  assert.equal(c.kind, 'auto');
  assert.equal(s.st.active.rest, null);

  c = s.say('next exercise');
  assert.equal(c.value, 'Overhead press');
  assert.equal(s.st.active.current, 1);

  c = s.say('what did I do last time?');
  assert.equal(c.kind, 'info');
  assert.equal(c.title, 'No earlier Overhead press sessions', 'answers from real data: nothing yet');
  assert.equal(c.run, null);

  c = s.say('finish workout');
  assert.equal(c.kind, 'confirm', 'finish needs explicit confirmation');
  assert.ok(s.st.active, 'not finished without confirm');
  s.say('finish workout', { confirm: true });
  assert.equal(s.st.active, null);
  const done = s.st.history[0];
  assert.equal(W.volume(done), 80 * 8 + 82.5 * 9);
  assert.equal(W.doneSetCount(done), 2);
});

test('second session: last time answers with real data and PRs are found', () => {
  const s = session();
  s.say('start push day');
  s.say('80 kg for 8');
  s.say('same again');
  s.say('finish', { confirm: true });

  s.say('start push day');
  const plannedKg = ex(s, 0).sets.map(x => x.kg);
  assert.deepEqual(plannedKg, [80, 80, 80, 80], 'plan uses last session');
  let c = s.say('what did I do last time?');
  assert.equal(c.sub, '2 × 80 kg × 8');
  assert.match(c.say, /2 sets, 80 kilos for 8/);
  s.say('85 kg for 6');
  s.say('finish', { confirm: true });
  assert.ok(s.st.history[0].prs.some(p => p.kind === 'weight' && p.kg === 85));
  s.say('start push day');
  c = s.say('what is my pr on bench press');
  assert.equal(c.kind, 'info');
  assert.match(c.say, /Your best Bench press is/);
});

test('no workout running asks to start one, then logs', () => {
  const s = session();
  const c = s.say('80 for 8');
  assert.equal(c.kind, 'ask');
  assert.equal(c.choices.length, 2);
  assert.equal(c.choices[0].intent.type, 'StartRoutine');
  assert.equal(c.choices[0].intent.then.type, 'LogSet');
});

test('heavy weights need confirmation; invalid values are errors', () => {
  const s = session();
  s.say('start a new workout');
  s.say('add bench press');
  assert.equal(s.say('520 kg for 1').kind, 'confirm');
  assert.equal(s.say('2000 kg for 1').kind, 'error');
});

test('delete and discard always ask', () => {
  const s = session();
  s.say('start push day');
  s.say('80 for 8');
  assert.equal(s.say('delete last set').kind, 'confirm');
  assert.equal(sets(s).length, 1);
  assert.equal(s.say('discard workout').kind, 'confirm');
  assert.ok(s.st.active);
});

test('undo, swap, rest and queries', () => {
  const s = session({ spoken: 'minimal' });
  assert.equal(s.say('undo').kind, 'error', 'nothing to undo yet');
  s.say('start push day');
  let c = s.say('80 for 8');
  assert.equal(c.say, '80 for 8.');
  s.say('undo');
  assert.equal(sets(s).length, 0);
  s.say('swap to dumbbell bench press');
  assert.equal(ex(s).exerciseId, 'dumbbell-bench-press');
  assert.equal(ex(s).sets.length, 4, 'planned sets kept');
  s.say('30 for 10');
  c = s.say('add 30 seconds');
  assert.equal(c.kind, 'auto');
  assert.ok(W.restRemaining(s.st.active.rest, s.st.now) > 90);
  c = s.say('how many sets left');
  assert.match(c.title, /3 sets left on Dumbbell bench press/);
  c = s.say('hvor lang pause er der tilbage');
  assert.equal(c.kind, 'info');
  assert.match(c.title, /tilbage/);
  assert.equal(s.say('previous exercise').kind, 'error');
  assert.equal(s.say('the weather is nice').kind, 'error');
});

test('spoken off says nothing', () => {
  const s = session({ spoken: 'off' });
  s.say('start push day');
  assert.equal(s.say('80 for 8').say, '');
});
