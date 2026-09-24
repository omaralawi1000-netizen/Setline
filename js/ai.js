// Gemini: model choice, JSON command fallback, streamed Coach answers.
// Only the text needed for a request leaves the phone.
import { INTENTS, matchExercise } from './parser.js';
import { LIMITS } from './workout.js';
import { normalize } from './catalog.js';
import { listModels } from './tts.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const FALLBACK_MODELS = { command: 'gemini-2.5-flash-lite', coach: 'gemini-2.5-flash' };

// ---------- model choice (pure) ----------

const id = m => String(m?.name || m).replace(/^models\//, '');
const canGenerate = m => typeof m === 'string' || !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent');
const version = s => Number((s.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
const unstable = s => /(preview|exp|experimental|latest)/.test(s);
const SPECIAL = /(tts|image|live|audio|embedding|aqa|vision|thinking|learnlm|robotics|computer|nano|gemma|imagen|veo)/;

function newest(list) {
  return [...list].sort((a, b) => unstable(a) - unstable(b) || version(b) - version(a) || a.length - b.length)[0] || null;
}

// {command: newest stable Flash-Lite text model, coach: newest stable Flash (not lite) text model}
export function pickTextModels(models) {
  const ids = models.filter(canGenerate).map(id).filter(s => /^gemini/.test(s) && !SPECIAL.test(s));
  return {
    command: newest(ids.filter(s => /flash-lite/.test(s))),
    coach: newest(ids.filter(s => /flash/.test(s) && !/lite/.test(s)))
  };
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
  constructor(code, status = 0) { super(code); this.code = code; this.status = status; }
}

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
  if (res.status === 429) { clearTimeout(timer); throw new AiError('busy', 429); }
  if (!res.ok) { clearTimeout(timer); throw new AiError('failed', res.status); }
  return { res, done: () => clearTimeout(timer) };
}

// ---------- command fallback ----------

const QUERY = ['last', 'pr', 'setsLeft', 'restLeft'];
const AI_TYPES = INTENTS.filter(t => !['Ask', 'Unknown'].includes(t)).concat('question');

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
    what: { type: 'STRING', nullable: true, enum: QUERY }
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
  switch (t) {
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
export async function streamChat({ key, model, system, contents, onText, signal, firstByteTimeout = 12000 }) {
  const { res, done } = await post(`models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, key, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 900 }
  }, { timeout: firstByteTimeout, signal });
  done(); // headers arrived; the stream can take its time
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { value, done: end } = await reader.read();
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
  return full.trim();
}

// Pick command and coach models from the key's model list. Returns settings patch or null.
export async function listModelsText(key) {
  const r = await listModels(key);
  if (r.status !== 'ok') return null;
  const p = pickTextModels(r.models);
  return { cmdModel: p.command || '', coachModel: p.coach || '' };
}
