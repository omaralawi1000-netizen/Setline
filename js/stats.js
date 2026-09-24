// Summaries for the Today cards. Pure.
import { volume, elapsedSec, counts } from './workout.js';
import { e1rm } from './pr.js';

const DAY = 86_400_000;

// Monday 00:00 local time of the week containing ts.
export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// {count, days: [7 booleans, Mon..Sun], today: 0..6}
export function thisWeek(history, now = Date.now()) {
  const start = weekStart(now);
  const days = new Array(7).fill(false);
  let count = 0;
  for (const w of history) {
    if (w.startedAt < start || w.startedAt >= start + 7 * DAY) continue;
    count++;
    days[Math.min(6, Math.floor((w.startedAt - start) / DAY))] = true;
  }
  return { count, days, today: Math.min(6, Math.floor((now - start) / DAY)) };
}

export function lastSessionSummary(history) {
  const w = [...history].sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!w) return null;
  return { workout: w, volume: volume(w), minutes: Math.max(1, Math.round(elapsedSec(w) / 60)) };
}

// Best e1RM per session for an exercise, oldest first: [{t, v}]
export function e1rmSeries(history, exerciseId, until = Infinity) {
  const out = [];
  for (const w of history) {
    if (w.startedAt > until) continue;
    let best = 0;
    for (const ex of w.exercises) if (ex.exerciseId === exerciseId) for (const s of ex.sets) if (counts(s)) best = Math.max(best, e1rm(s.kg, s.reps));
    if (best) out.push({ t: w.startedAt, v: best });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Heaviest counted set for an exercise in workouts before ts.
function heaviestBefore(history, exerciseId, ts) {
  let kg = null;
  for (const w of history) {
    if (w.startedAt >= ts) continue;
    for (const ex of w.exercises) if (ex.exerciseId === exerciseId) for (const s of ex.sets) if (counts(s) && (kg == null || s.kg > kg)) kg = s.kg;
  }
  return kg;
}

// The most recent workout's headline PR: heaviest first, then e1RM, then reps.
// {pr, workout, deltaKg, series}
export function latestPR(history) {
  const sorted = [...history].sort((a, b) => b.startedAt - a.startedAt);
  const rank = { weight: 0, e1rm: 1, reps: 2 };
  for (const w of sorted) {
    if (!w.prs?.length) continue;
    const pr = [...w.prs].sort((a, b) => rank[a.kind] - rank[b.kind] || b.value - a.value)[0];
    const before = heaviestBefore(history, pr.exerciseId, w.startedAt);
    return {
      pr, workout: w,
      deltaKg: before != null && pr.kind === 'weight' ? Math.round((pr.kg - before) * 100) / 100 : null,
      series: e1rmSeries(history, pr.exerciseId, w.startedAt).slice(-8)
    };
  }
  return null;
}

// Sparkline path in a w×h box: {line, area, last:{x,y}}
export function sparkline(series, w = 116, h = 56, pad = 9) {
  if (series.length < 2) return null;
  const vs = series.map(p => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const span = hi - lo || 1;
  const pts = series.map((p, i) => ({
    x: Math.round((i / (series.length - 1)) * w * 10) / 10,
    y: Math.round((h - pad - ((p.v - lo) / span) * (h - pad * 2)) * 10) / 10
  }));
  const line = pts.map(p => `${p.x},${p.y}`).join(' ');
  return { line, area: `M${pts.map(p => `${p.x} ${p.y}`).join(' ')}V${h}H0Z`, last: pts[pts.length - 1] };
}
