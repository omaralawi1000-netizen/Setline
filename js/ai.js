// Gemini: model choice, JSON command fallback, streamed Coach answers.
// Only the text needed for a request leaves the phone.
import { INTENTS, matchExercise } from './parser.js';
import { LIMITS } from './workout.js';
import { normalize } from './catalog.js';
import { listModels } from './tts.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
// Google's rolling aliases always point at the newest Flash / Flash-Lite: a safe last resort.
export const FALLBACK_MODELS = { command: 'gemini-flash-lite-latest', coach: 'gemini-flash-latest' };

// ---------- model choice (pure) ----------

const id = m => String(m?.name || m).replace(/^models\//, '');
const canGenerate = m => typeof m === 'string' || !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent');
const version = s => Number((s.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
// newest generation wins; within a generation stable beats preview; experimental and aliases last
const tier = s => (/(exp|experimental)/.test(s) ? 3 : /latest/.test(s) ? 2 : /preview/.test(s) ? 1 : 0);
const SPECIAL = /(tts|image|live|audio|embedding|aqa|vision|thinking|learnlm|robotics|computer|nano|gemma|imagen|veo)/;

export function rankModels(list) {
  return [...list].sort((a, b) => (tier(a) >= 2) - (tier(b) >= 2) || version(b) - version(a) || tier(a) - tier(b) || a.length - b.length);
}
const newest = list => rankModels(list)[0] || null;
const second = list => rankModels(list)[1] || null;

// {command: newest stable Flash-Lite text model, coach: newest stable Flash (not lite) text model}
export function pickTextModels(models) {
  const ids = models.filter(canGenerate).map(id).filter(s => /^gemini/.test(s) && !SPECIAL.test(s));
  const lite = ids.filter(s => /flash-lite/.test(s)), flash = ids.filter(s => /flash/.test(s) && !/lite/.test(s));
  return { command: newest(lite), coach: newest(flash), commandAlt: second(lite), coachAlt: second(flash) };
}

// ---------- SSE (pure) ----------

// Feed text chunks; returns {events: [parsed JSON], rest} with the unfinished tail kept.
export function parseSSE(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop();
  for (const block of blocks) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') continue;
    try { events.push(JSON.parse(data)); } catch { /* skip a bad frame */ }
  }
  return { events, rest };
}

export const textOf = res => (res?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');

// ---------- requests ----------

export class AiError extends Error {
  constructor(code, status = 0, extra = {}) { super(code); this.code = code; this.status = status; Object.assign(this, extra); }
}

const model = path => decodeURIComponent(/models\/([^:/?]+)/.exec(path)?.[1] || '');

// 429/503 → what kind of limit it is. A daily free-tier quota → 'quota' (that model is done until the
// reset); a per-minute limit or an overloaded model → 'busy', with Google's suggested wait if it gave one.
export function limitError(status, body, modelId = '') {
  let j = null;
  try { j = JSON.parse(body); } catch {}
  const details = j?.error?.details || [];
  const quotaIds = details.flatMap(d => d.violations || []).map(v => `${v.quotaId || ''} ${v.quotaMetric || ''}`).join(' ');
  const delay = details.find(d => /RetryInfo/.test(d['@type'] || ''))?.retryDelay;
  const retryMs = delay ? Math.round(parseFloat(delay) * 1000) : null;
  if (status === 429 && /PerDay/i.test(quotaIds)) return new AiError('quota', 429, { model: modelId });
  return new AiError('busy', status, { model: modelId, retryMs: Number.isFinite(retryMs) ? retryMs : null });
}

// Models whose daily quota ran out: skipped until the quota resets (midnight Pacific time).
const EXHAUSTED = 'setline.exhausted';
export function nextQuotaReset(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const sinceMidnight = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000;
  return now - sinceMidnight + 86_400_000;
}
const readEx = (st = globalThis.localStorage) => { try { return JSON.parse(st?.getItem(EXHAUSTED) || '{}') || {}; } catch { return {}; } };
export function markExhausted(modelId, now = Date.now(), st = globalThis.localStorage) {
  if (!modelId) return;
  const ex = readEx(st);
  ex[modelId] = nextQuotaReset(now);
  try { st?.setItem(EXHAUSTED, JSON.stringify(ex)); } catch {}
}
export const isExhausted = (modelId, now = Date.now(), st = globalThis.localStorage) => (readEx(st)[modelId] || 0) > now;

async function post(path, key, body, { timeout = 0, signal } = {}) {
  if (navigator.onLine === false) throw new AiError('offline');
  const ctl = new AbortController();
  const timer = timeout ? setTimeout(() => ctl.abort(), timeout) : 0;
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  let res;
  try {
    res = await fetch(`${API}/${path}`, { method: 'POST', signal: ctl.signal, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    clearTimeout(timer);
    throw new AiError(e?.name === 'AbortError' ? (signal?.aborted ? 'aborted' : 'timeout') : 'network');
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) { clearTimeout(timer); throw new AiError(res.status === 400 ? 'badrequest' : 'badkey', res.status); }
  if (res.status === 404) { clearTimeout(timer); throw new AiError('nomodel', 404); }
  if (res.status === 429 || res.status === 503) { clearTimeout(timer); throw limitError(res.status, await res.text().catch(() => ''), model(path)); }
  if (!res.ok) { clearTimeout(timer); throw new AiError('failed', res.status); }
  return { res, done: () => clearTimeout(timer) };
}

// ---------- command fallback ----------

const QUERY = ['last', 'pr', 'setsLeft', 'restLeft', 'suggest'];
const AI_TYPES = INTENTS.filter(t => !['Ask', 'Unknown', 'LogMeal', 'CheckIn', 'LogRel', 'SetGoal'].includes(t)).concat('question');

export const COMMAND_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: AI_TYPES },
    exercise: { type: 'STRING', nullable: true, description: 'exercise name from the catalog, if one was named' },
    routine: { type: 'STRING', nullable: true },
    kg: { type: 'NUMBER', nullable: true, description: 'weight in kg' },
    reps: { type: 'INTEGER', nullable: true },
    count: { type: 'INTEGER', nullable: true, description: 'number of identical sets' },
    kgDelta: { type: 'NUMBER', nullable: true },
    repsDelta: { type: 'INTEGER', nullable: true },
    sec: { type: 'INTEGER', nullable: true, description: 'seconds, for rest' },
    what: { type: 'STRING', nullable: true, enum: QUERY },
    cardioType: { type: 'STRING', nullable: true, enum: ['run', 'walk', 'hike', 'bike', 'spin', 'row', 'swim', 'elliptical', 'stairs', 'hiit', 'other'] },
    durationSec: { type: 'INTEGER', nullable: true },
    distanceKm: { type: 'NUMBER', nullable: true },
    zone: { type: 'INTEGER', nullable: true, description: 'effort zone 1-5' },
    grams: { type: 'INTEGER', nullable: true, description: 'protein grams' },
    sets: { type: 'ARRAY', nullable: true, description: 'for LogSets: each set in order', items: { type: 'OBJECT', properties: { kg: { type: 'NUMBER' }, reps: { type: 'INTEGER' } }, required: ['kg', 'reps'] } }
  },
  required: ['type']
};

export function commandPrompt(text, ctx) {
  const cur = ctx.current;
  const lines = [
    `Units: ${ctx.unit}. Convert pounds to kg if the user says pounds.`,
    ctx.hasWorkout ? `Workout running. Current exercise: ${cur ? ctx.catalog.name(cur.exerciseId, 'en') : 'none'}.` : 'No workout running.',
    cur?.lastSet ? `Last logged set: ${cur.lastSet.kg} kg x ${cur.lastSet.reps}.` : 'No set logged on this exercise yet.',
    cur?.planned ? `Next planned set: ${cur.planned.kg ?? '?'} kg x ${cur.planned.reps}.` : '',
    ctx.restRunning ? 'A rest timer is running.' : '',
    `Routines: ${(ctx.routines || []).map(r => r.name).join(', ') || 'none'}.`,
    `Exercise catalog: ${ctx.catalog.all.map(e => e.en).join(', ')}.`,
    '',
    `Command (English or Danish, from speech recognition, may be misheard): "${text}"`
  ];
  return lines.filter(l => l !== '').join('\n');
}

const SYSTEM_COMMAND = 'You map a gym voice command to one intent for a workout logger. ' +
  'Use only the given types and fields. Fill kg and reps from context only when the user clearly refers to it ("same weight", "10 reps"). ' +
  'Never invent numbers. If it is a question or conversation rather than a command, return type "question". ' +
  'Use LogSets with a sets array when several sets with different reps or weights are described in one go. ' +
  'LogCardio logs finished cardio (cardioType, durationSec, optional distanceKm and zone); StartCardio starts a live cardio timer. ' +
  'LogBodyweight uses kg; LogProtein uses grams. Query.what "suggest" asks what weight to use next. ' +
  'AdjustLast changes the last logged set by kgDelta or repsDelta. EditLast sets its kg or reps. Query.what is one of last, pr, setsLeft, restLeft.';

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// Strictly validate the model's JSON into a parser-shaped intent. Returns null if anything is off.
export function validateAI(raw, ctx) {
  if (!raw || typeof raw !== 'object' || !AI_TYPES.includes(raw.type)) return null;
  const t = raw.type;
  if (t === 'question') return { type: 'question' };
  const out = { type: t };
  const exercise = () => {
    if (raw.exercise == null || raw.exercise === '') return undefined;
    if (typeof raw.exercise !== 'string') return null;
    const exact = ctx.catalog.findExact(raw.exercise);
    if (exact) return exact.id;
    const m = matchExercise(raw.exercise, ctx);
    return m?.exerciseId || null;
  };
  const setList = Array.isArray(raw.sets) && raw.sets.length ? raw.sets : null;
  if ((t === 'LogSets' || t === 'LogSet') && setList) {
    if (setList.length > 10) return null;
    const sets = setList.map(x => ({ kg: num(x?.kg, 0, LIMITS.kgMax), reps: int(x?.reps, 1, LIMITS.repsMax) }));
    if (sets.some(x => x.kg == null || x.reps == null)) return null;
    const ex = exercise();
    if (ex === null) return null;
    return { type: 'LogSets', sets, exerciseId: ex ?? null };
  }
  switch (t) {
    case 'LogSets': return null; // needs a sets array
    case 'LogSet': {
      const kg = num(raw.kg, 0, LIMITS.kgMax), reps = int(raw.reps, 1, LIMITS.repsMax);
      if (kg == null || reps == null) return null;
      const ex = exercise();
      if (ex === null) return null;
      return { type: t, kg, reps, count: int(raw.count, 1, 10) ?? 1, exerciseId: ex ?? null };
    }
    case 'RepeatLast': return { type: t, count: int(raw.count, 1, 10) ?? 1 };
    case 'AdjustLast': {
      const kgDelta = num(raw.kgDelta, -500, 500), repsDelta = int(raw.repsDelta, -100, 100);
      if (!kgDelta && !repsDelta) return null;
      return { type: t, ...(kgDelta ? { kgDelta } : {}), ...(repsDelta ? { repsDelta } : {}) };
    }
    case 'EditLast': {
      const kg = num(raw.kg, 0, LIMITS.kgMax), reps = int(raw.reps, 1, LIMITS.repsMax);
      if (kg == null && reps == null) return null;
      return { type: t, kg, reps };
    }
    case 'AddExercise':
    case 'SwapExercise': {
      const ex = exercise();
      return ex ? { type: t, exerciseId: ex } : null;
    }
    case 'StartRoutine': {
      const want = normalize(raw.routine || '');
      const r = (ctx.routines || []).find(r => [r.name, ...Object.values(r.names || {})].some(n => normalize(n) === want));
      return r ? { type: t, routineId: r.id } : null;
    }
    case 'StartRest': return { type: t, sec: int(raw.sec, 10, 900) };
    case 'LogCardio': {
      const durationSec = int(raw.durationSec, 60, 12 * 3600);
      const cardioType = COMMAND_SCHEMA.properties.cardioType.enum.includes(raw.cardioType) ? raw.cardioType : null;
      if (!durationSec || !cardioType) return null;
      const distanceKm = raw.distanceKm == null ? null : num(raw.distanceKm, 0.05, 400);
      if (raw.distanceKm != null && distanceKm == null) return null;
      return { type: t, cardioType, durationSec, distanceKm, zone: int(raw.zone, 1, 5) };
    }
    case 'StartCardio': return COMMAND_SCHEMA.properties.cardioType.enum.includes(raw.cardioType) ? { type: t, cardioType: raw.cardioType } : null;
    case 'LogBodyweight': { const kg = num(raw.kg, 20, 400); return kg ? { type: t, kg } : null; }
    case 'LogProtein': { const grams = int(raw.grams, 1, 300); return grams ? { type: t, grams } : null; }
    case 'AdjustRest': { const sec = int(raw.sec, -600, 600); return sec ? { type: t, sec } : null; }
    case 'Query': {
      if (!QUERY.includes(raw.what)) return null;
      const ex = exercise();
      if (ex === null) return null;
      return { type: t, what: raw.what, exerciseId: ex ?? null };
    }
    default: return out; // no-field intents
  }
}

// Ask Flash-Lite what the transcript meant. Resolves to an intent, {type:'question'}, or throws AiError.
export async function aiCommand(text, ctx, { key, model, timeout = 4000, signal } = {}) {
  const { res, done } = await post(`models/${encodeURIComponent(model)}:generateContent`, key, {
    systemInstruction: { parts: [{ text: SYSTEM_COMMAND }] },
    contents: [{ role: 'user', parts: [{ text: commandPrompt(text, ctx) }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: COMMAND_SCHEMA, maxOutputTokens: 200 }
  }, { timeout, signal });
  try {
    const data = await res.json();
    let raw = null;
    try { raw = JSON.parse(textOf(data)); } catch { raw = null; }
    const intent = validateAI(raw, ctx);
    if (!intent) throw new AiError('invalid');
    return intent;
  } finally { done(); }
}

// ---------- streaming chat ----------

// Stream an answer; onText(fullSoFar) per chunk. Resolves to the final text.
// A stream that goes quiet for idleTimeout is cut off: with some text it counts as the answer,
// with none it's a timeout. An empty answer (all tokens spent thinking, or blocked) is 'empty', worth a retry.
export async function streamChat({ key, model, system, contents, onText, signal, firstByteTimeout = 12000, idleTimeout = 20000 }) {
  const { res, done } = await post(`models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, key, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 2048 }
  }, { timeout: firstByteTimeout, signal });
  done(); // headers arrived; the stream can take its time, but not forever between chunks
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  const read = () => new Promise((resolve, reject) => {
    let timer = 0;
    const off = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { off(); reader.cancel().catch(() => {}); reject(new AiError('aborted')); };
    if (signal?.aborted) return onAbort();
    timer = setTimeout(() => { off(); reader.cancel().catch(() => {}); reject(new AiError('timeout')); }, idleTimeout);
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then(r => { off(); resolve(r); }, () => { off(); reject(new AiError(signal?.aborted ? 'aborted' : 'network')); });
  });
  for (;;) {
    let r;
    try { r = await read(); } catch (e) { if (e.code === 'timeout' && full.trim()) break; throw e; }
    const { value, done: end } = r;
    if (end) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = parseSSE(buf);
    buf = rest;
    for (const ev of events) {
      const piece = textOf(ev);
      if (piece) { full += piece; onText?.(full); }
    }
  }
  const tail = parseSSE(buf + '\n\n');
  for (const ev of tail.events) { const piece = textOf(ev); if (piece) { full += piece; onText?.(full); } }
  if (!full.trim()) throw new AiError('empty');
  return full.trim();
}

// Pick command and coach models from the key's model list. Returns settings patch or null.
export async function listModelsText(key) {
  const r = await listModels(key);
  if (r.status !== 'ok') return null;
  const p = pickTextModels(r.models);
  return { cmdModel: p.command || '', coachModel: p.coach || '', cmdAlt: p.commandAlt || '', coachAlt: p.coachAlt || '' };
}

// Errors worth trying another model for: overloaded, rate limited, gone, server trouble.
export const retryable = e => e instanceof AiError && (e.code === 'busy' || e.code === 'quota' || e.code === 'nomodel' || e.code === 'empty' || (e.code === 'failed' && e.status >= 500));
// Run fn(model) with the chosen model, then the runner-ups. Models out of daily quota are skipped (and
// remembered); a per-minute limit waits Google's suggested delay once; with rounds > 1 the list is tried
// again after a pause when everything was busy.
export async function withFallback(models, fn, { rounds = 1, wait = 1500, maxWait = 20000, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const all = [...new Set(models.filter(Boolean))];
  let list = all.filter(m => !isExhausted(m, now()));
  if (!list.length) throw new AiError('quota', 429, { resetAt: nextQuotaReset(now()) });
  let last, waited = false;
  for (let round = 0; round < rounds; round++) {
    if (round) await sleep(wait * round);
    for (const m of list) {
      try { return await fn(m); } catch (e) {
        last = e;
        if (!retryable(e)) throw e;
        if (e.code === 'quota') markExhausted(m, now());
        else if (e.code === 'busy' && e.retryMs && e.retryMs <= maxWait && !waited && m === list[list.length - 1]) {
          waited = true; // the last option said "try again in N s": wait for it once
          await sleep(e.retryMs);
          try { return await fn(m); } catch (e2) { last = e2; if (!retryable(e2)) throw e2; }
        }
      }
    }
    list = list.filter(m => !isExhausted(m, now()));
    if (!list.length) throw new AiError('quota', 429, { resetAt: nextQuotaReset(now()) });
    if (last?.code !== 'busy' && last?.code !== 'empty' && last?.code !== 'quota') break;
  }
  throw last;
}

// Meal estimate from a photo (base64 JPEG) and/or a description. Resolves to the raw JSON answer.
export async function aiMeal({ key, model, image = null, prompt, schema, signal, timeout = 25000 }) {
  const parts = [...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []), { text: prompt }];
  const { res, done } = await post(`models/${encodeURIComponent(model)}:generateContent`, key, {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 2048 }
  }, { timeout, signal });
  try {
    const data = await res.json();
    try { return JSON.parse(textOf(data)); } catch { throw new AiError('invalid'); }
  } finally { done(); }
}

// Structured plan from the Coach model (JSON schema output).
export async function aiPlan({ key, model, system, prompt, schema, signal }) {
  const { res, done } = await post(`models/${encodeURIComponent(model)}:generateContent`, key, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 8192 }
  }, { timeout: 25000, signal });
  try {
    const data = await res.json();
    try { return JSON.parse(textOf(data)); } catch { throw new AiError('invalid'); }
  } finally { done(); }
}
