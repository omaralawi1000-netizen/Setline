// Goal autopilot: "100 kg bench by December". Tracks the estimated max (e1RM) against a straight
// line from where you started to the target, projects the finish from your real trend, and turns
// the gap into this week's aim. Pure.
import { e1rm } from './pr.js';
import { counts } from './workout.js';

const DAY = 86_400_000, WEEK = 7 * DAY;
const uid = () => 'g-' + globalThis.crypto.randomUUID();
const r1 = v => Math.round(v * 10) / 10;

// Best e1RM per session for one exercise, oldest first: [{t, v}]
export function e1rmSessions(history, exerciseId) {
  const out = [];
  for (const w of history) {
    let best = 0;
    for (const ex of w.exercises) if (ex.exerciseId === exerciseId) for (const s of ex.sets) if (counts(s)) best = Math.max(best, e1rm(s.kg, s.reps));
    if (best) out.push({ t: w.startedAt, v: best });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Where you are now: the best of the last three sessions (one off day doesn't erase progress).
export const currentE1rm = series => (series.length ? Math.max(...series.slice(-3).map(p => p.v)) : null);

// kg/week from a least-squares line over the last `weeks` weeks (needs 3+ sessions spread over 10+ days).
export function trendPerWeek(series, now = Date.now(), weeks = 8) {
  const pts = series.filter(p => p.t >= now - weeks * WEEK);
  if (pts.length < 3 || pts[pts.length - 1].t - pts[0].t < 10 * DAY) return null;
  const xs = pts.map(p => (p.t - pts[0].t) / WEEK), ys = pts.map(p => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}

export function makeGoal({ exerciseId, kg, reps = 1, deadline }, history, now = Date.now(), id = uid()) {
  const cur = currentE1rm(e1rmSessions(history, exerciseId));
  return { id, exerciseId, kg: r1(kg), reps: Math.max(1, Math.min(20, Math.round(reps))), deadline, createdAt: now, startE1rm: cur };
}

export function sanitizeGoals(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(g => g && typeof g.id === 'string' && typeof g.exerciseId === 'string' && Number.isFinite(g.kg) && g.kg > 0 && g.kg <= 1000 &&
    Number.isInteger(g.reps) && g.reps >= 1 && g.reps <= 20 && Number.isFinite(g.deadline) && Number.isFinite(g.createdAt)).slice(0, 5)
    .map(g => ({ id: g.id, exerciseId: g.exerciseId, kg: g.kg, reps: g.reps, deadline: g.deadline, createdAt: g.createdAt, startE1rm: Number.isFinite(g.startE1rm) ? g.startE1rm : null, ...(g.doneAt ? { doneAt: g.doneAt } : {}) }));
}

// The weight for `reps` that matches an e1RM (Epley, the same formula the records use).
export const kgFor = (e, reps) => (reps === 1 ? e : e / (1 + reps / 30));
const roundTo = (v, step) => Math.round(v / step) * step;

// Everything the app shows about a goal.
// state: 'done' | 'ahead' | 'on-track' | 'behind' | 'new' (not enough data yet) | 'missed'
export function goalStatus(g, history, now = Date.now(), { step = 2.5, repsNow = null } = {}) {
  const series = e1rmSessions(history, g.exerciseId);
  const target = e1rm(g.kg, g.reps);
  const current = currentE1rm(series);
  const start = g.startE1rm ?? series.find(p => p.t >= g.createdAt)?.v ?? current;
  const weeksLeft = Math.max(0, (g.deadline - now) / WEEK);
  const span = Math.max(1, g.deadline - g.createdAt);
  const frac = Math.min(1, Math.max(0, (now - g.createdAt) / span));
  const expectedNow = start != null ? start + (target - start) * frac : null;
  const trend = trendPerWeek(series, now);
  // project with a believable rate: strength rarely climbs more than ~1.5% a week for long
  const rate = trend != null && current != null ? Math.min(Math.max(0, trend), current * 0.015) : null;
  const projected = rate != null ? current + rate * weeksLeft : null;
  let state;
  if (current != null && current >= target) state = 'done';
  else if (now > g.deadline) state = 'missed';
  else if (current == null || projected == null) state = 'new';
  else if (projected >= target * 1.02) state = 'ahead';
  else if (projected >= target * 0.98) state = 'on-track';
  else state = 'behind';
  // this week's aim: a week further along the line, as a set at the reps you usually do
  const reps = repsNow || (g.reps > 1 ? g.reps : commonReps(history, g.exerciseId)) || g.reps;
  const aimE = start != null ? Math.min(target, start + (target - start) * Math.min(1, (now + WEEK - g.createdAt) / span)) : null;
  const aim = aimE != null && state !== 'done' ? { kg: Math.max(0, roundTo(kgFor(aimE, reps), step)), reps } : null;
  const needed = current != null && weeksLeft > 0 ? (target - current) / weeksLeft : null;
  return {
    target: r1(target), current: current != null ? r1(current) : null, start: start != null ? r1(start) : null,
    pct: current != null ? Math.max(0, Math.min(1, current / target)) : 0,
    expectedPct: expectedNow != null ? Math.max(0, Math.min(1, expectedNow / target)) : frac, expectedNow: expectedNow != null ? r1(expectedNow) : null,
    // the same numbers as the goal itself: "now ≈ 81.5 × 5 of 85 × 5"
    nowKg: current != null ? r1(kgFor(current, g.reps)) : null, projKg: projected != null ? r1(kgFor(projected, g.reps)) : null,
    trend: trend != null ? r1(trend) : null, projected: projected != null ? r1(projected) : null,
    neededPerWeek: needed != null ? r1(needed) : null, weeksLeft: Math.round(weeksLeft * 10) / 10, state, aim, series
  };
}

// The reps you most often do on this lift (last 5 sessions).
export function commonReps(history, exerciseId) {
  const count = {};
  const sessions = [...history].sort((a, b) => b.startedAt - a.startedAt).filter(w => w.exercises.some(e => e.exerciseId === exerciseId)).slice(0, 5);
  for (const w of sessions) for (const ex of w.exercises) if (ex.exerciseId === exerciseId) for (const s of ex.sets) if (counts(s)) count[s.reps] = (count[s.reps] || 0) + 1;
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? Number(best[0]) : null;
}

// ---------- dates in speech: "by december", "til jul", "in 12 weeks", "om 3 måneder" ----------

const MONTHS = { january: 0, jan: 0, januar: 0, february: 1, feb: 1, februar: 1, march: 2, mar: 2, marts: 2, april: 3, apr: 3, may: 4, maj: 4, june: 5, jun: 5, juni: 5, july: 6, jul: 6, juli: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9, oktober: 9, okt: 9, november: 10, nov: 10, december: 11, dec: 11 };
export function parseGoalDate(text, now = Date.now()) {
  const s = String(text || '').toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').trim();
  const d0 = new Date(now);
  let m;
  if ((m = /^(?:in |om )?(\d+) (weeks?|uger?|months?|måneder?|maaneder?)$/.exec(s))) {
    const n = Number(m[1]);
    return /^(week|uge)/.test(m[2]) ? now + n * WEEK : new Date(d0.getFullYear(), d0.getMonth() + n, d0.getDate()).getTime();
  }
  if (/^(christmas|xmas|jul|juleaften)$/.test(s)) return nextDate(now, 11, 24);
  if (/^(summer|sommer|sommerferien)$/.test(s)) return nextDate(now, 5, 30);
  if (/^(new year|new years|nytår|the end of the year|end of the year|årets udgang|udgangen af året)$/.test(s)) return nextDate(now, 11, 31);
  if ((m = /^(?:the )?(?:end of |slutningen af |udgangen af )?([a-zæøå]+)$/.exec(s)) && m[1] in MONTHS) return nextDate(now, MONTHS[m[1]], 'end');
  if ((m = /^(\d{1,2})\.? ([a-zæøå]+)$/.exec(s)) && m[2] in MONTHS) return nextDate(now, MONTHS[m[2]], Number(m[1]));
  if ((m = /^([a-zæøå]+) (\d{1,2})$/.exec(s)) && m[1] in MONTHS) return nextDate(now, MONTHS[m[1]], Number(m[2]));
  return null;
}
function nextDate(now, month, day) {
  const d0 = new Date(now);
  for (const y of [d0.getFullYear(), d0.getFullYear() + 1]) {
    const dd = day === 'end' ? new Date(y, month + 1, 0).getDate() : day;
    const t = new Date(y, month, dd, 20).getTime();
    if (t > now + DAY) return t;
  }
  return null;
}
