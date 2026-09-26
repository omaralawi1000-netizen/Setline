// navigator.vibrate behind the haptics setting.
// Smooth, not buzzy: a phone motor can't vary its strength, so long pulses and fast trains read as a
// buzz. Every feel is one short pulse, or two with a real gap between them (a knock, then a softer one).
const PATTERNS = { tick: 5, tap: 8, open: 9, success: [12, 90, 9], log: 14, pr: [14, 110, 10, 110, 18], bloom: 7, land: 18, error: [18, 90, 18] };
let enabled = () => true;
export const setHapticsGate = fn => { enabled = fn; };
export function haptic(kind = 'tap') {
  if (!enabled() || !navigator.vibrate) return;
  try { navigator.vibrate(PATTERNS[kind] ?? 10); } catch {}
}
