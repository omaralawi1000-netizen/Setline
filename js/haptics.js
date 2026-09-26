// navigator.vibrate behind the haptics setting.
// every animation has its feel: a tick for moving around, a firm press for logging, a double for records
const PATTERNS = { tick: 6, tap: 10, open: [8, 24, 14], success: [20, 30, 20], log: [28], pr: [30, 60, 30, 60, 60], bloom: [6, 34, 8, 30, 12, 26, 18], land: [14], error: 40 };
let enabled = () => true;
export const setHapticsGate = fn => { enabled = fn; };
export function haptic(kind = 'tap') {
  if (!enabled() || !navigator.vibrate) return;
  try { navigator.vibrate(PATTERNS[kind] ?? 10); } catch {}
}
