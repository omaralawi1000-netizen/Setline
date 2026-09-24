// Stalled lifts and what to change. A lift in your plan has stalled when its last three sessions,
// spread over two weeks or more, didn't beat the best estimated max from before them.
// The fix is concrete and applies to the plan in one tap: a new rep range or a close variation. Pure.
import { e1rmSessions } from './goals.js';

const DAY = 86_400_000;

// A close variation that trains the same thing from a new angle.
export const VARIATIONS = {
  'bench-press': 'incline-bench-press', 'incline-bench-press': 'dumbbell-bench-press', 'close-grip-bench-press': 'bench-press',
  'dumbbell-bench-press': 'bench-press', 'incline-dumbbell-press': 'incline-bench-press', 'machine-chest-press': 'dumbbell-bench-press',
  'overhead-press': 'dumbbell-shoulder-press', 'dumbbell-shoulder-press': 'overhead-press', 'arnold-press': 'overhead-press', 'push-press': 'overhead-press',
  'back-squat': 'front-squat', 'front-squat': 'back-squat', 'hack-squat': 'back-squat', 'leg-press': 'hack-squat', 'goblet-squat': 'bulgarian-split-squat',
  'deadlift': 'trap-bar-deadlift', 'trap-bar-deadlift': 'deadlift', 'sumo-deadlift': 'deadlift', 'romanian-deadlift': 'hip-thrust', 'hip-thrust': 'romanian-deadlift',
  'barbell-row': 'pendlay-row', 'pendlay-row': 'barbell-row', 't-bar-row': 'barbell-row', 'dumbbell-row': 'seated-cable-row', 'seated-cable-row': 'dumbbell-row',
  'lat-pulldown': 'pull-up', 'pull-up': 'lat-pulldown', 'chin-up': 'lat-pulldown',
  'barbell-curl': 'dumbbell-curl', 'dumbbell-curl': 'hammer-curl', 'ez-bar-curl': 'preacher-curl', 'preacher-curl': 'ez-bar-curl', 'hammer-curl': 'barbell-curl', 'cable-curl': 'dumbbell-curl',
  'triceps-pushdown': 'overhead-triceps-extension', 'overhead-triceps-extension': 'skull-crusher', 'skull-crusher': 'close-grip-bench-press', 'dip': 'close-grip-bench-press',
  'lateral-raise': 'cable-lateral-raise', 'cable-lateral-raise': 'lateral-raise',
  'leg-extension': 'bulgarian-split-squat', 'lying-leg-curl': 'seated-leg-curl', 'seated-leg-curl': 'lying-leg-curl',
  'standing-calf-raise': 'seated-calf-raise', 'seated-calf-raise': 'standing-calf-raise'
};

// Heavy work stalled → lighter, more reps; light work stalled → heavier, fewer.
export const newReps = reps => (reps <= 6 ? 10 : reps <= 9 ? 5 : 6);

// Planned reps for an exercise: the first routine that has it.
function planned(routines, exerciseId) {
  for (const r of routines) {
    const e = r.exercises.find(x => x.exerciseId === exerciseId);
    if (e) return { sets: e.sets.length, reps: e.sets[0]?.reps || 8 };
  }
  return null;
}

// [{exerciseId, since, best, sessions, sets, reps, toReps, swapTo}] — in plan order, snoozed ones left out.
export function stalledLifts(history, routines, { catalog, snooze = {}, now = Date.now() } = {}) {
  const ids = [...new Set(routines.flatMap(r => r.exercises.map(e => e.exerciseId)))];
  const out = [];
  for (const id of ids) {
    if ((snooze[id] || 0) > now) continue;
    const info = catalog?.get(id);
    if (!info || info.equipment === 'bodyweight') continue;
    const series = e1rmSessions(history, id);
    if (series.length < 4) continue;
    const last = series.slice(-3), before = series.slice(0, -3);
    if (last[2].t - last[0].t < 14 * DAY || now - last[2].t > 21 * DAY) continue;
    const peak = Math.max(...before.map(p => p.v));
    if (Math.max(...last.map(p => p.v)) > peak * 1.01) continue;
    const plan = planned(routines, id);
    const swap = VARIATIONS[id];
    out.push({
      exerciseId: id, since: last[0].t, best: Math.round(peak * 2) / 2, sessions: last.length,
      sets: plan.sets, reps: plan.reps, toReps: newReps(plan.reps),
      swapTo: swap && catalog.get(swap) ? swap : null
    });
  }
  return out;
}

// Apply a change to every routine that has the lift. kind: 'reps' | 'swap'.
export function applyPlateauFix(routines, stall, kind) {
  return routines.map(r => {
    if (!r.exercises.some(e => e.exerciseId === stall.exerciseId)) return r;
    return {
      ...r,
      exercises: r.exercises.map(e => {
        if (e.exerciseId !== stall.exerciseId) return e;
        if (kind === 'swap' && stall.swapTo) return { ...e, exerciseId: stall.swapTo, sets: e.sets.map(s => ({ ...s, kg: null })) };
        if (kind === 'reps') return { ...e, sets: e.sets.map(s => ({ ...s, reps: stall.toReps, kg: null })) };
        return e;
      })
    };
  });
}
