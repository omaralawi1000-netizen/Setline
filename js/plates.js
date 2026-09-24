// Plate calculator. Pure. Plates are per side.
export const BARS = [20, 15, 10, 0];
export const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

// {perSide: [25, 20, 2.5], total, remainder} — greedy works for this plate set.
export function platesFor(targetKg, bar = 20, available = PLATES) {
  if (!Number.isFinite(targetKg) || targetKg < bar) return { perSide: [], total: bar, remainder: Math.max(0, Math.round((targetKg - bar) * 100) / 100), under: targetKg < bar };
  let side = Math.round(((targetKg - bar) / 2) * 1000) / 1000;
  const perSide = [];
  for (const p of available) {
    while (side + 1e-9 >= p) { perSide.push(p); side = Math.round((side - p) * 1000) / 1000; }
  }
  const total = bar + perSide.reduce((a, p) => a + p, 0) * 2;
  return { perSide, total: Math.round(total * 100) / 100, remainder: Math.round((targetKg - total) * 100) / 100, under: false };
}
