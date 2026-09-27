// A month in numbers, for the recap picture: sessions, volume, records, the lifts that moved most,
// bodyweight and cardio. The month so far, or last month during the first days of a new one. Pure.
import { volume } from './workout.js';
import { e1rm } from './pr.js';

export function recapMonth(now = Date.now()) {
  const d = new Date(now);
  const back = d.getDate() <= 5 ? 1 : 0;
  const from = new Date(d.getFullYear(), d.getMonth() - back, 1).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() - back + 1, 1).getTime();
  return { from, to: Math.min(to, now + 1), whole: back === 1 };
}

const best = (w, id) => {
  let b = 0;
  for (const ex of w.exercises || []) if (ex.exerciseId === id) for (const s of ex.sets) if (s.done && s.type !== 'warmup' && s.kg > 0) b = Math.max(b, e1rm(s.kg, s.reps));
  return b;
};

export function monthRecap({ history = [], prs = [], bodyweight = [], cardio = [] }, range = recapMonth()) {
  const inMonth = history.filter(w => w.startedAt >= range.from && w.startedAt < range.to);
  if (!inMonth.length) return null;
  const before = history.filter(w => w.startedAt < range.from);
  const ids = [...new Set(inMonth.flatMap(w => w.exercises.map(e => e.exerciseId)))];
  // how far each lift's best estimated max moved: against the month before, else the month's first session
  const moves = ids.map(id => {
    const now = Math.max(0, ...inMonth.map(w => best(w, id)));
    const prevBest = Math.max(0, ...before.map(w => best(w, id)));
    const first = [...inMonth].sort((a, b) => a.startedAt - b.startedAt).map(w => best(w, id)).find(v => v > 0) || 0;
    const base = prevBest || first;
    return { id, now: Math.round(now * 10) / 10, change: base ? Math.round((now - base) * 10) / 10 : 0 };
  }).filter(m => m.now > 0 && m.change > 0).sort((a, b) => b.change - a.change).slice(0, 3);
  const bw = [...bodyweight].filter(b => { const t = Date.parse(b.date); return t >= range.from && t < range.to; }).sort((a, b) => a.date.localeCompare(b.date));
  const cardioMin = Math.round(cardio.filter(c => c.startedAt >= range.from && c.startedAt < range.to).reduce((a, c) => a + (c.durationSec || 0), 0) / 60);
  return {
    ...range,
    sessions: inMonth.length,
    volume: Math.round(inMonth.reduce((a, w) => a + volume(w), 0)),
    records: prs.filter(r => r.kind !== 'reps' && r.date >= range.from && r.date < range.to).length,
    moves,
    bodyweight: bw.length >= 2 ? { from: bw[0].kg, to: bw[bw.length - 1].kg } : null,
    cardioMin
  };
}
