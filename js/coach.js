// Coach: the system prompt, a compact context summary built locally (not raw history),
// question detection, and a tiny safe formatter for answers. Pure.
import { volume, counts, elapsedSec } from './workout.js';
import { e1rm, bestsFrom } from './pr.js';
import { weekStart, weekStreak } from './stats.js';
import { cardioName, paceText, cardioMinutes } from './cardio.js';
import { bodyTrend, proteinTarget, dateKey } from './body.js';

export const MAX_CONTEXT_CHARS = 22000; // ~6k tokens
export const CHAT_TURNS = 12;

export function systemPrompt(lang) {
  return [
    'You are an experienced strength coach inside a workout logging app.',
    `Answer in ${lang === 'da' ? 'Danish' : 'English'} unless the user writes in the other language; then answer in theirs.`,
    'Answers are often spoken aloud: be voice-friendly, three sentences or fewer unless the user asks for detail. No tables, no headings.',
    'Use only the training data provided below. If the data needed is missing, say so plainly instead of guessing.',
    'Weights are in kg in the data; answer in the user\'s unit.',
    'For pain or injury, give general guidance only and suggest seeing a physiotherapist or doctor.'
  ].join(' ');
}

const r1 = n => Math.round(n * 10) / 10;
const d = (ts) => new Date(ts).toISOString().slice(0, 10);
const setsTxt = sets => {
  const out = [];
  for (const s of sets) {
    const last = out[out.length - 1];
    if (last && last.kg === s.kg && last.reps === s.reps) last.n++; else out.push({ kg: s.kg, reps: s.reps, n: 1 });
  }
  return out.map(g => `${g.n > 1 ? `${g.n}x ` : ''}${r1(g.kg)}x${g.reps}`).join(', ');
};

