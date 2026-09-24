// Backup export/import. Pure: builds and validates plain objects. Keys are never included.
import { SCHEMA_VERSION } from './db.js';
import { sanitize } from './settings.js';
import { CARDIO_TYPES } from './cardio.js';
import { validThumb } from './meals.js';

export const BACKUP_KIND = 'setline-backup';
const MAX = { workouts: 20000, cardio: 20000, routines: 500, exercises: 1000, prs: 50000, bodyweight: 20000, nutrition: 20000, chat: 5000 };

export function makeBackup(state, now = Date.now()) {
  const { ttsModel, ttsLite, cmdModel, coachModel, cmdAlt, coachAlt, ...settings } = state.settings;
  void ttsModel; void ttsLite; void cmdModel; void coachModel; void cmdAlt; void coachAlt;
  return {
    kind: BACKUP_KIND, version: 1, schema: SCHEMA_VERSION, exportedAt: new Date(now).toISOString(),
    data: {
      workouts: state.history, cardio: state.cardio, routines: state.routines, exercises: state.custom, prs: state.prs,
      bodyweight: state.bodyweight, nutrition: state.nutrition, chat: state.chat.filter(m => !m.streaming), settings
    }
  };
}

const isStr = (v, max = 200) => typeof v === 'string' && v.length <= max;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isId = v => isStr(v, 120) && v.length > 0;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ts = v => isNum(v, 946684800000, 4102444800000); // 2000..2100

function set(s) {
  return s && isId(s.id) && ['normal', 'warmup', 'drop', 'failure'].includes(s.type) && typeof s.done === 'boolean' &&
    (s.kg === null || isNum(s.kg, 0, 1500)) && (s.reps === null || (Number.isInteger(s.reps) && s.reps >= 1 && s.reps <= 300));
}
function workout(w) {
  return w && isId(w.id) && ts(w.startedAt) && (w.finishedAt == null || ts(w.finishedAt)) && Array.isArray(w.exercises) && w.exercises.length <= 60 &&
    w.exercises.every(e => e && isId(e.exerciseId) && Array.isArray(e.sets) && e.sets.length <= 100 && e.sets.every(set));
}
function routine(r) {
  return r && isId(r.id) && isStr(r.name, 80) && Array.isArray(r.exercises) && r.exercises.length <= 30 &&
    r.exercises.every(e => e && isId(e.exerciseId) && Array.isArray(e.sets) && e.sets.length >= 1 && e.sets.length <= 20 && e.sets.every(s => Number.isInteger(s.reps) && s.reps >= 1 && s.reps <= 300));
}
const cardioOk = c => c && isId(c.id) && CARDIO_TYPES.some(t => t.id === c.type) && ts(c.startedAt) && isNum(c.durationSec, 1, 43200) && (c.distanceKm == null || isNum(c.distanceKm, 0, 400)) && (c.zone == null || [1, 2, 3, 4, 5].includes(c.zone));
const exerciseOk = e => e && isId(e.id) && isStr(e.en, 80) && isStr(e.da, 80) && Array.isArray(e.muscles) && isStr(e.equipment, 40);
const prOk = p => p && isId(p.id) && isId(p.exerciseId) && ['weight', 'e1rm', 'reps'].includes(p.kind) && isNum(p.kg, 0, 1500);
const bwOk = b => b && isDate(b.date) && isNum(b.kg, 20, 400);
const mealOk = m => m && isId(m.id) && ts(m.t) && isStr(m.name, 80) && isNum(m.protein, 0, 300) && isNum(m.kcal, 0, 5000) && (m.thumb === undefined || validThumb(m.thumb));
const nutOk = n => n && isDate(n.date) && isNum(n.protein, 0, 1000) && (n.kcal === undefined || isNum(n.kcal, 0, 20000)) &&
  (n.meals === undefined || (Array.isArray(n.meals) && n.meals.length <= 60 && n.meals.every(mealOk)));
const chatOk = m => m && isId(m.id) && ['user', 'model'].includes(m.role) && typeof m.text === 'string' && m.text.length <= 20000;

// Validate everything before anything is written. Returns {ok, data?, error?}.
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.kind !== BACKUP_KIND) return { ok: false, error: 'kind' };
  if (!Number.isInteger(obj.version) || obj.version > 1) return { ok: false, error: 'version' };
  const d = obj.data;
  if (!d || typeof d !== 'object') return { ok: false, error: 'data' };
  const checks = { workouts: workout, cardio: cardioOk, routines: routine, exercises: exerciseOk, prs: prOk, bodyweight: bwOk, nutrition: nutOk, chat: chatOk };
  const out = {};
  for (const [k, ok] of Object.entries(checks)) {
    const list = d[k] ?? [];
    if (!Array.isArray(list) || list.length > MAX[k]) return { ok: false, error: k };
    const bad = list.findIndex(x => !ok(x));
    if (bad !== -1) return { ok: false, error: `${k}[${bad}]` };
    out[k] = list;
  }
  // any stray API key in settings is dropped by sanitize
  out.settings = sanitize(d.settings || {});
  return { ok: true, data: out };
}
