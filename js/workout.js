// Pure workout logic: no DOM, no storage. Every function returns a new workout.

export const LIMITS = {
  kgMax: 1500, kgConfirm: 500,
  repsMin: 1, repsMax: 300, repsConfirm: 100,
  setsPerExercise: 100, exercisesPerWorkout: 60,
  restMin: 30, restMax: 300
};

const uid = () => globalThis.crypto.randomUUID();
const clone = o => structuredClone(o);

export function makeSet({ kg = null, reps = null, type = 'normal', done = false, completedAt = null } = {}, id = uid()) {
  return { id, type, kg, reps, rir: null, note: '', done, completedAt };
}

// template: {name, routineId?, exercises: [{exerciseId, sets: [{kg, reps}]}]}
export function createWorkout(template = {}, now = Date.now(), id = uid()) {
  const exercises = (template.exercises || []).slice(0, LIMITS.exercisesPerWorkout).map(e => ({
    id: uid(),
    exerciseId: e.exerciseId,
    sets: (e.sets || []).slice(0, LIMITS.setsPerExercise).map(s => makeSet({ kg: s.kg ?? null, reps: s.reps ?? null })),
    draft: null
  }));
  return {
    id,
    name: template.name || '',
    routineId: template.routineId || null,
    startedAt: now,
    finishedAt: null,
    exercises,
    current: 0,
    rest: null
  };
}

// Validation of a weight/reps pair. Returns {ok, error?, confirm?[]}.
export function validateSet(kg, reps) {
  if (!Number.isFinite(kg) || kg < 0 || kg > LIMITS.kgMax) return { ok: false, error: 'kg' };
  if (!Number.isInteger(reps) || reps < LIMITS.repsMin || reps > LIMITS.repsMax) return { ok: false, error: 'reps' };
  const confirm = [];
  if (kg > LIMITS.kgConfirm) confirm.push('kg');
  if (reps > LIMITS.repsConfirm) confirm.push('reps');
  return { ok: true, confirm };
}

export const doneSets = ex => ex.sets.filter(s => s.done);
export const firstPlannedIndex = ex => ex.sets.findIndex(s => !s.done);
export const lastDoneIndex = ex => {
  for (let i = ex.sets.length - 1; i >= 0; i--) if (ex.sets[i].done) return i;
  return -1;
};

// Number (1-based) of the set the next log will fill.
export function nextSetNumber(ex) {
  const i = firstPlannedIndex(ex);
  return i === -1 ? ex.sets.length + 1 : i + 1;
}

// Log a set: fills the first planned set of the exercise, otherwise appends. Starts rest.
export function logSet(w, exIndex, { kg, reps }, now = Date.now(), restSec = 90) {
  const v = validateSet(kg, reps);
  if (!v.ok) throw new RangeError('invalid set: ' + v.error);
  const next = clone(w);
  const ex = next.exercises[exIndex];
  if (!ex) throw new RangeError('no exercise');
  const i = firstPlannedIndex(ex);
  let set;
  if (i !== -1) {
    set = ex.sets[i];
    Object.assign(set, { kg, reps, done: true, completedAt: now });
  } else {
    if (ex.sets.length >= LIMITS.setsPerExercise) throw new RangeError('too many sets');
    set = makeSet({ kg, reps, done: true, completedAt: now });
    ex.sets.push(set);
  }
  ex.draft = null;
  next.current = exIndex;
  next.rest = makeRest(now, restSec);
  return { workout: next, set };
}

// "Correct": edit the last done set of an exercise.
export function editLastDone(w, exIndex, patch) {
  const i = lastDoneIndex(w.exercises[exIndex] || { sets: [] });
  if (i === -1) return w;
  return editSet(w, exIndex, w.exercises[exIndex].sets[i].id, patch);
}

export function editSet(w, exIndex, setId, { kg, reps }) {
  const v = validateSet(kg, reps);
  if (!v.ok) throw new RangeError('invalid set: ' + v.error);
  const next = clone(w);
  const set = next.exercises[exIndex]?.sets.find(s => s.id === setId);
  if (!set) return w;
  set.kg = kg;
  set.reps = reps;
  return next;
}

export function deleteSet(w, exIndex, setId) {
  const next = clone(w);
  const ex = next.exercises[exIndex];
  if (!ex) return w;
  const before = ex.sets.length;
  ex.sets = ex.sets.filter(s => s.id !== setId);
  return ex.sets.length === before ? w : next;
}

export function addExercise(w, exerciseId, sets = []) {
  if (w.exercises.length >= LIMITS.exercisesPerWorkout) throw new RangeError('too many exercises');
  const next = clone(w);
  next.exercises.push({ id: uid(), exerciseId, sets: sets.map(s => makeSet(s)), draft: null });
  next.current = next.exercises.length - 1;
  return next;
}

export function removeExercise(w, exIndex) {
  if (!w.exercises[exIndex]) return w;
  const next = clone(w);
  next.exercises.splice(exIndex, 1);
  next.current = Math.max(0, Math.min(next.current > exIndex ? next.current - 1 : next.current, next.exercises.length - 1));
  return next;
}

export function setCurrent(w, exIndex) {
  if (!w.exercises.length) return w;
  const i = Math.max(0, Math.min(exIndex, w.exercises.length - 1));
  if (i === w.current) return w;
  return { ...w, current: i };
}