// Build the summary the Coach sees. snap = {active, history, routines, prs, bodyweight, catalog, settings, now}
export function buildContext(snap) {
  const { catalog, settings } = snap;
  const now = snap.now ?? Date.now();
  const name = id => catalog.name(id, 'en');
  const hist = [...snap.history].sort((a, b) => b.startedAt - a.startedAt);
  const out = [];
  out.push(`Today: ${d(now)}. User's unit: ${settings.unit}. Default rest ${settings.restSec} s. Weekly goal ${settings.weeklyGoal ?? 3} workouts.`);
  out.push(`Logged workouts: ${hist.length}${hist.length ? `, first ${d(hist[hist.length - 1].startedAt)}, latest ${d(hist[0].startedAt)}` : ''}.`);

  const w = snap.active;
  if (w) {
    out.push('', `CURRENT WORKOUT (${Math.round(elapsedSec(w, now) / 60)} min in, on ${w.exercises[w.current] ? name(w.exercises[w.current].exerciseId) : 'nothing'}):`);
    for (const ex of w.exercises) {
      const done = ex.sets.filter(s => s.done), left = ex.sets.filter(s => !s.done);
      out.push(`- ${name(ex.exerciseId)}: done ${done.length ? setsTxt(done) : 'none'}${left.length ? `; planned ${left.length} more` : ''}`);
    }
  } else out.push('', 'No workout running.');

  // per exercise, most recently trained first
  const seen = new Map();
  for (const x of hist) for (const ex of x.exercises) {
    if (!ex.sets.some(counts)) continue;
    if (!seen.has(ex.exerciseId)) seen.set(ex.exerciseId, []);
    seen.get(ex.exerciseId).push({ t: x.startedAt, sets: ex.sets.filter(counts) });
  }
  if (seen.size) {
    out.push('', 'EXERCISES (best e1RM, trend over up to 8 sessions, last 3 sessions):');
    for (const [id, sessions] of [...seen].slice(0, 30)) {
      const b = bestsFrom(snap.prs || [], id);
      const trend = sessions.slice(0, 8).map(s => Math.max(...s.sets.map(x => e1rm(x.kg, x.reps)))).reverse();
      const last3 = sessions.slice(0, 3).map(s => `${d(s.t)}: ${setsTxt(s.sets)}`).join(' | ');
      const best = b.e1rm ? `best ${r1(b.e1rm.kg)}x${b.e1rm.reps} (e1RM ${r1(b.e1rm.value)})` : 'no record yet';
      const heavy = b.weight ? `, heaviest ${r1(b.weight.kg)}` : '';
      out.push(`- ${name(id)}: ${best}${heavy}; e1RM trend ${trend.map(r1).join(' > ')}; ${last3}`);
    }
  }

  // weekly volume, 8 weeks
  const start = weekStart(now);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const from = start - i * 7 * 86_400_000, to = from + 7 * 86_400_000;
    const ws = hist.filter(x => x.startedAt >= from && x.startedAt < to);
    weeks.push(`${d(from)}: ${ws.length} sessions, ${Math.round(ws.reduce((a, x) => a + volume(x), 0))} kg`);
  }
  out.push('', 'WEEKLY VOLUME (week starting):', ...weeks.map(x => `- ${x}`));

  if (snap.routines?.length) {
    out.push('', 'ROUTINES:');
    for (const r of snap.routines) out.push(`- ${r.name}: ${r.exercises.map(e => `${name(e.exerciseId)} ${e.sets.length}x${e.sets[0]?.reps ?? '?'}`).join(', ')}`);
  }

  // cardio: weekly minutes and recent sessions
  const cardio = [...(snap.cardio || [])].sort((a, b) => b.startedAt - a.startedAt);
  if (cardio.length) {
    out.push('', `CARDIO (goal ${settings.cardioGoal ?? 150} min/week):`);
    for (let i = 7; i >= 0; i--) {
      const from = start - i * 7 * 86_400_000;
      const c = cardioMinutes(cardio, from, from + 7 * 86_400_000);
      out.push(`- week of ${d(from)}: ${c.sessions} sessions, ${c.minutes} min (${c.zone2} easy), ${c.km} km`);
    }
    out.push('Recent sessions:');
    for (const c of cardio.slice(0, 12)) {
      out.push(`- ${d(c.startedAt)} ${cardioName(c.type, 'en')}: ${Math.round(c.durationSec / 60)} min${c.distanceKm ? `, ${r1(c.distanceKm)} km, ${paceText(c, 'en')}` : ''}${c.zone ? `, zone ${c.zone}` : ''}`);
    }
  } else out.push('', 'CARDIO: none logged.');
  if (snap.activeCardio) out.push(`Cardio running now: ${cardioName(snap.activeCardio.type, 'en')}.`);

  const st = weekStreak(snap.history, cardio, settings.weeklyGoal ?? 3, now);
  out.push('', `STREAK: ${st.streak} weeks meeting the goal; this week ${st.thisWeek} of ${st.goal}.`);

  const bw = [...(snap.bodyweight || [])].sort((a, b) => a.date.localeCompare(b.date));
  out.push('', bw.length ? `BODYWEIGHT: ${bw.slice(-8).map(b => `${b.date} ${r1(b.kg)}`).join(', ')}` : 'BODYWEIGHT: no data logged.');
  const tr = bodyTrend(bw);
  const target = tr ? proteinTarget(tr.latest.kg, settings.proteinPerKg) : null;
  const protein = (snap.nutrition || []).find(n => n.date === dateKey(now))?.protein || 0;
  out.push(`PROTEIN today: ${protein} g${target ? ` of a ${target} g target` : ' (no target without bodyweight)'}.`);
  const day = (snap.nutrition || []).find(n => n.date === dateKey(now));
  if (day?.meals?.length) out.push(`MEALS today (estimates): ${day.meals.map(m => `${m.name} ${m.protein} g protein ${m.kcal} kcal`).join('; ')}. Total ${day.kcal || 0} kcal.`);
  if (w?.readiness) out.push(`Readiness today: ${w.readiness}/5${w.easy ? ', easy day chosen' : ''}.`);

  let text = out.join('\n');
  if (text.length > MAX_CONTEXT_CHARS) text = text.slice(0, MAX_CONTEXT_CHARS) + '\n[summary truncated]';
  return text;
}

// Chat history → Gemini contents, with the context attached to the newest user turn.
export function chatContents(chat, context, question) {
  const turns = chat.slice(-CHAT_TURNS).filter(m => m.text && (m.role === 'user' || m.role === 'model'));
  const contents = turns.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: 'user', parts: [{ text: `Training data:\n${context}\n\nQuestion: ${question}` }] });
  // the API wants turns to start with the user
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

const Q_START = /^(how|what|why|when|which|who|should|could|would|can|is|are|do|does|did|am|will|tell me|explain|give me|any tips|hvordan|hvad|hvorfor|hvornår|hvilken|hvilke|hvem|skal|kan|bør|er|var|har|vil|gør|fortæl|forklar|giv mig)\b/i;
// A question for the Coach rather than a command.
export function isQuestion(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return /\?\s*$/.test(s) || Q_START.test(s);
}

