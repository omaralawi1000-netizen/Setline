// Settings: defaults, sanitizing, localStorage. API keys are not stored here.
import { LIMITS } from './workout.js';
import { sanitizeProfile } from './profile.js';
import { sanitizeGoals } from './goals.js';
import { sanitizeTargets, sanitizeQuick } from './nutrition.js';
import { sanitizeSteps } from './progression.js';

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
  voice: 'Achird',     // Gemini prebuilt voice
  voiceV: 2,           // bumped when the default voice changes
  ttsQuality: 'natural', // natural (Flash TTS) | fast (Flash-Lite TTS)
  stt: 'fast',         // fast | accurate
  ttsModel: '',        // Flash TTS, picked from the model list on key test
  ttsLite: '',         // Flash-Lite TTS
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
  suggestions: true,
  restAlerts: false,
  restByEx: {},        // exerciseId → seconds, learned when rest is adjusted
  monthSeen: '',       // the latest monthly photo pair you've opened (its after-photo id)
  photoNudge: '',      // the month (YYYY-MM) the photo-day reminder was shown
  plateauSnooze: {},   // exerciseId → until when a stall isn't brought up again
  autoAdvance: true,   // move to the next exercise when its planned sets are done
  autoWarmup: true,    // put warm-up sets in front of the first lift for each muscle
  deloadUntil: 0,      // timestamp: deload week running until then
  deloadSnoozed: 0,    // timestamp: don't suggest a deload before then
  favMeals: [],        // starred meal names
  profile: null,       // who you are and what you train for (profile.js)
  profileAsked: 0,     // when the onboarding was shown (so it's asked once)
  goals: [],           // lift goals (goals.js)
  accent: 'violet',    // colour theme
  startTab: 'today',   // the tab the app opens on (a running workout always opens Workout)
  textSize: 'normal',  // small | normal | large
  glow: 'on',          // the coloured background glow: on | soft | off
  dockLabels: true,    // words under the tab icons
  greeting: true,      // Today's big greeting and week line
  exFigure: true,      // the moving figure on the workout screen
  exGhost: true,       // "Last time / Best" under the steppers
  fullscreen: false,   // hide the phone's status bar (edge to edge)
  foodHide: [],        // Food tab parts turned off (Customize)
  foodOrder: [],       // Food tab sections, in your order
  todayOrder: [],      // Today cards, in your order
  quickAdd: null,      // {kind: 'protein'|'kcal', values: [a, b, c]}
  kgSteps: null,       // {barbell, dumbbell, machine}: the − / + step in kg
  coachBrief: '',      // who you are and how to coach you, in your own words (the Coach follows it)
  memories: [],        // what you told the Coach that it keeps in mind [{id, text, at}]
  weeklyCheckin: true, // the Coach's Monday look back and plan
  weeklyFor: '',       // the week (its Monday) the last check-in was written for
  weeklySeen: '',      // …and the one you've opened
  foodTargets: null,   // {kcal, protein, carbs, fat, water} set by hand; null = worked out from the profile
  todayHide: ['balance', 'routines'] // Today sections tucked away (Customize)
});

export const ACCENTS = ['violet', 'ocean', 'jade', 'ember', 'rose'];
export const FOOD_PARTS = ['calories', 'carbs', 'fat', 'water', 'favourites', 'quickProtein', 'week'];
export const FOOD_ORDER = ['favourites', 'quickProtein', 'water', 'meals', 'week'];
export const TODAY_ORDER = ['checkin', 'upnext', 'plateau', 'goals', 'cardio', 'week', 'balance', 'body', 'review', 'routines'];
const order = (list, all) => {
  const out = [...new Set((Array.isArray(list) ? list : []).filter(x => all.includes(x)))];
  if (!out.length) return [...all];
  all.forEach((x, i) => { if (!out.includes(x)) { const prev = all.slice(0, i).reverse().find(p => out.includes(p)); out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, x); } }); // a new card lands by its neighbour
  return out;
};
export const foodOrderOf = s => order(s.foodOrder, FOOD_ORDER);
export const todayOrderOf = s => order(s.todayOrder, TODAY_ORDER);
export const TODAY_PARTS = ['checkin', 'plateau', 'goals', 'cardio', 'week', 'balance', 'body', 'review', 'routines'];

