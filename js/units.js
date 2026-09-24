// Unit conversion. Everything is stored in kg; lb exists only at the edges.
export const LB_PER_KG = 2.20462262185;

export const round = (n, dp = 0) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const kgToLb = kg => kg * LB_PER_KG;
export const lbToKg = lb => lb / LB_PER_KG;

// kg -> number shown in the chosen unit.
export function toDisplay(kg, unit) {
  if (kg == null) return null;
  return unit === 'lb' ? round(kgToLb(kg), 1) : round(kg, 2);
}

// Number typed in the chosen unit -> kg for storage.
export function fromDisplay(value, unit) {
  if (value == null || !Number.isFinite(value)) return null;
  return unit === 'lb' ? round(lbToKg(value), 4) : round(value, 3);
}

export const weightStep = unit => (unit === 'lb' ? 5 : 2.5);

// Step the weight in display units so the shown number stays clean.
export function stepWeight(kg, dir, unit) {
  const shown = toDisplay(kg ?? 0, unit);
  const step = weightStep(unit);
  let next = dir > 0 ? Math.floor(shown / step + 1e-9) * step + step : Math.ceil(shown / step - 1e-9) * step - step;
  next = Math.max(0, round(next, 2));
  return fromDisplay(next, unit);
}

// Parse user input like "82,5" or "82.5".
export function parseNumber(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (typeof text !== 'string') return null;
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
