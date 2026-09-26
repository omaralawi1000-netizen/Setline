// The Coach changing the plan: "I have wrestling today", "move legs to Thursday", "swap leg extension for
// hack squat", "do 4 sets of bench on Monday". The Coach adds lines like
//   CHANGE: {"day":"2026-09-26","label":"Wrestling"}
// at the end of its reply; the app hides them, applies them (with Undo) and says what changed.
import { routineDay, withoutDay, routineName } from './routines.js';
import { matchExercise } from './parser.js';

const DAYS = [['sun', 'sunday', 'søn', 'søndag'], ['mon', 'monday', 'man', 'mandag'], ['tue', 'tuesday', 'tir', 'tirsdag'], ['wed', 'wednesday', 'ons', 'onsdag'],
  ['thu', 'thursday', 'tor', 'torsdag'], ['fri', 'friday', 'fre', 'fredag'], ['sat', 'saturday', 'lør', 'lørdag']];
export const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const KEY = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar day, like the rest of the app.
export const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const keyToTs = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };

// One-off changes to single days: {"2026-09-26": {label: "Wrestling"} | {rest: true} | {routineId}}.
// Only a few weeks around today are kept.
export function sanitizeDayPlan(input, now = Date.now()) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const lo = dayKey(now - 21 * 86_400_000), hi = dayKey(now + 60 * 86_400_000);
  for (const [k, v] of Object.entries(input)) {
    if (!KEY.test(k) || k < lo || k > hi || !v || typeof v !== 'object') continue;
    if (typeof v.routineId === 'string' && v.routineId.length <= 80) out[k] = { routineId: v.routineId };
    else if (v.rest === true) out[k] = { rest: true };
    else if (typeof v.label === 'string' && v.label.trim()) out[k] = { label: v.label.trim().slice(0, 30) };
  }
  return out;
}

// What a date holds: a one-off change first, else the routine for that weekday. {routine, label, rest, changed}
export function dayOf(key, routines, dayPlan = {}) {
  const o = dayPlan[key];
  if (o?.routineId) { const r = routines.find(x => x.id === o.routineId); if (r) return { routine: r, changed: true }; }
  if (o?.rest) return { rest: true, changed: true };
  if (o?.label) return { label: o.label, changed: true };
  const wd = new Date(keyToTs(key)).getDay();
  const r = routines.find(x => routineDay(x) === wd);
  return r ? { routine: r } : { rest: true };
}

// ---------- reading the Coach's reply ----------

const CHANGE_RE = /^[ \t]*CHANGE:[ \t]*(\{.*\})[ \t]*(?:\r?\n|$)/gim;
export function splitChanges(text) {
  const changes = [];
  const clean = String(text || '').replace(CHANGE_RE, (_, j) => { try { const o = JSON.parse(j); if (o && typeof o === 'object') changes.push(o); } catch {} return ''; })
    .replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, changes: changes.slice(0, 6) };
}
// While streaming, a change line is hidden as soon as it starts.
export const hideChangeTail = text => String(text || '').replace(/\n?\s*CHANGE:[^]*$/i, '').replace(/\n?\s*CHAN(?:G(?:E)?)?$/, '');

// ---------- finding things by name ----------

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9æøå]+/g, ' ').trim();
export function weekdayOf(word) {
  const w = norm(word);
  const i = DAYS.findIndex(names => names.includes(w));
  return i === -1 ? null : i;
}
export function findRoutine(routines, name, lang = 'en') {
  if (!name) return null;
  const n = norm(name);
  const byDay = weekdayOf(n);
  if (byDay != null) return routines.find(r => routineDay(r) === byDay) || null;
  const all = routines.map(r => ({ r, names: [routineName(r, lang), r.name, withoutDay(routineName(r, lang))].map(norm) }));
  return (all.find(x => x.names.includes(n)) || all.find(x => x.names.some(m => m.includes(n) || (m && n.includes(m)))) || {}).r || null;
}
const findExercise = (catalog, name) => {
  const m = matchExercise(String(name || ''), { catalog, usage: {} });
  return m?.exerciseId || null;
};

// ---------- applying ----------

const int = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : null);
const kgOf = v => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 500 ? Math.round(Number(v) * 4) / 4 : null);

