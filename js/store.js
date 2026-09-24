// App state + persistence. The active workout is written to IndexedDB on every change.
import * as db from './db.js';
import { createCatalog } from './catalog.js';
import { starterRoutines } from './routines.js';
import { loadSettings, saveSettings, sanitize, SETTINGS_KEY } from './settings.js';
import { resolveLang, translator } from './i18n.js';
import { createWorkout, finishWorkout, doneSetCount } from './workout.js';
import { applyWorkout } from './pr.js';

const listeners = new Set();
const UNDO_MAX = 20;

export const state = {
  settings: loadSettings(),
  lang: 'en',
  t: translator('en'),
  catalog: createCatalog(),
  custom: [],
  routines: [],
  history: [],     // finished workouts, newest first
  prs: [],         // PR records
  usage: {},       // exerciseId -> number of workouts
  active: null,
  undo: [],
  error: null
};

export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = (reason) => { for (const fn of listeners) fn(reason); };

function applyLang() {
  state.lang = resolveLang(state.settings.lang, globalThis.navigator?.language);
  state.t = translator(state.lang);
}

function computeUsage() {
  const u = {};
  for (const w of state.history) for (const id of new Set(w.exercises.map(e => e.exerciseId))) u[id] = (u[id] || 0) + 1;
  state.usage = u;
}

export async function init() {
  applyLang();
  const [custom, routines, workouts, prs, active] = await Promise.all([
    db.getAll('exercises'), db.getAll('routines'), db.getAll('workouts'), db.getAll('prs'), db.get('meta', 'activeWorkout')
  ]);
  state.custom = custom;
  state.catalog = createCatalog(custom);
  state.routines = routines;
  if (!routines.length && !(await db.get('meta', 'seededRoutines'))) {
    state.routines = starterRoutines();
    await db.tx(['routines', 'meta'], 'readwrite', s => {
      for (const r of state.routines) s.routines.put(r);
      s.meta.put(true, 'seededRoutines');
    });
  }
  state.history = workouts.sort((a, b) => b.startedAt - a.startedAt);
  state.prs = prs;
  state.active = active || null;
  computeUsage();
  emit('init');
}

// ---- active workout persistence: serialized, latest value wins ----
let writing = Promise.resolve();
function persistActive() {
  const value = state.active;
  writing = writing.then(() => (value ? db.put('meta', value, 'activeWorkout') : db.del('meta', 'activeWorkout')))
    .then(() => { if (state.error) { state.error = null; emit('error'); } })
    .catch(e => { console.error('save failed', e.name); state.error = 'storage'; emit('error'); });
  return writing;
}
export const flush = () => writing;

export function startWorkout(template) {
  if (state.active) return state.active;
  state.active = createWorkout(template);
  state.undo = [];
  persistActive();
  emit('start');
  return state.active;
}

// Apply a pure update to the active workout. undo: label to allow undoing it.
export function update(fn, { undo = null, reason = 'update' } = {}) {
  if (!state.active) return null;
  const before = state.active;
  const next = fn(before);
  if (!next || next === before) return null;
  state.active = next;
  if (undo) {
    state.undo.push({ label: undo, before });
    if (state.undo.length > UNDO_MAX) state.undo.shift();
  }
  persistActive();
  emit(reason);
  return next;
}

export function undo() {
  const u = state.undo.pop();
  if (!u || !state.active) return false;
  state.active = u.before;
  persistActive();
  emit('undo');
  return true;
}

export async function finish() {
  const w = state.active;
  if (!w) return null;
  const done = finishWorkout(w);
  if (!doneSetCount(done)) { await discard(); return null; }
  const { records, prs } = applyWorkout(state.prs, done);
  done.prs = prs;
  await writing;
  await db.tx(['workouts', 'prs', 'meta'], 'readwrite', s => {
    s.workouts.put(done);
    for (const r of records) s.prs.put(r);
    s.meta.delete('activeWorkout');
  });
  state.active = null;
  state.undo = [];
  state.prs = records;
  state.history = [done, ...state.history].sort((a, b) => b.startedAt - a.startedAt);
  computeUsage();
  emit('finish');
  return done;
}

export async function discard() {
  state.active = null;
  state.undo = [];
  await persistActive();
  emit('discard');
}

export async function addCustomExercise(ex) {
  await db.put('exercises', ex);
  state.custom = [...state.custom, ex];
  state.catalog = createCatalog(state.custom);
  emit('catalog');
}

export function setSettings(patch) {
  state.settings = sanitize({ ...state.settings, ...patch });
  saveSettings(state.settings);
  applyLang();
  emit('settings');
}

export async function resetAll() {
  await writing;
  await db.wipe();
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
  state.settings = loadSettings();
  state.active = null;
  state.undo = [];
  state.history = [];
  state.prs = [];
  state.custom = [];
  await init();
  emit('reset');
}

// Dev-only: bulk insert finished workouts (seed).
export async function importHistory(workouts) {
  let records = state.prs;
  const sorted = [...workouts].sort((a, b) => a.startedAt - b.startedAt);
  for (const w of sorted) { const r = applyWorkout(records, w); records = r.records; w.prs = r.prs; }
  await db.tx(['workouts', 'prs'], 'readwrite', s => {
    for (const w of sorted) s.workouts.put(w);
    for (const r of records) s.prs.put(r);
  });
  state.prs = records;
  state.history = [...sorted, ...state.history].sort((a, b) => b.startedAt - a.startedAt);
  computeUsage();
  emit('history');
}
