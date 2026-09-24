// Starter routines. Pure.

const sets = (n, reps) => Array.from({ length: n }, () => ({ reps, kg: null }));

export function starterRoutines() {
  return [{
    id: 'push-day',
    name: 'Push day',
    names: { en: 'Push day', da: 'Push-dag' },
    exercises: [
      { exerciseId: 'bench-press', sets: sets(4, 8) },
      { exerciseId: 'overhead-press', sets: sets(3, 8) },
      { exerciseId: 'incline-dumbbell-press', sets: sets(3, 10) },
      { exerciseId: 'lateral-raise', sets: sets(3, 12) },
      { exerciseId: 'triceps-pushdown', sets: sets(3, 12) }
    ],
    createdAt: 0
  }];
}

export const routineName = (r, lang) => r.names?.[lang] || r.name;

// ~3.5 min per set including rest, rounded to 5 minutes.
export function estimateMinutes(routine) {
  const n = routine.exercises.reduce((a, e) => a + e.sets.length, 0);
  return Math.max(5, Math.round((n * 3.5) / 5) * 5);
}
