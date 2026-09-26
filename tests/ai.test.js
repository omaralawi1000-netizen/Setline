import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTextModels, parseSSE, textOf, validateAI, commandPrompt, withFallback, AiError } from '../js/ai.js';
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
  const p = pickTextModels(models);
  assert.equal(p.command, 'gemini-3.1-flash-lite');
  assert.equal(p.commandAlt, 'gemini-2.5-flash-lite');
  assert.equal(p.coach, 'gemini-3.5-flash-preview', 'a newer generation beats an older stable one');
  assert.equal(p.coachAlt, 'gemini-3.1-flash');
  assert.equal(pickTextModels([]).coach, null);
  assert.equal(pickTextModels(['gemini-3.1-flash-preview', 'gemini-3.1-flash', 'gemini-flash-latest']).coach, 'gemini-3.1-flash', 'same generation: stable first, alias last');
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

test('fallback tries the runner-up on 503 but not on a bad key', async () => {
  const tried = [];
  const r = await withFallback(['a', 'b', 'c'], async m => { tried.push(m); if (m === 'a') throw new AiError('busy', 503); return m; });
  assert.equal(r, 'b');
  assert.deepEqual(tried, ['a', 'b']);
  await assert.rejects(withFallback(['a', 'b'], async () => { throw new AiError('badkey', 403); }), e => e.code === 'badkey');
  const seen = [];
  await assert.rejects(withFallback(['x', 'x', '', 'y'], async m => { seen.push(m); throw new AiError('nomodel', 404); }));
  assert.deepEqual(seen, ['x', 'y'], 'deduped, blanks skipped');
});

test('AI can log several different sets', () => {
  const r = validateAI({ type: 'LogSets', exercise: 'bench', sets: [{ kg: 100, reps: 9 }, { kg: 100, reps: 8 }, { kg: 100, reps: 8 }] }, ctx);
  assert.deepEqual(r, { type: 'LogSets', exerciseId: 'bench-press', sets: [{ kg: 100, reps: 9 }, { kg: 100, reps: 8 }, { kg: 100, reps: 8 }] });
  assert.equal(validateAI({ type: 'LogSets' }, ctx), null);
  assert.equal(validateAI({ type: 'LogSets', sets: [{ kg: 100, reps: 0 }] }, ctx), null);
  assert.equal(validateAI({ type: 'LogSet', sets: [{ kg: 60, reps: 10 }, { kg: 60, reps: 9 }] }, ctx).type, 'LogSets');
});

import { isPlanRequest, validatePlan, planToRoutines } from '../js/coach.js';
test('plan requests are recognised and validated against the catalog', () => {
  assert.ok(isPlanRequest('make me a 4-day upper/lower, 60 minutes, focus chest, dumbbells only'));
  assert.ok(isPlanRequest('lav en træningsplan med 3 dage'));
  assert.ok(!isPlanRequest("how's my bench progressing?"));
  assert.ok(isPlanRequest('I need a five-day plan.'));
  assert.ok(isPlanRequest('Make me a 6-day training plan for hypertrophy'));
  assert.ok(isPlanRequest('jeg vil gerne have et nyt program'));
  assert.ok(!isPlanRequest('what should I eat today?'));
  const p = validatePlan({ name: 'UL', perWeek: 4, summary: 'x', days: [
    { name: 'Upper A', exercises: [{ exercise: 'Dumbbell bench press', sets: 4, reps: 10 }, { exercise: 'Laser curls', sets: 3, reps: 10 }, { exercise: 'Dumbbell row', sets: 99, reps: 10 }] },
    { name: 'Lower A', exercises: [{ exercise: 'Goblet squat', sets: 3, reps: 12 }] }] }, catalog);
  assert.equal(p.days.length, 2);
  assert.deepEqual(p.days[0].exercises.map(e => e.exerciseId), ['dumbbell-bench-press', 'dumbbell-row'], 'unknown exercise dropped');
  assert.equal(p.days[0].exercises[1].sets, 6, 'sets clamped');
  const q = validatePlan({ name: 'PPL', days: [{ name: 'Empty', exercises: [{ exercise: 'Nope', sets: 3, reps: 3 }] },
    { name: 'Pull', exercises: [{ exercise: 'Lat pulldowns', sets: 3, reps: 10 }, { exercise: 'Barbell Bench Press', sets: 3, reps: 8 }] }] }, catalog);
  assert.equal(q.days.length, 1, 'a day with nothing usable is skipped');
  assert.deepEqual(q.days[0].exercises.map(e => e.exerciseId), ['lat-pulldown', 'bench-press'], 'close names are matched');
  assert.equal(validatePlan({ days: [{ name: 'x', exercises: [{ exercise: 'Nope', sets: 3, reps: 3 }] }] }, catalog), null);
  const rs = planToRoutines(p, 1);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].exercises[0].sets.length, 4);
  assert.equal(rs[0].exercises[0].sets[0].reps, 10);
});

test('withFallback goes round again after a pause when every model was busy', async () => {
  const tried = [], waits = [];
  let n = 0;
  const r = await withFallback(['a', 'b'], async m => { tried.push(m); if (++n <= 2) throw new AiError('busy', 503); return m; }, { rounds: 2, sleep: async ms => { waits.push(ms); } });
  assert.equal(r, 'a');
  assert.deepEqual(tried, ['a', 'b', 'a']);
  assert.equal(waits.length, 1);
  const seen = [];
  await assert.rejects(withFallback(['a'], async m => { seen.push(m); throw new AiError('nomodel', 404); }, { rounds: 3, sleep: async () => {} }));
  assert.deepEqual(seen, ['a'], 'a missing model is not retried');
});

