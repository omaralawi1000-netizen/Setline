// Routines: starter programs, editing helpers, what's next. Pure.

const sets = (n, reps) => Array.from({ length: n }, () => ({ reps, kg: null }));
const ex = (exerciseId, n, reps) => ({ exerciseId, sets: sets(n, reps) });
const uid = () => 'r-' + globalThis.crypto.randomUUID();

export const LIMITS = { exercises: 20, sets: 10, name: 40 };

export function starterRoutines() {
  return [{
    id: 'push-day',
    name: 'Push day',
    names: { en: 'Push day', da: 'Push-dag' },
    exercises: [ex('bench-press', 4, 8), ex('overhead-press', 3, 8), ex('incline-dumbbell-press', 3, 10), ex('lateral-raise', 3, 12), ex('triceps-pushdown', 3, 12)],
    createdAt: 0
  }];
}

// Starter programs the user can add in one tap.
export const PROGRAMS = [
  {
    id: 'ppl', en: 'Push / Pull / Legs', da: 'Push / Pull / Ben', perWeek: 3,
    routines: [
      { key: 'push', en: 'Push day', da: 'Push-dag', exercises: [ex('bench-press', 4, 8), ex('overhead-press', 3, 8), ex('incline-dumbbell-press', 3, 10), ex('lateral-raise', 3, 12), ex('triceps-pushdown', 3, 12)] },
      { key: 'pull', en: 'Pull day', da: 'Pull-dag', exercises: [ex('deadlift', 3, 5), ex('pull-up', 3, 8), ex('barbell-row', 3, 8), ex('face-pull', 3, 15), ex('barbell-curl', 3, 10)] },
      { key: 'legs', en: 'Leg day', da: 'Ben-dag', exercises: [ex('back-squat', 4, 6), ex('romanian-deadlift', 3, 8), ex('leg-press', 3, 10), ex('lying-leg-curl', 3, 12), ex('standing-calf-raise', 4, 12)] }
    ]
  },
  {
    id: 'ul', en: 'Upper / Lower', da: 'Overkrop / Underkrop', perWeek: 4,
    routines: [
      { key: 'upper', en: 'Upper', da: 'Overkrop', exercises: [ex('bench-press', 4, 6), ex('barbell-row', 4, 8), ex('overhead-press', 3, 8), ex('lat-pulldown', 3, 10), ex('dumbbell-curl', 2, 12), ex('triceps-pushdown', 2, 12)] },
      { key: 'lower', en: 'Lower', da: 'Underkrop', exercises: [ex('back-squat', 4, 6), ex('romanian-deadlift', 3, 8), ex('bulgarian-split-squat', 3, 10), ex('leg-extension', 2, 12), ex('standing-calf-raise', 3, 12), ex('hanging-leg-raise', 3, 12)] }
    ]
  },
  {
    id: 'fb3', en: 'Full body 3×', da: 'Hele kroppen 3×', perWeek: 3,
    routines: [
      { key: 'a', en: 'Full body A', da: 'Hele kroppen A', exercises: [ex('back-squat', 3, 5), ex('bench-press', 3, 5), ex('barbell-row', 3, 8), ex('plank', 3, 1)] },
      { key: 'b', en: 'Full body B', da: 'Hele kroppen B', exercises: [ex('deadlift', 3, 5), ex('overhead-press', 3, 6), ex('pull-up', 3, 8), ex('walking-lunge', 2, 10)] },
      { key: 'c', en: 'Full body C', da: 'Hele kroppen C', exercises: [ex('front-squat', 3, 6), ex('incline-dumbbell-press', 3, 10), ex('seated-cable-row', 3, 10), ex('hip-thrust', 3, 10)] }
    ]
  }
];

// Routine records for a program, named in the given language.
export function programRoutines(programId, lang, now = Date.now()) {
  const p = PROGRAMS.find(x => x.id === programId);
  if (!p) return [];
  return p.routines.map((r, i) => ({ id: uid(), name: lang === 'da' ? r.da : r.en, program: p.id, exercises: structuredClone(r.exercises), createdAt: now + i }));
}

export const routineName = (r, lang) => r.names?.[lang] || r.name;

// ~3.5 min per set including rest, rounded to 5 minutes.
export function estimateMinutes(routine) {
  const n = routine.exercises.reduce((a, e) => a + e.sets.length, 0);
  return Math.max(5, Math.round((n * 3.5) / 5) * 5);
}

