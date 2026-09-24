// Settings: defaults, sanitizing, localStorage. API keys are not stored here.
import { LIMITS } from './workout.js';

export const SETTINGS_KEY = 'setline.settings';

export const DEFAULTS = Object.freeze({
  lang: 'auto',        // auto | da | en
  unit: 'kg',          // kg | lb
  restSec: 90,
  haptics: true,
  motion: 'auto',      // auto | on | off
  voiceLang: 'auto',   // auto | da | en (speech-to-text)
  micMode: 'hold',     // hold | tap
  spoken: 'minimal',   // off | minimal | full
  voice: 'Kore',       // Gemini prebuilt voice
  stt: 'fast',         // fast | accurate
  ttsModel: '',        // picked from the model list on key test
  ttsOverride: '',     // manual model id
  weeklyGoal: 3,       // workouts per week, Today ring
  cmdModel: '',        // Flash-Lite text model for command fallback (picked on key test)
  coachModel: '',      // Flash text model for the Coach
  cmdOverride: '',
  coachOverride: '',
  cmdAlt: '',          // runner-up models, tried on 503/429/404
  coachAlt: '',
  cardioGoal: 150,     // minutes per week
  proteinPerKg: 1.8,
  readiness: true,
  suggestions: true
});

export const VOICES = ['Kore', 'Puck', 'Aoede', 'Charon', 'Leda', 'Orus', 'Zephyr', 'Fenrir'];
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const MODEL_ID = /^[a-z0-9][a-z0-9.\-]{2,80}$/;

export function sanitize(input) {
  const s = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return s;
  if (['auto', 'da', 'en'].includes(input.lang)) s.lang = input.lang;
  if (['kg', 'lb'].includes(input.unit)) s.unit = input.unit;
  if (Number.isFinite(input.restSec)) s.restSec = Math.min(LIMITS.restMax, Math.max(LIMITS.restMin, Math.round(input.restSec / 15) * 15));
  if (typeof input.haptics === 'boolean') s.haptics = input.haptics;
  if (['auto', 'on', 'off'].includes(input.motion)) s.motion = input.motion;
  if (Number.isInteger(input.weeklyGoal) && input.weeklyGoal >= 1 && input.weeklyGoal <= 7) s.weeklyGoal = input.weeklyGoal;
  if (Number.isFinite(input.cardioGoal)) s.cardioGoal = Math.min(900, Math.max(30, Math.round(input.cardioGoal / 15) * 15));
  if (Number.isFinite(input.proteinPerKg)) s.proteinPerKg = Math.min(2.6, Math.max(1.2, Math.round(input.proteinPerKg * 10) / 10));
  if (typeof input.readiness === 'boolean') s.readiness = input.readiness;
  if (typeof input.suggestions === 'boolean') s.suggestions = input.suggestions;
  if (['auto', 'da', 'en'].includes(input.voiceLang)) s.voiceLang = input.voiceLang;
  if (['hold', 'tap'].includes(input.micMode)) s.micMode = input.micMode;
  if (['off', 'minimal', 'full'].includes(input.spoken)) s.spoken = input.spoken;
  if (VOICES.includes(input.voice)) s.voice = input.voice;
  if (['fast', 'accurate'].includes(input.stt)) s.stt = input.stt;
  for (const k of ['ttsModel', 'ttsOverride', 'cmdModel', 'coachModel', 'cmdOverride', 'coachOverride', 'cmdAlt', 'coachAlt']) if (typeof input[k] === 'string' && (input[k] === '' || MODEL_ID.test(input[k].trim()))) s[k] = input[k].trim();
  return s;
}

export const cmdModelId = s => s.cmdOverride || s.cmdModel || 'gemini-flash-lite-latest';
export const coachModelId = s => s.coachOverride || s.coachModel || 'gemini-flash-latest';
// the order to try: chosen, runner-up, rolling alias
export const cmdModels = s => [cmdModelId(s), s.cmdOverride ? '' : s.cmdAlt, 'gemini-flash-lite-latest'];
export const coachModels = s => [coachModelId(s), s.coachOverride ? '' : s.coachAlt, 'gemini-flash-latest'];
export const ttsModelId = s => s.ttsOverride || s.ttsModel || DEFAULT_TTS_MODEL;
export const sttModelId = s => (s.stt === 'accurate' ? 'whisper-large-v3' : 'whisper-large-v3-turbo');

export function loadSettings(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(SETTINGS_KEY) || 'null')); }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(s, storage = globalThis.localStorage) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(s))); } catch { /* storage full or blocked */ }
}
