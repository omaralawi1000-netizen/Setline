// What a finished session means: against the last time you did the same thing, lift by lift, and
// where the week stands. Pure.
import { counts, volume } from './workout.js';
import { e1rm } from './pr.js';
import { weekStart } from './stats.js';

const DAY = 86_400_000;

// The best working set of an exercise in a workout (by estimated max).
export function topSet(ex) {
  let best = null;
  for (const s of ex?.sets || []) if (counts(s) && s.kg > 0 && s.reps > 0) { const v = e1rm(s.kg, s.reps); if (!best || v > best.e1) best = { kg: s.kg, reps: s.reps, e1: v }; }
  return best;
}

// The last earlier session of the same routine (or the same name), else the last one that shared a lift.
export function previousOf(w, history) {
  const earlier = history.filter(h => h.id !== w.id && h.startedAt < w.startedAt).sort((a, b) => b.startedAt - a.startedAt);
  const same = earlier.find(h => (w.routineId && h.routineId === w.routineId) || (w.name && h.name === w.name));
  if (same) return same;
  const ids = new Set(w.exercises.map(e => e.exerciseId));
  return earlier.find(h => h.exercises.some(e => ids.has(e.exerciseId))) || null;
}

export function sessionHighlights(w, history, { weeklyGoal = 3 } = {}) {
  const prev = previousOf(w, history);
  const lifts = [];
  for (const ex of w.exercises) {
    const now = topSet(ex);
    if (!now) continue;
    // the last time this lift was done, in any session
    const last = history.filter(h => h.id !== w.id && h.startedAt < w.startedAt).sort((a, b) => b.startedAt - a.startedAt)
      .map(h => topSet(h.exercises.find(e => e.exerciseId === ex.exerciseId))).find(Boolean) || null;
    const delta = last ? Math.round((now.e1 - last.e1) * 10) / 10 : null;
    lifts.push({ exerciseId: ex.exerciseId, now, last, delta, trend: delta == null ? 'new' : delta > 0.4 ? 'up' : delta < -0.4 ? 'down' : 'same' });
  }
  const vol = volume(w), pvol = prev ? volume(prev) : 0;
  const start = weekStart(w.startedAt);
  const weekDone = history.filter(h => h.startedAt >= start && h.startedAt < start + 7 * DAY && (h.id === w.id || h.startedAt <= w.startedAt)).length + (history.some(h => h.id === w.id) ? 0 : 1);
  return {
    vsLast: prev && pvol ? { pct: Math.round(((vol - pvol) / pvol) * 100), date: prev.startedAt } : null,
    lifts, up: lifts.filter(l => l.trend === 'up').length,
    week: { done: weekDone, goal: weeklyGoal }
  };
}