// fake SSE responses for streamChat
const sse = (chunks, { stall = false } = {}) => async () => ({
  ok: true, status: 200,
  body: { getReader() { let i = 0; return { read: () => (i < chunks.length ? Promise.resolve({ value: new TextEncoder().encode(chunks[i++]), done: false }) : stall ? new Promise(() => {}) : Promise.resolve({ done: true })), cancel: async () => {} }; } }
});
const ev = text => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

test('streamChat: an empty answer is a retryable error', async () => {
  const { streamChat, retryable } = await import('../js/ai.js');
  globalThis.fetch = sse([`data: ${JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] })}\n\n`]);
  await assert.rejects(streamChat({ key: 'k', model: 'm', system: '', contents: [] }), e => e.code === 'empty' && retryable(e));
});

test('streamChat: a stalled stream ends with what arrived, or times out', async () => {
  const { streamChat } = await import('../js/ai.js');
  globalThis.fetch = sse([ev('Hello '), ev('there')], { stall: true });
  assert.equal(await streamChat({ key: 'k', model: 'm', system: '', contents: [], idleTimeout: 30 }), 'Hello there');
  globalThis.fetch = sse([], { stall: true });
  await assert.rejects(streamChat({ key: 'k', model: 'm', system: '', contents: [], idleTimeout: 30 }), e => e.code === 'timeout');
});

test('429/503 bodies: daily quota vs per-minute limit vs overload', async () => {
  const { limitError, nextQuotaReset } = await import('../js/ai.js');
  const daily = JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }] } });
  const minute = JSON.stringify({ error: { code: 429, details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }] } });
  assert.equal(limitError(429, daily, 'm').code, 'quota');
  const e = limitError(429, minute, 'm');
  assert.deepEqual([e.code, e.retryMs, e.model], ['busy', 34000, 'm']);
  assert.equal(limitError(503, 'not json').code, 'busy');
  // quota resets at midnight Pacific
  const now = Date.parse('2026-09-24T10:00:00Z'); // 03:00 PDT
  assert.equal(new Date(nextQuotaReset(now)).toISOString(), '2026-09-25T07:00:00.000Z');
});

test('withFallback: a model out of quota is skipped for the next; a short per-minute limit is waited out', async () => {
  let tried = [];
  const r = await withFallback(['a', 'b'], async m => { tried.push(m); if (m === 'a') throw new AiError('quota', 429); return m; });
  assert.equal(r, 'b');
  tried = []; const waits = [];
  let n = 0;
  const r2 = await withFallback(['x'], async m => { tried.push(m); if (n++ === 0) throw new AiError('busy', 429, { retryMs: 3000 }); return 'ok'; }, { sleep: async ms => { waits.push(ms); } });
  assert.equal(r2, 'ok');
  assert.deepEqual(waits, [3000]);
  await assert.rejects(withFallback(['y'], async () => { throw new AiError('quota', 429); }), e => e.code === 'quota' || e.code === 'busy');
});

import { planSchema, PLAN_SCHEMA } from '../js/coach.js';
test('the plan schema locks exercise names to the catalog', () => {
  const s = planSchema(catalog);
  const en = s.properties.days.items.properties.exercises.items.properties.exercise.enum;
  assert.ok(en.includes('Bench press') || en.some(n => /bench/i.test(n)));
  assert.equal(PLAN_SCHEMA.properties.days.items.properties.exercises.items.properties.exercise.enum, undefined, 'the base schema is untouched');
});

import { splitMemories, hideMemoryTail, addMemories } from '../js/coach.js';
test('the coach remembers what you tell it, and the line stays hidden', () => {
  const r = splitMemories('Noted, we will skip lunges.\nREMEMBER: hates lunges\nREMEMBER: wedding on 14 November.');
  assert.equal(r.text, 'Noted, we will skip lunges.');
  assert.deepEqual(r.facts, ['hates lunges', 'wedding on 14 November']);
  assert.equal(hideMemoryTail('Sure thing.\nREMEM'), 'Sure thing.');
  assert.equal(hideMemoryTail('Sure thing.\nREMEMBER: likes mornings'), 'Sure thing.');
  let m = addMemories([], ['hates lunges'], 1);
  m = addMemories(m, ['Hates lunges.', 'trains at 6 am'], 2);
  assert.deepEqual(m.map(x => x.text), ['hates lunges', 'trains at 6 am'], 'no duplicates');
});

import { pickLiveModel } from '../js/ai.js';
test('pickLiveModel: newest native-audio Live model, only ones that can hold a live session', () => {
  const m = (name, methods) => ({ name: 'models/' + name, supportedGenerationMethods: methods });
  const list = [m('gemini-2.5-flash', ['generateContent']), m('gemini-live-2.5-flash-preview', ['bidiGenerateContent']),
    m('gemini-2.5-flash-native-audio-preview-09-2025', ['bidiGenerateContent']), m('gemini-3.1-flash-native-audio', ['bidiGenerateContent', 'countTokens'])];
  assert.equal(pickLiveModel(list), 'gemini-3.1-flash-native-audio');
  assert.equal(pickLiveModel([m('gemini-live-2.5-flash-preview', ['bidiGenerateContent'])]), 'gemini-live-2.5-flash-preview');
  assert.equal(pickLiveModel([m('gemini-2.5-flash', ['generateContent'])]), null);
  assert.equal(pickLiveModel(['gemini-live-x']), null);
});