// Gemini prebuilt voices and how they sound.
export const VOICES = ['Achird', 'Sulafat', 'Callirrhoe', 'Puck', 'Aoede', 'Despina', 'Zubenelgenubi', 'Leda', 'Kore', 'Charon'];
export const VOICE_FEEL = { Achird: 'friendly', Sulafat: 'warm', Callirrhoe: 'easy-going', Puck: 'upbeat', Aoede: 'breezy', Despina: 'smooth', Zubenelgenubi: 'casual', Leda: 'youthful', Kore: 'firm', Charon: 'informative' };
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
  if (typeof input.restAlerts === 'boolean') s.restAlerts = input.restAlerts;
  if (typeof input.autoAdvance === 'boolean') s.autoAdvance = input.autoAdvance;
  if (typeof input.autoWarmup === 'boolean') s.autoWarmup = input.autoWarmup;
  if (input.profile) s.profile = sanitizeProfile(input.profile);
  if (Array.isArray(input.goals)) s.goals = sanitizeGoals(input.goals);
  if (Number.isFinite(input.profileAsked)) s.profileAsked = input.profileAsked;
  if (ACCENTS.includes(input.accent)) s.accent = input.accent;
  if (['today', 'workout', 'food', 'coach'].includes(input.startTab)) s.startTab = input.startTab;
  if (['small', 'normal', 'large'].includes(input.textSize)) s.textSize = input.textSize;
  if (['on', 'soft', 'off'].includes(input.glow)) s.glow = input.glow;
  for (const k of ['dockLabels', 'greeting', 'exFigure', 'exGhost']) if (typeof input[k] === 'boolean') s[k] = input[k];
  if (typeof input.fullscreen === 'boolean') s.fullscreen = input.fullscreen;
  s.foodTargets = sanitizeTargets(input.foodTargets);
  if (Array.isArray(input.foodOrder)) s.foodOrder = order(input.foodOrder, FOOD_ORDER);
  if (Array.isArray(input.todayOrder)) s.todayOrder = order(input.todayOrder, TODAY_ORDER);
  if (input.quickAdd) s.quickAdd = sanitizeQuick(input.quickAdd);
  s.kgSteps = sanitizeSteps(input.kgSteps);
  s.memories = sanitizeMemories(input.memories);
  if (typeof input.weeklyCheckin === 'boolean') s.weeklyCheckin = input.weeklyCheckin;
  for (const k of ['weeklyFor', 'weeklySeen']) if (typeof input[k] === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(input[k])) s[k] = input[k];
  if (Array.isArray(input.foodHide)) s.foodHide = [...new Set(input.foodHide.filter(x => FOOD_PARTS.includes(x)))];
  if (Array.isArray(input.todayHide)) s.todayHide = [...new Set(input.todayHide.filter(x => TODAY_PARTS.includes(x)))];
  if (Array.isArray(input.favMeals)) s.favMeals = input.favMeals.filter(x => typeof x === 'string' && x.length <= 60).slice(0, 30);
  for (const k of ['deloadUntil', 'deloadSnoozed']) if (Number.isFinite(input[k]) && input[k] >= 0) s[k] = input[k];
  if (typeof input.coachBrief === 'string') s.coachBrief = input.coachBrief.slice(0, 5000);
  if (typeof input.monthSeen === 'string' && input.monthSeen.length <= 80) s.monthSeen = input.monthSeen;
  if (typeof input.photoNudge === 'string' && /^(\d{4}-\d{2})?$/.test(input.photoNudge)) s.photoNudge = input.photoNudge;
  if (input.plateauSnooze && typeof input.plateauSnooze === 'object') {
    s.plateauSnooze = {};
    for (const [k, v] of Object.entries(input.plateauSnooze).slice(-100)) if (typeof k === 'string' && k.length <= 80 && Number.isFinite(v) && v > 0) s.plateauSnooze[k] = v;
  }
  if (input.restByEx && typeof input.restByEx === 'object') {
    s.restByEx = {};
    for (const [k, v] of Object.entries(input.restByEx).slice(-200)) {
      if (typeof k === 'string' && k.length <= 80 && Number.isFinite(v)) s.restByEx[k] = Math.min(LIMITS.restMax, Math.max(LIMITS.restMin, Math.round(v / 15) * 15));
    }
  }
  if (['auto', 'da', 'en'].includes(input.voiceLang)) s.voiceLang = input.voiceLang;
  if (['hold', 'tap'].includes(input.micMode)) s.micMode = input.micMode;
  if (['off', 'minimal', 'full'].includes(input.spoken)) s.spoken = input.spoken;
  // the old default (Kore, firm) moves to the new friendlier default once
  if (VOICES.includes(input.voice) && (input.voiceV === 2 || input.voice !== 'Kore')) s.voice = input.voice;
  if (['natural', 'fast'].includes(input.ttsQuality)) s.ttsQuality = input.ttsQuality;
  if (['fast', 'accurate'].includes(input.stt)) s.stt = input.stt;
  for (const k of ['ttsModel', 'ttsLite', 'ttsOverride', 'cmdModel', 'coachModel', 'cmdOverride', 'coachOverride', 'cmdAlt', 'coachAlt']) if (typeof input[k] === 'string' && (input[k] === '' || MODEL_ID.test(input[k].trim()))) s[k] = input[k].trim();
  return s;
}

export function sanitizeMemories(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(m => m && typeof m.id === 'string' && typeof m.text === 'string' && m.text.trim() && Number.isFinite(m.at))
    .map(m => ({ id: m.id.slice(0, 60), text: m.text.trim().slice(0, 140), at: m.at })).slice(-40);
}

export const cmdModelId = s => s.cmdOverride || s.cmdModel || 'gemini-flash-lite-latest';
export const coachModelId = s => s.coachOverride || s.coachModel || 'gemini-flash-latest';
// the order to try: chosen, runner-up, rolling alias
export const cmdModels = s => [cmdModelId(s), s.cmdOverride ? '' : s.cmdAlt, 'gemini-flash-lite-latest'];
// Flash first; the Flash-Lite models have their own (bigger) free quotas, so they're the last resort
export const coachModels = s => [coachModelId(s), s.coachOverride ? '' : s.coachAlt, 'gemini-flash-latest', s.cmdModel, 'gemini-flash-lite-latest'];
export const ttsModelId = s => s.ttsOverride || (s.ttsQuality === 'fast' ? s.ttsLite || s.ttsModel : s.ttsModel || s.ttsLite) || DEFAULT_TTS_MODEL;
// runner-up voice model: the other family
export const ttsAlt = s => (s.ttsOverride ? [] : [s.ttsQuality === 'fast' ? s.ttsModel : s.ttsLite, DEFAULT_TTS_MODEL].filter(Boolean));
export const sttModelId = s => (s.stt === 'accurate' ? 'whisper-large-v3' : 'whisper-large-v3-turbo');

export function loadSettings(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(SETTINGS_KEY) || 'null')); }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(s, storage = globalThis.localStorage) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(sanitize(s))); } catch { /* storage full or blocked */ }
}
