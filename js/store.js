// App state + persistence. The active workout is written to IndexedDB on every change.
import * as db from './db.js';
import { createCatalog } from './catalog.js';
import { starterRoutines } from './routines.js';
import { loadSettings, saveSettings, sanitize, SETTINGS_KEY } from './settings.js';
import { resolveLang, translator } from './i18n.js';
import { createWorkout, finishWorkout, doneSetCount, learnedRest } from './workout.js';
import { applyWorkout } from './pr.js';
import { clearKeys } from './keys.js';
import { startCardio, pauseCardio, resumeCardio, finishCardio, cardioRecords } from './cardio.js';
import { upsertBodyweight, addProtein, dateKey } from './body.js';
import { addMeal, removeMeal } from './meals.js';
import { mergeCheckin } from './checkin.js';
import { upsertMeasures } from './measures.js';
import { easyDay } from './progression.js';
import { deloadDay } from './insights.js';

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
  chat: [],        // coach thread, oldest first
  bodyweight: [],
  cardio: [],      // finished cardio sessions, newest first
  activeCardio: null,
  nutrition: [],
  daily: [],       // morning check-ins, by date
  measures: [],    // body measurements, by date
  photos: [],      // progress photos {id, date, pose, t, thumb, blob}
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
  const [custom, routines, workouts, prs, active, chat, bodyweight] = await Promise.all([
    db.getAll('exercises'), db.getAll('routines'), db.getAll('workouts'), db.getAll('prs'), db.get('meta', 'activeWorkout'),
    db.getAll('chat'), db.getAll('bodyweight')
  ]);
  const [cardio, activeCardio, nutrition, daily, measures] = await Promise.all([db.getAll('cardio'), db.get('meta', 'activeCardio'), db.getAll('nutrition'), db.getAll('daily'), db.getAll('measures')]);
  state.daily = daily;
  state.measures = measures;
  state.photos = await db.getAll('photos').catch(() => []);
  state.cardio = cardio.sort((a, b) => b.startedAt - a.startedAt);
  state.activeCardio = activeCardio || null;
  state.nutrition = nutrition;
  state.chat = chat.sort((a, b) => a.at - b.at);
  state.bodyweight = bodyweight;
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

