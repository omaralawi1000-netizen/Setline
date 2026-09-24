// Settings: defaults, sanitizing, localStorage. API keys are not stored here.
import { LIMITS } from './workout.js';

export const SETTINGS_KEY = 'setline.settings';

export const DEFAULTS = Object.freeze({
  lang: 'auto',        // auto | da | en
  unit: 'kg',          // kg | lb
  restSec: 90,
  haptics: true,
  motion: 'auto'       // auto | on | off
});

export function sanitize(input) {
  const s = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return s;
  if (['auto', 'da', 'en'].includes(input.lang)) s.lang = input.lang;
  if (['kg', 'lb'].includes(input.unit)) s.unit = input.unit;
  if (Number.isFinite(input.restSec)) s.restSec = Math.min(LIMITS.restMax, Math.max(LIMITS.restMin, Math.round(input.restSec / 15) * 15));
  if (typeof input.haptics === 'boolean') s.haptics = input.haptics;
  if (['auto', 'on', 'off'].includes(input.motion)) s.motion = input.motion;
  return s;
}

export function loadSettings(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(SETTINGS_KEY) || 'null')); }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(s, storage = globalThis.localStorage) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(s))); } catch { /* storage full or blocked */ }
}
