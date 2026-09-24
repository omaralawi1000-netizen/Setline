import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTextModels, parseSSE, textOf, validateAI, commandPrompt } from '../js/ai.js';
import { buildContext, chatContents, isQuestion, formatAnswer, speakable, systemPrompt, MAX_CONTEXT_CHARS } from '../js/coach.js';
import { createCatalog } from '../js/catalog.js';
import { starterRoutines } from '../js/routines.js';
import { makeSet, createWorkout } from '../js/workout.js';
import { applyWorkout } from '../js/pr.js';
import { sanitize } from '../js/settings.js';

const catalog = createCatalog();
const ctx = { catalog, usage: {}, unit: 'kg', routines: starterRoutines(), workoutExerciseIds: ['bench-press'], current: { exerciseId: 'bench-press', lastSet: { kg: 80, reps: 8 }, planned: null }, hasWorkout: true };

test('text models: newest stable flash-lite for commands, flash for the coach', () => {
  const g = ['generateContent'];
  const models = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: g },
    { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: g },
    { name: 'models/gemini-3.1-flash', supportedGenerationMethods: g },
    { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: g },
    { name: 'models/gemini-3.5-flash-preview', supportedGenerationMethods: g },
    { name: 'models/gemini-3.1-flash-tts', supportedGenerationMethods: g },
    { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: g },
    { name: 'models/gemini-3.1-flash-live', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-3.1-pro', supportedGenerationMethods: g },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
  ];
  assert.deepEqual(pickTextModels(models), { command: 'gemini-3.1-flash-lite', coach: 'gemini-3.1-flash' });
  assert.deepEqual(pickTextModels([]), { command: null, coach: null });
  assert.equal(pickTextModels([{ name: 'models/gemini-3.5-flash-preview' }]).coach, 'gemini-3.5-flash-preview', 'preview only if nothing stable');
});

test('SSE parsing keeps the unfinished tail', () => {
  const a = parseSSE('data: {"candidates":[{"content":{"parts":[{"text":"Hej"}]}}]}\n\ndata: {"cand');
  assert.equal(a.events.length, 1);
  assert.equal(textOf(a.events[0]), 'Hej');
  assert.equal(a.rest, 'data: {"cand');
  const b = parseSSE(a.rest + 'idates":[{"content":{"parts":[{"text":" der"}]}}]}\r\n\r\n');
  assert.equal(textOf(b.events[0]), ' der');
  assert.equal(parseSSE('data: [DONE]\n\n').events.length, 0);
  assert.equal(parseSSE('data: {bad json\n\n').events.length, 0);
});

test('AI intents are validated strictly', () => {
  assert.deepEqual(validateAI({ type: 'LogSet', kg: 82.5, reps: 8 }, ctx), { type: 'LogSet', kg: 82.5, reps: 8, count: 1, exerciseId: null });
  assert.equal(validateAI({ type: 'LogSet', kg: 82.5, reps: 8, exercise: 'Bænkpres' }, ctx).exerciseId, 'bench-press');
  assert.equal(validateAI({ type: 'LogSet', kg: 82.5, reps: 8, exercise: 'Zumba' }, ctx), null, 'unknown exercise');
  assert.equal(validateAI({ type: 'LogSet', kg: 82.5 }, ctx), null, 'missing reps');
  assert.equal(validateAI({ type: 'LogSet', kg: 2000, reps: 5 }, ctx), null, 'out of range');
  assert.equal(validateAI({ type: 'LogSet', kg: 80, reps: 7.5 }, ctx), null, 'fractional reps');
  assert.equal(validateAI({ type: 'DropTable' }, ctx), null);
  assert.equal(validateAI(null, ctx), null);
  assert.deepEqual(validateAI({ type: 'question' }, ctx), { type: 'question' });
  assert.deepEqual(validateAI({ type: 'AdjustLast', kgDelta: 2.5 }, ctx), { type: 'AdjustLast', kgDelta: 2.5 });
  assert.equal(validateAI({ type: 'AdjustLast' }, ctx), null);
  assert.deepEqual(validateAI({ type: 'StartRoutine', routine: 'Push day' }, ctx), { type: 'StartRoutine', routineId: 'push-day' });
  assert.equal(validateAI({ type: 'StartRoutine', routine: 'Leg day' }, ctx), null);
  assert.deepEqual(validateAI({ type: 'Query', what: 'pr', exercise: 'deadlift' }, ctx), { type: 'Query', what: 'pr', exerciseId: 'deadlift' });
  assert.equal(validateAI({ type: 'Query', what: 'weather' }, ctx), null);
  assert.deepEqual(validateAI({ type: 'SkipRest' }, ctx), { type: 'SkipRest' });
  assert.equal(validateAI({ type: 'AdjustRest', sec: 0 }, ctx), null);
});

