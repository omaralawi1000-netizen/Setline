// Warm-up ramp before the first working set. Pure.
// Empty bar, then ~50%, ~70%, ~85% of the working weight, rounded to 2.5 kg; skips steps that aren't lighter.
export function warmupRamp(workKg, { bar = 20, round = 2.5 } = {}) {
  if (!Number.isFinite(workKg) || workKg <= bar) return [];
  const r = v => Math.round(v / round) * round;
  const steps = [[bar, 10], [r(workKg * 0.5), 5], [r(workKg * 0.7), 3], [r(workKg * 0.85), 2]];
  const out = [];
  for (const [kg, reps] of steps) {
    if (kg >= workKg || kg < bar || out.some(s => s.kg === kg)) continue;
    out.push({ kg, reps, type: 'warmup' });
  }
  return out;
}