// ---------- editing (all return new routines) ----------

export function newRoutine(name = '', now = Date.now()) {
  return { id: uid(), name, exercises: [], createdAt: now };
}

export function renameRoutine(r, name) {
  const n = String(name).trim().replace(/\s+/g, ' ').slice(0, LIMITS.name);
  const next = { ...r, name: n };
  delete next.names; // a renamed starter routine keeps the user's name in every language
  return next;
}

export function addRoutineExercise(r, exerciseId, n = 3, reps = 10) {
  if (r.exercises.length >= LIMITS.exercises) return r;
  return { ...r, exercises: [...r.exercises, ex(exerciseId, n, reps)] };
}

export function removeRoutineExercise(r, i) {
  return { ...r, exercises: r.exercises.filter((_, k) => k !== i) };
}

export function moveRoutineExercise(r, from, to) {
  if (from === to || from < 0 || to < 0 || from >= r.exercises.length || to >= r.exercises.length) return r;
  const list = [...r.exercises];
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return { ...r, exercises: list };
}

// Set count and reps for one exercise (reps applies to every set).
export function setRoutineSets(r, i, n, reps) {
  const e = r.exercises[i];
  if (!e) return r;
  const count = Math.max(1, Math.min(LIMITS.sets, Math.round(n)));
  const rp = Math.max(1, Math.min(100, Math.round(reps)));
  const list = r.exercises.map((x, k) => (k === i ? { ...x, sets: Array.from({ length: count }, (_, j) => ({ reps: rp, kg: x.sets[j]?.kg ?? null })) } : x));
  return { ...r, exercises: list };
}

export function duplicateRoutine(r, lang, now = Date.now()) {
  const copy = structuredClone(r);
  copy.id = uid();
  copy.name = `${routineName(r, lang)} ${lang === 'da' ? '(kopi)' : '(copy)'}`.slice(0, LIMITS.name);
  delete copy.names;
  delete copy.program;
  copy.createdAt = now;
  return copy;
}

export function validRoutine(r) {
  return !!r && typeof r.name === 'string' && r.name.trim().length >= 1 && r.exercises.length >= 1 &&
    r.exercises.every(e => e.sets.length >= 1 && e.sets.every(s => Number.isInteger(s.reps) && s.reps >= 1));
}

// Which weekday a routine belongs to (0 = Sunday … 6 = Saturday): set in the editor, or read from
// its name ("Monday: Legs + Shoulders", "Mandag – ben"). null when it floats.
const DAY_WORDS = [['sunday', 'søndag', 'sun', 'søn'], ['monday', 'mandag', 'mon', 'man'], ['tuesday', 'tirsdag', 'tue', 'tues', 'tir'], ['wednesday', 'onsdag', 'wed', 'ons'],
  ['thursday', 'torsdag', 'thu', 'thur', 'thurs', 'tor'], ['friday', 'fredag', 'fri', 'fre'], ['saturday', 'lørdag', 'sat', 'lør']];
export function routineDay(r) {
  if (r?.weekday === -1) return null; // "any day", even if the name says a day
  if (Number.isInteger(r?.weekday) && r.weekday >= 0 && r.weekday <= 6) return r.weekday;
  const n = String(r?.name || '').toLowerCase();
  for (let i = 0; i < 7; i++) if (DAY_WORDS[i].some(w => new RegExp(`(^|[^a-zæøå])${w}([^a-zæøå]|$)`).test(n) && (w.length > 3 || /^\s*\S{3,4}\b[\s:.,–-]/.test(n)))) return i;
  return null;
}
// "Monday: Legs + Shoulders" → "Legs + Shoulders" (the day is shown on its own)
export const withoutDay = name => String(name || '').replace(/^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s*[:.,–—-]?\s*/i, '') || name;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// The routine to do next: today's (by weekday) if it isn't done yet, else the one done least
// recently (never done first, in list order).
export function nextRoutine(routines, history, now = Date.now()) {
  if (!routines.length) return null;
  const today = routines.find(r => routineDay(r) === new Date(now).getDay());
  if (today && !history.some(w => sameDay(w.startedAt, now))) return today;
  const last = id => Math.max(0, ...history.filter(w => w.routineId === id).map(w => w.startedAt));
  return [...routines].sort((a, b) => last(a.id) - last(b.id) || (a.createdAt || 0) - (b.createdAt || 0))[0];
}
