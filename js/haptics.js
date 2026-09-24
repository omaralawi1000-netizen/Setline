// navigator.vibrate behind the haptics setting.
const PATTERNS = { tap: 10, success: [20, 30, 20], error: 40 };
let enabled = () => true;
export const setHapticsGate = fn => { enabled = fn; };
export function haptic(kind = 'tap') {
  if (!enabled() || !navigator.vibrate) return;
  try { navigator.vibrate(PATTERNS[kind] ?? 10); } catch {}
}
