// Training insights: usual session length, weekly muscle balance, deload timing. Pure.
import { counts, volume } from './workout.js';
import { weekStart } from './stats.js';
import { estimateMinutes } from './routines.js';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const minutes = w => (w.finishedAt - w.startedAt) / 60000;

// ---------- session length ----------

// Usual length in minutes: median of the last 5 sessions of this routine (2+ needed),
// then of any 5 recent sessions (3+ needed), then the routine estimate. {min, from: 'routine'|'recent'|'estimate'} or null.
export function usualMinutes(history, routineId = null, routine = null) {
  const valid = history.filter(w => w.finishedAt && minutes(w) >= 10 && minutes(w) <= 240).sort((a, b) => b.startedAt - a.startedAt);
  const same = routineId ? valid.filter(w => w.routineId === routineId).slice(0, 5) : [];
  if (same.length >= 2) return { min: Math.round(median(same.map(minutes)) / 5) * 5, from: 'routine' };
  const recent = valid.slice(0, 5);
  if (recent.length >= 3) return { min: Math.round(median(recent.map(minutes)) / 5) * 5, from: 'recent' };
  if (routine?.exercises?.length) return { min: estimateMinutes(routine), from: 'estimate' };
  return null;
}

// Where the running session stands against the usual length. Only speaks up past +5 min.
// {state: 'ok'|'near'|'over', left?, over?, usual}
export function timeStatus(elapsedSec, usual) {
  if (!usual) return null;
  const el = elapsedSec / 60;
  if (el > usual.min + 5) return { state: 'over', over: Math.round(el - usual.min), usual: usual.min };
  if (el >= usual.min - 5) return { state: 'near', left: Math.max(0, Math.round(usual.min - el)), usual: usual.min };
  return { state: 'ok', left: Math.round(usual.min - el), usual: usual.min };
}

// ---------- muscle balance ----------

// Groups shown to the user and the catalog muscles in each.
export const GROUPS = {
  chest: ['chest'], back: ['back', 'traps'], shoulders: ['shoulders'], arms: ['biceps', 'triceps', 'forearms'],
  legs: ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'], core: ['core']
};
// Rough weekly working-set targets (the low end of the usual 10–20 range; arms and core get indirect work).
export const TARGETS = { chest: 10, back: 10, shoulders: 8, arms: 8, legs: 12, core: 6 };
const groupOf = m => Object.keys(GROUPS).find(g => GROUPS[g].includes(m)) || null;

// Working sets per group in a time range. The primary muscle counts a full set, the others half,
// and one set counts at most once per group.
export function setsPerGroup(history, catalog, from, to) {
  const out = Object.fromEntries(Object.keys(GROUPS).map(g => [g, 0]));
  for (const w of history) {
    if (w.startedAt < from || w.startedAt >= to) continue;
    for (const ex of w.exercises) {
      const e = catalog.get(ex.exerciseId);
      if (!e?.muscles?.length) continue;
      const n = ex.sets.filter(counts).length;
      if (!n) continue;
      const credit = {};
      e.muscles.forEach((m, i) => { const g = groupOf(m); if (g) credit[g] = Math.max(credit[g] || 0, i === 0 ? 1 : 0.5); });
      for (const [g, c] of Object.entries(credit)) out[g] += n * c;
    }
  }
  for (const g in out) out[g] = Math.round(out[g] * 2) / 2;
  return out;
}

// This week's balance: [{group, sets, target, pct}] and the most behind group, if any.
// Nothing is flagged before the week is half over, and not without some training.
export function muscleBalance(history, catalog, now = Date.now()) {
  const from = weekStart(now);
  const sets = setsPerGroup(history, catalog, from, from + WEEK);
  const rows = Object.keys(GROUPS).map(g => ({ group: g, sets: sets[g], target: TARGETS[g], pct: Math.min(1, sets[g] / TARGETS[g]) }));
  const total = rows.reduce((a, r) => a + r.sets, 0);
  const dayOfWeek = Math.floor((now - from) / DAY); // 0 = Monday
  const behind = total >= 6 && dayOfWeek >= 3
    ? rows.filter(r => r.group !== 'core' && r.sets < r.target * 0.4).sort((a, b) => a.pct - b.pct)[0] || null
    : null;
  return { rows, total, behind };
}

// ---------- deload ----------

// Weeks of steady training since the last lighter week or break, counting back from last week.
// A week counts as training with 2+ workouts; a week off, a week under 60% of the average volume,
// or a week with a deload/easy workout marked resets the count.
export function trainingBlock(history, now = Date.now()) {
  const cur = weekStart(now);
  const weeks = [];
  for (let i = 1; i <= 16; i++) {
    const from = weekStart(cur - (i - 1) * WEEK - DAY);
    const ws = history.filter(w => w.startedAt >= from && w.startedAt < from + WEEK);
    weeks.push({ from, n: ws.length, vol: ws.reduce((a, w) => a + volume(w), 0), light: ws.some(w => w.deload) });
  }
  let block = 0;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const prior = weeks.slice(i + 1, i + 5).filter(x => x.n >= 2);
    const avg = prior.length ? prior.reduce((a, x) => a + x.vol, 0) / prior.length : 0;
    if (w.n < 2 || w.light || (avg && w.vol < avg * 0.6)) break;
    block++;
  }
  return block;
}

// Suggest a deload after 6+ steady weeks, unless one is running or was turned down recently.
// settings: {deloadUntil, deloadSnoozed}. Returns {state: 'active', until} | {state: 'due', weeks} | null.
export function deloadStatus(history, settings, now = Date.now()) {
  if (settings.deloadUntil && now < settings.deloadUntil) return { state: 'active', until: settings.deloadUntil };
  if (settings.deloadSnoozed && now < settings.deloadSnoozed) return null;
  const weeks = trainingBlock(history, now);
  return weeks >= 6 ? { state: 'due', weeks } : null;
}

// A deload session: same exercises, about half the sets, ~15% lighter. Keeps the habit, lets the body catch up.
const roundTo = (v, step) => Math.max(0, Math.round(v / step) * step);
export function deloadDay(template) {
  return {
    ...template,
    deload: true,
    exercises: template.exercises.map(e => ({
      ...e,
      suggestion: null,
      sets: e.sets.slice(0, Math.max(1, Math.ceil(e.sets.length / 2))).map(s => ({ ...s, kg: s.kg == null ? null : roundTo(s.kg * 0.85, 2.5) }))
    }))
  };
}

// ---------- repeat ----------

// A template that repeats a finished workout: same exercises, same weights and reps (warm-ups left out).
// A repeated deload session is already light, so it isn't made lighter again.
export function repeatTemplate(w) {
  return {
    name: w.name || '',
    routineId: w.routineId || null,
    ...(w.deload ? { deload: true } : {}),
    exercises: w.exercises
      .map(ex => ({ exerciseId: ex.exerciseId, ...(ex.restSec ? { restSec: ex.restSec } : {}), sets: ex.sets.filter(counts).map(s => ({ kg: s.kg, reps: s.reps })) }))
      .filter(ex => ex.sets.length)
  };
}