// Apply the changes to copies. Returns {routines, dayPlan, done: [{what}], failed: [text]}.
// `t` formats the short descriptions shown under the reply.
export function applyChanges({ routines, dayPlan }, changes, { catalog, lang = 'en', now = Date.now(), t = (k, p) => `${k} ${JSON.stringify(p || {})}` } = {}) {
  let rs = structuredClone(routines || []);
  const plan = { ...(dayPlan || {}) };
  const done = [], failed = [];
  const dayName = key => { const k = Math.round((keyToTs(key) - keyToTs(dayKey(now))) / 86_400_000); return k === 0 ? t('plan.today') : k === 1 ? t('plan.tomorrow') : new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'long' }).format(keyToTs(key)); };
  const nm = r => withoutDay(routineName(r, lang));
  for (const c of changes || []) {
    try {
      // one day: a sport or anything else, rest, a routine, or back to the plan
      if (c.day) {
        const key = KEY.test(c.day) ? c.day : weekdayOf(c.day) != null ? nextWeekday(weekdayOf(c.day), now) : null;
        if (!key) { failed.push(String(c.day)); continue; }
        if (c.clear) { delete plan[key]; done.push(t('change.dayBack', { day: dayName(key) })); continue; }
        if (c.rest) { plan[key] = { rest: true }; done.push(t('change.day', { day: dayName(key), what: t('plan.rest') })); continue; }
        if (c.routine) {
          const r = findRoutine(rs, c.routine, lang);
          if (!r) { failed.push(String(c.routine)); continue; }
          plan[key] = { routineId: r.id }; done.push(t('change.day', { day: dayName(key), what: nm(r) })); continue;
        }
        if (c.label) { plan[key] = { label: String(c.label).trim().slice(0, 30) }; done.push(t('change.day', { day: dayName(key), what: plan[key].label })); continue; }
        failed.push(JSON.stringify(c)); continue;
      }
      // a routine: its weekday, its name, or one of its exercises
      if (c.routine) {
        const r = findRoutine(rs, c.routine, lang);
        if (!r) { failed.push(String(c.routine)); continue; }
        const i = rs.indexOf(r);
        if (c.weekday != null) {
          const wd = c.weekday === 'any' || c.weekday === -1 ? -1 : weekdayOf(c.weekday);
          if (wd == null) { failed.push(String(c.weekday)); continue; }
          // the day it moves to is freed from any other routine (they'd clash)
          if (wd >= 0) rs = rs.map(x => (x.id !== r.id && routineDay(x) === wd ? { ...x, weekday: -1, name: withoutDay(x.name) } : x));
          rs[rs.findIndex(x => x.id === r.id)] = { ...r, weekday: wd, name: withoutDay(r.name) };
          done.push(t('change.moved', { name: nm(r), day: wd === -1 ? t('plan.anyDay') : new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'long' }).format(new Date(2026, 8, 27 + wd, 12)) }));
          continue;
        }
        if (c.rename) { const n = String(c.rename).trim().slice(0, 40); if (!n) { failed.push('rename'); continue; } rs[i] = { ...r, name: n }; delete rs[i].names; done.push(t('change.renamed', { name: n })); continue; }
        if (c.remove) {
          const id = findExercise(catalog, c.remove), k = r.exercises.findIndex(e => e.exerciseId === id);
          if (k === -1) { failed.push(String(c.remove)); continue; }
          rs[i] = { ...r, exercises: r.exercises.filter((_, j) => j !== k) };
          done.push(t('change.removed', { ex: catalog.name(id, lang), name: nm(r) })); continue;
        }
        if (c.swap && c.for) {
          const from = findExercise(catalog, c.swap), to = findExercise(catalog, c.for), k = r.exercises.findIndex(e => e.exerciseId === from);
          if (k === -1 || !to) { failed.push(`${c.swap} → ${c.for}`); continue; }
          const ex = r.exercises.map((e, j) => (j === k ? { ...e, exerciseId: to, sets: e.sets.map(s => ({ reps: s.reps, kg: null })) } : e));
          rs[i] = { ...r, exercises: ex };
          done.push(t('change.swapped', { from: catalog.name(from, lang), to: catalog.name(to, lang), name: nm(r) })); continue;
        }
        if (c.exercise) {
          const id = findExercise(catalog, c.exercise);
          if (!id) { failed.push(String(c.exercise)); continue; }
          const k = r.exercises.findIndex(e => e.exerciseId === id);
          const old = k === -1 ? null : r.exercises[k];
          const n = int(c.sets, 1, 10) ?? old?.sets.length ?? 3, reps = int(c.reps, 1, 100) ?? old?.sets[0]?.reps ?? 10, kg = c.kg != null ? kgOf(c.kg) : old?.sets[0]?.kg ?? null;
          const ex = { exerciseId: id, sets: Array.from({ length: n }, (_, j) => ({ reps, kg: c.kg != null ? kg : old?.sets[j]?.kg ?? kg })) };
          rs[i] = { ...r, exercises: k === -1 ? [...r.exercises, ex].slice(0, 20) : r.exercises.map((e, j) => (j === k ? ex : e)) };
          done.push(t(k === -1 ? 'change.added' : 'change.sets', { ex: catalog.name(id, lang), name: nm(r), sets: n, reps, kg: kg != null ? ` @ ${kg} kg` : '' })); continue;
        }
      }
      failed.push(JSON.stringify(c));
    } catch { failed.push(JSON.stringify(c)); }
  }
  return { routines: rs, dayPlan: plan, done, failed };
}

// The next date (today included) that falls on a weekday.
export function nextWeekday(wd, now = Date.now()) {
  const d0 = new Date(now).getDay();
  return dayKey(now + ((wd - d0 + 7) % 7) * 86_400_000);
}

// For the Coach: the next 7 days as they stand (with one-off changes), so "today", "tomorrow" and
// "Saturday" can be matched to dates.
export function weekText(routines, dayPlan, now = Date.now()) {
  return Array.from({ length: 7 }, (_, k) => {
    const key = dayKey(now + k * 86_400_000), d = dayOf(key, routines, dayPlan);
    const what = d.routine ? routineName(d.routine, 'en') : d.label ? d.label : 'rest';
    return `${key} ${DAY_EN[new Date(keyToTs(key)).getDay()]}${k === 0 ? ' (today)' : k === 1 ? ' (tomorrow)' : ''}: ${what}${d.changed ? ' (changed for that day)' : ''}`;
  }).join('\n');
}
