// Every value the hold-to-talk interaction, the frost and the sheets move by, in one place. The
// dev tuning panel (?tune=1, js/ui/tune.js) edits them live and keeps them in localStorage; without
// the flag the defaults below are what runs. Copy the panel's values back here to make them stick.
export const DEFAULTS = {
  // the frost: one full-screen layer, its blur never animates (only the layer's opacity does)
  frostBlur: 20,          // px
  frostSat: 170,          // %
  frostBright: 0.85,
  tintTop: 0.40,          // theme background over the frost, top …
  tintBottom: 0.60,       // … to bottom
  grain: 0.035,           // the noise tile's opacity
  frostFadeMs: 220,
  // hold to talk
  holdMs: 250,            // held this long: it's a hold (shorter, and still: a tap)
  tapSlopPx: 10,
  lockPx: 80,             // dragged up this far: the review sheet locks open
  cancelPx: 80,           // dragged down this far: cancelled
  follow: 0.4,            // the orb follows the finger at this fraction of its movement
  orbRestPct: 50,         // the orb's centre while you hold, as % of the screen's height
  pressScale: 1.08,
  reviewScale: 0.6,       // the orb at the top of the review sheet
  reviewHeightPct: 88,
  // one spring for everything (critically damped when damping = 2·√stiffness)
  stiffness: 170,
  damping: 26
};

const KEY = 'setline.tune';
const listeners = new Set();
let stored = {};
try { if (/[?&]tune=1\b/.test(location.search) || localStorage.getItem('setline.tuneOn')) stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }

export const M = { ...DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([k, v]) => k in DEFAULTS && typeof v === 'number')) };
export let slowmo = 1; // ×4 from the panel: every spring and fade runs four times slower

export function setValue(k, v) {
  if (!(k in DEFAULTS) || !Number.isFinite(v)) return;
  M[k] = v;
  save();
  for (const fn of listeners) fn(k);
}
export function reset() {
  Object.assign(M, DEFAULTS);
  save();
  for (const fn of listeners) fn(null);
}
export function setSlowmo(on) {
  slowmo = on ? 4 : 1;
  for (const fn of listeners) fn('slowmo');
}
export const onTune = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function save() {
  try {
    const diff = Object.fromEntries(Object.entries(M).filter(([k, v]) => DEFAULTS[k] !== v));
    localStorage.setItem(KEY, JSON.stringify(diff));
  } catch { /* private mode: live only */ }
}

// The frost's look lives in CSS custom properties, set once here (and again when the panel edits them).
export function applyCss(root = document.documentElement) {
  const s = root.style;
  s.setProperty('--frost-blur', `${M.frostBlur}px`);
  s.setProperty('--frost-sat', `${M.frostSat}%`);
  s.setProperty('--frost-bright', String(M.frostBright));
  s.setProperty('--tint-top', `${Math.round(M.tintTop * 100)}%`);
  s.setProperty('--tint-bottom', `${Math.round(M.tintBottom * 100)}%`);
  s.setProperty('--grain', String(M.grain));
  s.setProperty('--frost-ms', `${Math.round(M.frostFadeMs * slowmo)}ms`);
  s.setProperty('--slowmo', String(slowmo));
}