// Minimal, safe formatting for answers: escape, **bold**, line breaks, "- " bullets.
export function formatAnswer(text) {
  const esc = String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = esc.split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(\S.*?)\*/g, '$1<i>$2</i>');
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) { if (!list) { html += '<ul>'; list = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

// Plain text for speaking: no markup, no bullets.
export const speakable = text => String(text || '').replace(/\*\*?|__|#+\s/g, '').replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '').replace(/\n+/g, ' ').trim();

// ---------- plan builder ----------

const PLAN_WORDS = /\b(plan|program|programme|split|routine|routines|schedule|rutine|rutiner|træningsplan|program)\b/i;
const MAKE_WORDS = /\b(make|build|create|design|give me|write|set up|lav|byg|opret|giv mig|skriv|sammensæt)\b/i;
const SPLIT_WORDS = /(\b\d\s?-?\s?(day|days|dages|dag)\b|upper\s?\/?\s?lower|push\s?\/?\s?pull|\bppl\b|full[\s-]?body|hele kroppen|overkrop|(times|days|x) (a|per) week|dage om ugen|gange om ugen)/i;
export const isPlanRequest = text => MAKE_WORDS.test(text) && (PLAN_WORDS.test(text) || SPLIT_WORDS.test(text));

export const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'short plan name' },
    perWeek: { type: 'INTEGER' },
    summary: { type: 'STRING', description: 'two sentences max, in the user\'s language' },
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          exercises: { type: 'ARRAY', items: { type: 'OBJECT', properties: { exercise: { type: 'STRING' }, sets: { type: 'INTEGER' }, reps: { type: 'INTEGER' } }, required: ['exercise', 'sets', 'reps'] } }
        },
        required: ['name', 'exercises']
      }
    }
  },
  required: ['name', 'days', 'summary']
};

export function planSystem(lang, catalog) {
  return [
    'You are an experienced strength coach building a training plan as structured data.',
    `Write names and the summary in ${lang === 'da' ? 'Danish' : 'English'}.`,
    'Use only exercises from this catalog, spelled exactly as listed:',
    catalog.all.map(e => `${e.en} (${e.equipment})`).join(', ') + '.',
    'Respect the requested days per week, session length (about 3.5 minutes per set including rest), focus and available equipment.',
    'Each day 3 to 8 exercises, 2 to 5 sets, 5 to 20 reps. Base it on the training data when given.'
  ].join(' ');
}

// Strictly check the model's plan against the catalog and limits. Returns null if unusable.
export function validatePlan(raw, catalog) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days) || !raw.days.length || raw.days.length > 7) return null;
  const days = [];
  for (const d of raw.days) {
    if (!d || !Array.isArray(d.exercises)) return null;
    const exercises = [];
    for (const x of d.exercises.slice(0, 12)) {
      const e = catalog.findExact(String(x?.exercise || ''));
      const sets = Number.isInteger(x?.sets) ? Math.max(1, Math.min(8, x.sets)) : null;
      const reps = Number.isInteger(x?.reps) ? Math.max(1, Math.min(50, x.reps)) : null;
      if (!e || !sets || !reps) continue; // drop what we can't use rather than guess
      exercises.push({ exerciseId: e.id, sets, reps });
    }
    if (!exercises.length) return null;
    days.push({ name: String(d.name || '').trim().slice(0, 30) || `Day ${days.length + 1}`, exercises });
  }
  return {
    name: String(raw.name || '').trim().slice(0, 30) || 'Plan',
    perWeek: Number.isInteger(raw.perWeek) ? Math.max(1, Math.min(7, raw.perWeek)) : days.length,
    summary: String(raw.summary || '').trim().slice(0, 400),
    days
  };
}

// Plan → routine records.
export function planToRoutines(plan, now = Date.now()) {
  return plan.days.map((d, i) => ({
    id: 'r-' + globalThis.crypto.randomUUID(),
    name: d.name.slice(0, 40),
    plan: plan.name,
    exercises: d.exercises.map(e => ({ exerciseId: e.exerciseId, sets: Array.from({ length: e.sets }, () => ({ reps: e.reps, kg: null })) })),
    createdAt: now + i
  }));
}
