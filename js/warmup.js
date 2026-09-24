// Warm-up ramp before the first working set. Pure.
import { suggestNext, lastSession } from './workout.js';
import { stepFor } from './progression.js';

// Empty bar, then ~50%, ~70%, ~85% of the working weight, rounded to 2.5 kg; skips steps that aren't lighter.
export function warmupRamp(workKg, { bar = 20, round = 2.5 } = {}) {
  if (!Number.isFinite(workKg) || workKg <= bar) return [];
  const r = v => Math.round(v / round) * round;
  const steps = [[bar, 10], [r(workKg * 0.5), 5], [r(workKg * 0.7), 3], [r(workKg * 0.85), 2]];
  const out = [];
  for (const [kg, reps] of steps) {
    if (kg >= workKg || kg < bar || out.some(s => s.kg === kg)) continue;
    out.push({ kg, reps, type: 'warmup' });
  }
  return out;
}

// Warm-ups that fit the lift: a bar ramp for barbells (longer when it's heavy), two lighter sets
// for dumbbells and machines, and a single feeler set when the muscles are already warm.
const BAR = { barbell: 20, trapbar: 25, ezbar: 10, smith: 15 };
export function smartRamp(workKg, { equipment = 'barbell', round = 2.5, light = false } = {}) {
  if (!Number.isFinite(workKg) || workKg <= 0 || equipment === 'bodyweight') return [];
  const r = v => Math.round(v / round) * round;
  const bar = BAR[equipment];
  let steps;
  if (bar != null) {
    if (workKg < bar + 15) return [];
    steps = light ? [[0.7, 3]]
      : workKg <= 60 ? [[0, 10], [0.6, 5]]
        : workKg <= 120 ? [[0, 10], [0.5, 5], [0.7, 3], [0.85, 2]]
          : [[0, 8], [0.4, 5], [0.6, 3], [0.75, 2], [0.88, 1]];
  } else {
    const small = equipment === 'dumbbell' || equipment === 'kettlebell';
    if (workKg < (small ? 10 : 15)) return [];
    steps = light ? [[0.65, 5]] : small ? [[0.5, 8], [0.75, 4]] : [[0.5, 10], [0.75, 5]];
  }
  const out = [];
  for (const [f, reps] of steps) {
    const kg = f === 0 ? bar : r(workKg * f);
    if (kg <= 0 || kg >= workKg || (bar != null && kg < bar) || out.some(s => s.kg === kg)) continue;
    out.push({ kg, reps, type: 'warmup' });
  }
  return out;
}

// Does this exercise want a warm-up? 'full' for the first lift of a muscle today, 'light' for a
// barbell lift on muscles already worked, null when it's done, started, bodyweight, or offered before.
export function needsWarmup(w, exIndex, catalog) {
  const ex = w?.exercises?.[exIndex];
  if (!ex || ex.warmed || ex.sets.some(s => s.done || s.type === 'warmup')) return null;
  const info = catalog.get(ex.exerciseId);
  if (!info || info.equipment === 'bodyweight') return null;
  const main = info.muscles?.[0];
  const warm = w.exercises.some((e, i) => i !== exIndex && e.sets.some(s => s.done) && catalog.get(e.exerciseId)?.muscles?.includes(main));
  if (!warm) return 'full';
  return BAR[info.equipment] != null ? 'light' : null;
}

// The next warm-up set still to do, or null.
export const pendingWarmup = ex => ex?.sets.find(s => s.type === 'warmup' && !s.done) || null;

// The ramp for an exercise in this workout, from the weight you're about to lift.
// force: you asked for it, so a full ramp even on warm muscles.
export function warmupsFor(w, exIndex, { catalog, history = [], force = false }) {
  const ex = w?.exercises?.[exIndex];
  const info = ex && catalog.get(ex.exerciseId);
  if (!info || ex.sets.some(s => s.done || s.type === 'warmup')) return [];
  const need = force ? 'full' : needsWarmup(w, exIndex, catalog);
  if (!need) return [];
  const kg = suggestNext(ex, lastSession(history, ex.exerciseId), 20).kg;
  return smartRamp(kg, { equipment: info.equipment, round: BAR[info.equipment] != null ? 2.5 : stepFor(info), light: need === 'light' });
}