test('command prompt carries context and the transcript', () => {
  const p = commandPrompt('eighty kilo same again', ctx);
  assert.match(p, /Current exercise: Bench press/);
  assert.match(p, /Last logged set: 80 kg x 8/);
  assert.match(p, /"eighty kilo same again"/);
  assert.match(p, /Push day/);
});

test('questions go to the coach, commands do not', () => {
  for (const q of ["How's my bench progressing?", 'should I deload', 'hvordan går det med min bænkpres', 'Hvad skal jeg træne i morgen', 'what should I eat']) assert.ok(isQuestion(q), q);
  for (const c of ['80 kilo 8 gentagelser', 'same again', 'skip rest', 'bench press']) assert.ok(!isQuestion(c), c);
});

test('coach context is compact and uses real data only', () => {
  let records = [];
  const history = [];
  const day = 86_400_000, t0 = Date.now() - 20 * day;
  for (let k = 0; k < 6; k++) {
    const w = { id: 'w' + k, startedAt: t0 + k * 3 * day, finishedAt: t0 + k * 3 * day + 3000_000, exercises: [{ exerciseId: 'bench-press', sets: [makeSet({ kg: 70 + k * 2.5, reps: 8, done: true }), makeSet({ kg: 70 + k * 2.5, reps: 8, done: true })] }] };
    const r = applyWorkout(records, w); records = r.records; w.prs = r.prs; history.push(w);
  }
  const active = createWorkout({ name: 'Push day', exercises: [{ exerciseId: 'bench-press', sets: [{ reps: 8 }] }] });
  const c = buildContext({ active, history, routines: starterRoutines(), prs: records, bodyweight: [], catalog, settings: sanitize({}) });
  assert.match(c, /Bench press: best 82\.5x8/);
  assert.match(c, /e1RM trend 88\.7 > 91\.8 > 95 > 98\.2 > 101\.3 > 104\.5/);
  assert.match(c, /CURRENT WORKOUT/);
  assert.match(c, /BODYWEIGHT: no data logged/);
  assert.match(c, /WEEKLY VOLUME/);
  assert.ok(c.length < MAX_CONTEXT_CHARS);
  const empty = buildContext({ active: null, history: [], routines: [], prs: [], catalog, settings: sanitize({}) });
  assert.match(empty, /Logged workouts: 0\./);
  assert.doesNotMatch(empty, /EXERCISES/);
});

test('chat contents: last 12 turns, context on the newest question, user first', () => {
  const chat = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'm' + i }));
  const c = chatContents(chat, 'CTX', 'how is my bench?');
  assert.equal(c[0].role, 'user');
  assert.ok(c.length <= 13);
  assert.match(c[c.length - 1].parts[0].text, /Training data:\nCTX\n\nQuestion: how is my bench\?/);
  assert.match(systemPrompt('da'), /Danish/);
  assert.match(systemPrompt('en'), /three sentences or fewer/);
});

test('answers are formatted safely and spoken without markup', () => {
  assert.equal(formatAnswer('**Good** progress.\n- one\n- two'), '<p><b>Good</b> progress.</p><ul><li>one</li><li>two</li></ul>');
  assert.equal(formatAnswer('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.equal(speakable('**Good** progress.\n- one\n- two'), 'Good progress. one two');
});
