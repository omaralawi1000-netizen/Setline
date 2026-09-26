// After a session: did each lift hit what was planned, and what's next time. Pure.
//
// The plan is kept on each exercise when the workout starts (ex.target: {kg, reps, sets}), so the
// review still knows it after the sets were logged over it.
import { suggest } from './progression.js';
import { weekStart } from './stats.js';
export { targetFromSets } from './workout.js';

const DAY = 86_400_000;
const work = ex => (ex.sets || []).filter(s => s.type !== 'warmup');

// One lift: 'hit' (every planned set at the planned weight or more, with the reps), 'missed',
// 'skipped' (nothing done) or 'logged' (no plan to compare with).
export function reviewLift(ex, target = ex.target || null) {
  const done = work(ex).filter(s => s.done && s.reps > 0);
  if (!done.length) return { status: 'skipped', target, got: null };
  const top = Math.max(...done.map(s => s.kg ?? 0));
  const atTop = done.filter(s => (s.kg ?? 0) === top);
  const got = { kg: top, reps: Math.min(...atTop.map(s => s.reps)), sets: done.length };
  if (!target?.reps) return { status: 'logged', target, got };
  const heavyEnough = target.kg == null || top >= target.kg - 1e-9;
  const repsOk = done.filter(s => (s.kg ?? 0) >= (target.kg ?? 0) - 1e-9).length >= (target.sets || 1) && atTop.every(s => s.reps >= target.reps);
  return { status: heavyEnough && repsOk ? 'hit' : 'missed', target, got };
}

// The whole session. history: finished workouts including this one. targets: fallback plans by
// exerciseId for workouts saved before targets were kept.
export function reviewSession(w, history, catalog, targets = {}) {
  const seen = new Set();
  const lifts = [];
  for (const ex of w.exercises || []) {
    if (seen.has(ex.exerciseId)) continue;
    seen.add(ex.exerciseId);
    const r = reviewLift(ex, ex.target || targets[ex.exerciseId] || null);
    const e = catalog?.get?.(ex.exerciseId);
    const next = e && r.status !== 'skipped' ? suggest(history, e, r.target?.reps ?? null) : null;
    lifts.push({ exerciseId: ex.exerciseId, ...r, next });
  }
  const planned = lifts.filter(l => l.status !== 'logged');
  const missed = lifts.filter(l => l.status === 'missed' || (l.status === 'skipped' && l.target));
  const deloads = lifts.filter(l => l.next?.reason === 'deload');
  // worth talking about: most of what was planned didn't happen, or a lift has stalled for good
  const concern = missed.length >= 2 && missed.length * 2 >= planned.length ? 'missed' : deloads.length ? 'deload' : null;
  return { id: w.id, at: w.finishedAt || w.startedAt, lifts, hit: lifts.filter(l => l.status === 'hit').length, missed: missed.length, planned: planned.length, concern };
}

// Next session's targets for a routine: [{exerciseId, kg, reps, reason}] for lifts with history.
export function nextTargets(routine, history, catalog) {
  const out = [];
  for (const re of routine?.exercises || []) {
    const e = catalog?.get?.(re.exerciseId);
    const sg = e && suggest(history, e, re.sets?.[0]?.reps ?? null);
    if (sg) out.push({ exerciseId: re.exerciseId, kg: sg.kg, reps: sg.reps, reason: sg.reason });
  }
  return out;
}

// This week's workouts against the goal: behind when the days left can't hold what's still needed
// (at most one session a day; restDays: planned rest or wrestling days still to come).
export function weekBehind(history, goal, now = Date.now(), restDays = 0) {
  if (!goal) return null;
  const start = weekStart(now), done = history.filter(w => w.startedAt >= start && w.startedAt < start + 7 * DAY).length;
  const need = goal - done;
  const today = start + Math.floor((now - start) / DAY) * DAY, trainedToday = history.some(w => w.startedAt >= today && w.startedAt < today + DAY);
  const daysLeft = 7 - Math.floor((now - start) / DAY) - restDays - (trainedToday ? 1 : 0); // today counts until you've trained
  if (need <= 0) return null;
  // out of reach, or only if every day left is a training day (from Thursday on)
  if (need > daysLeft || (need === daysLeft && daysLeft <= 4)) return { done, goal, need, daysLeft: Math.max(0, daysLeft), lost: need > daysLeft, week: start };
  return null;
}