export function setDraft(w, exIndex, draft) {
  const next = clone(w);
  if (!next.exercises[exIndex]) return w;
  next.exercises[exIndex].draft = { kg: draft.kg, reps: draft.reps };
  return next;
}

// ---- rest: stored as timestamps, remaining time is always derived ----

export function makeRest(now, sec) {
  return { startedAt: now, endsAt: now + sec * 1000, duration: sec };
}

export function restRemaining(rest, now = Date.now()) {
  if (!rest) return 0;
  return Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
}

export function restProgress(rest, now = Date.now()) {
  if (!rest) return 0;
  const total = rest.endsAt - rest.startedAt;
  return total <= 0 ? 0 : Math.max(0, Math.min(1, (rest.endsAt - now) / total));
}

export function adjustRest(w, deltaSec, now = Date.now()) {
  if (!w.rest || restRemaining(w.rest, now) <= 0) return w;
  const endsAt = Math.max(now, w.rest.endsAt + deltaSec * 1000);
  return { ...w, rest: { ...w.rest, endsAt, duration: Math.round((endsAt - w.rest.startedAt) / 1000) } };
}

export function startRest(w, sec, now = Date.now()) {
  return { ...w, rest: makeRest(now, sec) };
}

export function skipRest(w) {
  return w.rest ? { ...w, rest: null } : w;
}

// ---- summaries ----

export const counts = s => s.done && s.type !== 'warmup';

export function volume(w) {
  let v = 0;
  for (const ex of w.exercises) for (const s of ex.sets) if (counts(s)) v += s.kg * s.reps;
  return Math.round(v * 10) / 10;
}

export function doneSetCount(w) {
  return w.exercises.reduce((n, ex) => n + ex.sets.filter(s => s.done).length, 0);
}

export const elapsedSec = (w, now = Date.now()) => Math.max(0, Math.floor(((w.finishedAt ?? now) - w.startedAt) / 1000));

// Finish: drop planned sets and exercises with nothing done.
export function finishWorkout(w, now = Date.now()) {
  const next = clone(w);
  next.exercises = next.exercises
    .map(ex => ({ id: ex.id, exerciseId: ex.exerciseId, sets: ex.sets.filter(s => s.done) }))
    .filter(ex => ex.sets.length);
  next.finishedAt = now;
  next.rest = null;
  delete next.current;
  return next;
}

// ---- previous performance ----

// Most recent finished workout set list for an exercise. history: finished workouts, any order.
export function lastSession(history, exerciseId) {
  let best = null;
  for (const w of history) {
    if (best && w.startedAt <= best.startedAt) continue;
    const ex = w.exercises.find(e => e.exerciseId === exerciseId && e.sets.some(counts));
    if (ex) best = { startedAt: w.startedAt, workoutId: w.id, sets: ex.sets.filter(counts) };
  }
  return best;
}

// Values the steppers start at for the next set.
export function suggestNext(ex, last, fallbackKg = 20) {
  if (ex.draft) return { ...ex.draft };
  const pi = firstPlannedIndex(ex);
  const planned = pi === -1 ? null : ex.sets[pi];
  const li = lastDoneIndex(ex);
  const lastDone = li === -1 ? null : ex.sets[li];
  const pos = pi === -1 ? ex.sets.length : pi;
  const prev = last?.sets[Math.min(pos, last.sets.length - 1)] || null;
  const kg = planned?.kg ?? lastDone?.kg ?? prev?.kg ?? fallbackKg;
  const reps = planned?.reps ?? lastDone?.reps ?? prev?.reps ?? 8;
  return { kg, reps };
}

// Fill planned kg for a routine from the last session of each exercise.
export function planFromHistory(routine, history) {
  return {
    name: routine.name,
    routineId: routine.id,
    exercises: routine.exercises.map(e => {
      const last = lastSession(history, e.exerciseId);
      return {
        exerciseId: e.exerciseId,
        sets: e.sets.map((s, i) => ({
          reps: s.reps,
          kg: s.kg ?? last?.sets[Math.min(i, last.sets.length - 1)]?.kg ?? null
        }))
      };
    })
  };
}

// Swap the exercise at exIndex. With nothing done it's replaced in place (planned reps kept, kg cleared);
// with sets done, the new exercise goes right after it and takes over the remaining planned sets.
export function swapExercise(w, exIndex, exerciseId) {
  const ex = w.exercises[exIndex];
  if (!ex || ex.exerciseId === exerciseId) return w;
  const next = clone(w);
  const cur = next.exercises[exIndex];
  const planned = cur.sets.filter(s => !s.done).map(s => makeSet({ reps: s.reps }));
  if (!cur.sets.some(s => s.done)) {
    next.exercises[exIndex] = { id: uid(), exerciseId, sets: planned, draft: null };
    next.current = exIndex;
    return next;
  }
  if (next.exercises.length >= LIMITS.exercisesPerWorkout) throw new RangeError('too many exercises');
  cur.sets = cur.sets.filter(s => s.done);
  next.exercises.splice(exIndex + 1, 0, { id: uid(), exerciseId, sets: planned, draft: null });
  next.current = exIndex + 1;
  return next;
}
