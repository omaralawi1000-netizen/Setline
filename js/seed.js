// Dev-only sample history, loaded only with ?seed=1. Runs once per database.
import * as db from './db.js';
import { makeSet } from './workout.js';

const DAY = 86_400_000;

export async function seed(store) {
  if (await db.get('meta', 'devSeeded')) return;
  const plan = [
    ['bench-press', 70, 8, 4], ['overhead-press', 45, 8, 3], ['incline-dumbbell-press', 24, 10, 3],
    ['lateral-raise', 10, 12, 3], ['triceps-pushdown', 25, 12, 3]
  ];
  const now = Date.now();
  const workouts = [];
  for (let k = 0; k < 6; k++) {
    const start = now - (6 - k) * 3.5 * DAY - 2 * 3600_000;
    let t = start + 5 * 60_000;
    workouts.push({
      id: 'seed-' + k,
      name: 'Push day',
      routineId: 'push-day',
      startedAt: start,
      finishedAt: start + 52 * 60_000,
      exercises: plan.map(([exerciseId, kg, reps, n]) => ({
        id: 'seed-' + k + '-' + exerciseId,
        exerciseId,
        sets: Array.from({ length: n }, (_, i) => makeSet({
          kg: kg + Math.floor(k / 2) * 2.5, reps: i === n - 1 && k % 2 ? reps - 1 : reps, done: true, completedAt: (t += 150_000)
        }))
      }))
    });
  }
  await store.importHistory(workouts);
  await db.put('meta', true, 'devSeeded');
}
