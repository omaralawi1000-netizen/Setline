// Personal records. Pure.
// Kinds: 'weight' (heaviest kg), 'e1rm' (best Epley estimate), 'reps' (most reps at a given kg).
// A PR needs a baseline: the first session of an exercise sets it, later sessions can beat it.
// Warm-up sets never count.

export function e1rm(kg, reps) {
  if (!(kg > 0) || !(reps > 0)) return 0;
  if (reps === 1) return kg;
  return Math.round(kg * (1 + reps / 30) * 10) / 10;
}

const eligible = s => s.done && s.type !== 'warmup' && s.reps > 0 && s.kg != null;
const kgKey = kg => String(Math.round(kg * 1000) / 1000);
export const prId = (exerciseId, kind, kg) => (kind === 'reps' ? `${exerciseId}|reps|${kgKey(kg)}` : `${exerciseId}|${kind}`);

// Bests for one exercise from its PR records.
export function bestsFrom(records, exerciseId) {
  const b = { weight: null, e1rm: null, reps: {} };
  for (const r of records) {
    if (r.exerciseId !== exerciseId) continue;
    if (r.kind === 'reps') b.reps[kgKey(r.kg)] = r;
    else b[r.kind] = r;
  }
  return b;
}

const hasBaseline = b => b.weight != null || b.e1rm != null;

// PRs achieved by one exercise's sets in a workout, against the baseline bests.
// Returns records (one per kind, per weight for reps) pointing at the best set.
export function exercisePRs(bests, exerciseId, sets, meta = {}) {
  if (!hasBaseline(bests)) return [];
  const list = sets.filter(eligible);
  const out = [];
  const rec = (kind, s, value) => ({
    id: prId(exerciseId, kind, s.kg), exerciseId, kind, kg: s.kg, reps: s.reps, value,
    workoutId: meta.workoutId ?? null, setId: s.id, date: s.completedAt ?? meta.date ?? null
  });

  let top = null;
  for (const s of list) if (s.kg > 0 && (!top || s.kg > top.kg || (s.kg === top.kg && s.reps > top.reps))) top = s;
  if (top && top.kg > (bests.weight?.value ?? 0)) out.push(rec('weight', top, top.kg));

  let best = null, bestV = 0;
  for (const s of list) { const v = e1rm(s.kg, s.reps); if (v > bestV) { bestV = v; best = s; } }
  if (best && bestV > (bests.e1rm?.value ?? 0)) out.push(rec('e1rm', best, bestV));

  const byKg = new Map();
  for (const s of list) {
    const k = kgKey(s.kg);
    if (!byKg.has(k) || s.reps > byKg.get(k).reps) byKg.set(k, s);
  }
  for (const [k, s] of byKg) {
    const prev = bests.reps[k];
    if (prev && s.reps > prev.reps) out.push(rec('reps', s, s.reps));
  }
  return out;
}

// Baseline records a workout creates for exercises done for the first time,
// plus reps-at-weight baselines for weights not seen before.
function baselines(bests, exerciseId, sets, meta) {
  const list = sets.filter(eligible);
  if (!list.length) return [];
  const out = [];
  const rec = (kind, s, value) => ({
    id: prId(exerciseId, kind, s.kg), exerciseId, kind, kg: s.kg, reps: s.reps, value,
    workoutId: meta.workoutId ?? null, setId: s.id, date: s.completedAt ?? meta.date ?? null, baseline: true
  });
  if (!hasBaseline(bests)) {
    let top = list[0], best = list[0];
    for (const s of list) {
      if (s.kg > top.kg || (s.kg === top.kg && s.reps > top.reps)) top = s;
      if (e1rm(s.kg, s.reps) > e1rm(best.kg, best.reps)) best = s;
    }
    out.push(rec('weight', top, top.kg), rec('e1rm', best, e1rm(best.kg, best.reps)));
  }
  const byKg = new Map();
  for (const s of list) {
    const k = kgKey(s.kg);
    if (!bests.reps[k] && (!byKg.has(k) || s.reps > byKg.get(k).reps)) byKg.set(k, s);
  }
  for (const s of byKg.values()) out.push(rec('reps', s, s.reps));
  return out;
}

// Apply a finished workout to the PR records.
// Returns {records: full updated list, prs: the new PRs this workout set (not baselines)}.
export function applyWorkout(records, workout) {
  const map = new Map(records.map(r => [r.id, r]));
  const prs = [];
  const meta = { workoutId: workout.id, date: workout.startedAt };
  for (const ex of workout.exercises) {
    const bests = bestsFrom([...map.values()], ex.exerciseId);
    const won = exercisePRs(bests, ex.exerciseId, ex.sets, meta);
    const base = baselines(bests, ex.exerciseId, ex.sets, meta);
    for (const r of [...won, ...base]) map.set(r.id, r);
    prs.push(...won);
  }
  return { records: [...map.values()], prs };
}

// Rebuild everything from history (oldest first). Used after deleting data.
export function rebuild(workouts) {
  let records = [];
  const byWorkout = {};
  for (const w of [...workouts].sort((a, b) => a.startedAt - b.startedAt)) {
    const r = applyWorkout(records, w);
    records = r.records;
    byWorkout[w.id] = r.prs;
  }
  return { records, byWorkout };
}

// Set ids in a live workout that are currently PRs, for the warm tag.
export function livePRSets(records, workout) {
  const ids = new Map();
  for (const ex of workout.exercises) {
    for (const r of exercisePRs(bestsFrom(records, ex.exerciseId), ex.exerciseId, ex.sets)) {
      if (!ids.has(r.setId)) ids.set(r.setId, []);
      ids.get(r.setId).push(r.kind);
    }
  }
  return ids;
}
