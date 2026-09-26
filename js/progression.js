// Next-set suggestions: progressive overload with stall detection and deloads. Pure.
//
// Rule of thumb (double progression):
// - hit the target reps on every working set at the top weight → add weight next time
// - missed → same weight, beat the reps
// - missed at the same weight three sessions running → deload ~10%
import { counts } from './workout.js';

const LOWER = new Set(['quads', 'hamstrings', 'glutes']);

// Your own steps per kind of kit (Settings → Workout), or null for the defaults below.
export const STEP_GROUPS = ['barbell', 'dumbbell', 'machine'];
export const STEP_CHOICES = [0.5, 1, 1.25, 2, 2.5, 5];
export const stepGroup = equipment => (['dumbbell', 'kettlebell'].includes(equipment) ? 'dumbbell' : ['machine', 'cable'].includes(equipment) ? 'machine' : 'barbell');
let custom = null;
export const userStep = ex => (ex && custom?.[stepGroup(ex.equipment)]) || null; // the stepper: yours, else 2.5
export const configureSteps = steps => { custom = steps && typeof steps === 'object' ? steps : null; };
export function sanitizeSteps(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const g of STEP_GROUPS) if (STEP_CHOICES.includes(s[g])) out[g] = s[g];
  return Object.keys(out).length ? out : null;
}

// Weight step for an exercise: big lower-body lifts move faster, dumbbells in 2 kg jumps.
export function stepFor(ex) {
  if (ex && custom?.[stepGroup(ex.equipment)]) return custom[stepGroup(ex.equipment)];
  if (!ex) return 2.5;
  if (ex.equipment === 'dumbbell' || ex.equipment === 'kettlebell') return 2;
  if (LOWER.has(ex.muscles?.[0]) && ['barbell', 'trapbar', 'machine', 'smith'].includes(ex.equipment)) return 5;
  return 2.5;
}

const roundTo = (v, step) => Math.max(0, Math.round(v / step) * step);

// Plate-aware: the weights you can actually load. A bar is 20 kg (an EZ bar 10) plus a pair of plates,
// so its grid is two of the smallest plates (1.25 kg each, or your own barbell step); dumbbells come in
// their step (2 kg, or yours); machines and cables in theirs (2.5, or yours).
const BAR_KG = { barbell: 20, ezbar: 10, trapbar: 20 };
export function gridFor(ex) {
  const g = stepGroup(ex?.equipment);
  if (custom?.[g]) return custom[g];
  return g === 'dumbbell' ? 2 : 2.5;
}
// Nearest loadable weight (dir 1: the next one up, -1: the next one down). Never below the empty bar.
export function loadable(kg, ex, dir = 0) {
  if (!Number.isFinite(kg)) return kg;
  const grid = gridFor(ex), base = BAR_KG[ex?.equipment] || 0, k = (kg - base) / grid;
  const n = dir > 0 ? Math.ceil(k - 1e-9) : dir < 0 ? Math.floor(k + 1e-9) : Math.round(k);
  return Math.max(base, Math.round((base + n * grid) * 100) / 100);
}

// Sessions for one exercise, newest first: [{t, sets: [{kg, reps}]}]
export function sessionsFor(history, exerciseId, limit = 6) {
  const out = [];
  for (const w of [...history].sort((a, b) => b.startedAt - a.startedAt)) {
    const sets = [];
    for (const ex of w.exercises) if (ex.exerciseId === exerciseId) for (const s of ex.sets) if (counts(s)) sets.push({ kg: s.kg, reps: s.reps });
    if (sets.length) out.push({ t: w.startedAt, sets });
    if (out.length >= limit) break;
  }
  return out;
}

const topOf = sets => Math.max(...sets.map(s => s.kg));
const hitAll = (sets, target) => { const top = topOf(sets); return sets.filter(s => s.kg === top).every(s => s.reps >= target); };

// {kg, reps, reason: 'up'|'repeat'|'deload'|'reps', from: {kg, reps}} or null with no history.
export function suggest(history, exercise, targetReps = null) {
  const sessions = sessionsFor(history, exercise.id);
  if (!sessions.length) return null;
  const last = sessions[0];
  const top = topOf(last.sets);
  const target = targetReps ?? last.sets.find(s => s.kg === top).reps;
  const from = { kg: top, reps: Math.min(...last.sets.filter(s => s.kg === top).map(s => s.reps)) };
  if (exercise.equipment === 'bodyweight' && top === 0) {
    return hitAll(last.sets, target) ? { kg: 0, reps: target + 1, reason: 'reps', from } : { kg: 0, reps: target, reason: 'repeat', from };
  }
  if (hitAll(last.sets, target)) return { kg: loadable(top + stepFor(exercise), exercise, 1), reps: target, reason: 'up', from };
  const stalled = sessions.slice(0, 3);
  if (stalled.length === 3 && stalled.every(x => topOf(x.sets) === top && !hitAll(x.sets, target))) {
    return { kg: Math.min(top, loadable(top * 0.9, exercise, -1)), reps: target, reason: 'deload', from };
  }
  return { kg: top, reps: target, reason: 'repeat', from };
}

// Easy day from a low readiness score: ~10% lighter, one set fewer per exercise.
export function easyDay(template) {
  return {
    ...template,
    easy: true,
    exercises: template.exercises.map(e => ({
      ...e,
      sets: (e.sets.length > 2 ? e.sets.slice(0, -1) : e.sets).map(s => ({ ...s, kg: s.kg == null ? null : roundTo(s.kg * 0.9, 2.5) }))
    }))
  };
}