export function startWorkout(template, { readiness = null, easy = false } = {}) {
  if (state.active) return state.active;
  const deload = !!template.deload || !!(state.settings.deloadUntil && Date.now() < state.settings.deloadUntil && template.exercises?.length);
  state.active = createWorkout(template.deload ? template : deload ? deloadDay(template) : easy ? easyDay(template) : template);
  if (readiness) state.active.readiness = readiness;
  if (deload) state.active.deload = true;
  else if (easy) state.active.easy = true;
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
  const learned = learnedRest(w);
  if (Object.keys(learned).length) {
    state.settings = sanitize({ ...state.settings, restByEx: { ...state.settings.restByEx, ...learned } });
    saveSettings(state.settings);
  }
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

// ---- cardio ----
const saveActiveCardio = () => (state.activeCardio ? db.put('meta', state.activeCardio, 'activeCardio') : db.del('meta', 'activeCardio'))
  .catch(() => { state.error = 'storage'; emit('error'); });

export function beginCardio(type) {
  if (state.activeCardio) return state.activeCardio;
  state.activeCardio = startCardio(type);
  saveActiveCardio();
  emit('cardio');
  return state.activeCardio;
}
export function toggleCardioPause() {
  const a = state.activeCardio;
  if (!a) return;
  state.activeCardio = a.pausedAt ? resumeCardio(a) : pauseCardio(a);
  if (state.activeCardio.gps) state.activeCardio = { ...state.activeCardio, gps: { ...state.activeCardio.gps, last: null } };
  saveActiveCardio();
  emit('cardio');
}
// GPS track of the live session: {on, m, last, fixes}. Quiet: the live screen updates itself.
let gpsSaved = 0;
export function setCardioGps(gps, { quiet = true } = {}) {
  if (!state.activeCardio) return;
  state.activeCardio = { ...state.activeCardio, gps };
  if (!quiet || Date.now() - gpsSaved > 10_000) { gpsSaved = Date.now(); saveActiveCardio(); }
  if (!quiet) emit('cardio');
}
export async function endCardio(details) {
  const a = state.activeCardio;
  if (!a) return null;
  const session = finishCardio(a, details);
  session.records = cardioRecords(session, state.cardio);
  await db.tx(['cardio', 'meta'], 'readwrite', s => { s.cardio.put(session); s.meta.delete('activeCardio'); });
  state.activeCardio = null;
  state.cardio = [session, ...state.cardio].sort((x, y) => y.startedAt - x.startedAt);
  emit('cardio');
  return session;
}
export async function discardCardio() {
  state.activeCardio = null;
  await saveActiveCardio();
  emit('cardio');
}
export async function addCardio(session) {
  const s = { ...session, records: cardioRecords(session, state.cardio) };
  await db.put('cardio', s);
  state.cardio = [s, ...state.cardio.filter(c => c.id !== s.id)].sort((x, y) => y.startedAt - x.startedAt);
  emit('cardio');
  return s;
}
export async function deleteCardio(id) {
  await db.del('cardio', id);
  state.cardio = state.cardio.filter(c => c.id !== id);
  emit('cardio');
}

// ---- body ----
export async function logBodyweight(kg, date = dateKey()) {
  state.bodyweight = upsertBodyweight(state.bodyweight, date, kg);
  await db.put('bodyweight', state.bodyweight.find(e => e.date === date));
  emit('body');
}
export async function deleteBodyweight(date) {
  state.bodyweight = state.bodyweight.filter(e => e.date !== date);
  await db.del('bodyweight', date);
  emit('body');
}
export async function logProtein(grams, date = dateKey()) {
  state.nutrition = addProtein(state.nutrition, date, grams);
  const e = state.nutrition.find(x => x.date === date);
  if (e) await db.put('nutrition', e);
  emit('body');
}
export async function undoProtein(grams, date = dateKey()) {
  const e = state.nutrition.find(x => x.date === date);
  if (!e) return;
  const next = { ...e, protein: Math.max(0, e.protein - grams) };
  state.nutrition = [...state.nutrition.filter(x => x.date !== date), next];
  await db.put('nutrition', next);
  emit('body');
}

// ---- measurements and progress photos ----
export async function saveMeasures(patch, date = dateKey()) {
  state.measures = upsertMeasures(state.measures, date, patch);
  const e = state.measures.find(m => m.date === date);
  if (e) await db.put('measures', e); else await db.del('measures', date);
  emit('body');
}
export async function addPhoto(photo) {
  await db.put('photos', photo);
  state.photos = [...state.photos, photo];
  emit('photos');
}
export async function deletePhoto(id) {
  await db.del('photos', id);
  state.photos = state.photos.filter(p => p.id !== id);
  emit('photos');
}

// ---- morning check-in ----
export async function saveCheckin(patch, date = dateKey()) {
  const prev = state.daily.find(d => d.date === date) || null;
  const next = mergeCheckin(prev, patch, date);
  state.daily = [...state.daily.filter(d => d.date !== date), next];
  await db.put('daily', next);
  emit('checkin');
  return { prev, next };
}
export async function restoreCheckin(prev, date = dateKey()) {
  state.daily = state.daily.filter(d => d.date !== date);
  if (prev) { state.daily.push(prev); await db.put('daily', prev); } else await db.del('daily', date);
  emit('checkin');
}

export async function logMeal(meal, date = dateKey()) {
  const r = addMeal(state.nutrition, date, meal);
  state.nutrition = r.entries;
  await db.put('nutrition', state.nutrition.find(x => x.date === date));
  emit('body');
  return r.meal;
}
export async function deleteMeal(id, date = dateKey()) {
  state.nutrition = removeMeal(state.nutrition, date, id);
  const e = state.nutrition.find(x => x.date === date);
  if (e) await db.put('nutrition', e);
  emit('body');
}

// ---- backup ----
// Replace everything with a validated backup in one transaction (keys and the active workout stay).
export async function importBackup(d) {
  await db.tx(['workouts', 'cardio', 'routines', 'exercises', 'prs', 'bodyweight', 'nutrition', 'chat', 'daily', 'measures'], 'readwrite', s => {
    for (const k of ['workouts', 'cardio', 'routines', 'exercises', 'prs', 'bodyweight', 'nutrition', 'chat', 'daily', 'measures']) {
      s[k].clear();
      for (const x of d[k] || []) s[k].put(x);
    }
  });
  state.settings = sanitize({ ...d.settings, ttsModel: state.settings.ttsModel, ttsLite: state.settings.ttsLite, cmdModel: state.settings.cmdModel, coachModel: state.settings.coachModel, cmdAlt: state.settings.cmdAlt, coachAlt: state.settings.coachAlt });
  saveSettings(state.settings);
  applyLang();
  await init();
  emit('reset');
}

// ---- routines ----
export async function saveRoutine(r) {
  await db.put('routines', r);
  const i = state.routines.findIndex(x => x.id === r.id);
  state.routines = i === -1 ? [...state.routines, r] : state.routines.map(x => (x.id === r.id ? r : x));
  emit('routines');
}
export async function saveRoutines(list) {
  await db.tx('routines', 'readwrite', s => { for (const r of list) s.routines.put(r); });
  const ids = new Set(list.map(r => r.id));
  state.routines = [...state.routines.filter(r => !ids.has(r.id)), ...list];
  emit('routines');
}
export async function deleteRoutine(id) {
  await db.del('routines', id);
  state.routines = state.routines.filter(r => r.id !== id);
  emit('routines');
}

// ---- coach thread ----
export function addChat(role, text, extra = {}) {
  const msg = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, role, text, at: Date.now(), ...extra };
  state.chat = [...state.chat, msg];
  db.put('chat', msg).catch(() => {});
  emit('chat');
  return msg;
}

// Streaming updates stay in memory; persist once the answer is complete.
export function updateChat(id, patch, { persist = false, quiet = false } = {}) {
  const i = state.chat.findIndex(m => m.id === id);
  if (i === -1) return;
  const msg = { ...state.chat[i], ...patch };
  state.chat = state.chat.map((m, k) => (k === i ? msg : m));
  if (persist) db.put('chat', msg).catch(() => {});
  if (!quiet) emit('chat');
}

export async function clearChat() {
  await db.tx('chat', 'readwrite', s => { s.chat.clear(); });
  state.chat = [];
  emit('chat');
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
  clearKeys();
  state.settings = loadSettings();
  state.active = null;
  state.undo = [];
  state.history = [];
  state.prs = [];
  state.custom = [];
  state.chat = [];
  state.cardio = [];
  state.activeCardio = null;
  state.nutrition = [];
  state.bodyweight = [];
  state.daily = [];
  state.measures = [];
  state.photos = [];
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
