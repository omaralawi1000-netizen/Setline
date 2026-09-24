// Next-set suggestions: progressive overload with stall detection and deloads. Pure.
//
// Rule of thumb (double progression):
// - hit the target reps on every working set at the top weight → add weight next time
// - missed → same weight, beat the reps
// - missed at the same weight three sessions running → deload ~10%
import { counts } from './workout.js';

const LOWER = new Set(['quads', 'hamstrings', 'glutes']);

// Weight step for an exercise: big lower-body lifts move faster, dumbbells in 2 kg jumps.
export function stepFor(ex) {
  if (!ex) return 2.5;
  if (ex.equipment === 'dumbbell' || ex.equipment === 'kettlebell') return 2;
  if (LOWER.has(ex.muscles?.[0]) && ['barbell', 'trapbar', 'machine', 'smith'].includes(ex.equipment)) return 5;
  return 2.5;
}

const roundTo = (v, step) => Math.max(0, Math.round(v / step) * step);

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
  if (hitAll(last.sets, target)) return { kg: top + stepFor(exercise), reps: target, reason: 'up', from };
  const stalled = sessions.slice(0, 3);
  if (stalled.length === 3 && stalled.every(x => topOf(x.sets) === top && !hitAll(x.sets, target))) {
    return { kg: roundTo(top * 0.9, 2.5), reps: target, reason: 'deload', from };
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
