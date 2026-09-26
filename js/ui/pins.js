// The Coach keeping an eye on your goals: after a session that missed the plan, a lift that has
// stalled, or a week falling behind, it pins a note at the top of the Coach (and on Today). The note
// only says what it sees; "Talk it through" asks the Coach, which may offer changes as chips.
import * as store from '../store.js';
import { state } from '../store.js';
import { reviewSession, weekBehind } from '../review.js';
import { dayOf } from '../planedit.js';
import { routineDay } from '../routines.js';
import { dateKey } from '../body.js';
import { weekStart } from '../stats.js';
import { weight } from '../format.js';
import { esc } from './dom.js';
import { I } from './icons.js';

const DAY = 86_400_000;
const names = ids => {
  const n = ids.map(id => state.catalog.name(id, state.lang));
  return n.length > 2 ? `${n.slice(0, 2).join(', ')} +${n.length - 2}` : n.join(state.lang === 'da' ? ' og ' : ' and ');
};
export const kgReps = (kg, reps) => `${kg ? `${weight(kg, state.settings.unit, state.lang)}` : ''}${kg ? ' × ' : ''}${reps}`;

function setPin(pin) {
  const s = state.settings;
  if (!pin || s.pinGone === pin.id || s.coachPin?.id === pin.id) return;
  store.setSettings({ coachPin: { ...pin, at: Date.now() } });
}
export function dropPin({ gone = true } = {}) {
  const p = state.settings.coachPin;
  if (p) store.setSettings({ coachPin: null, ...(gone ? { pinGone: p.id } : {}) });
}

// Right after a workout is saved. Returns the review (the debrief uses it too).
export function afterSession(w) {
  const { t } = state;
  const rv = reviewSession(w, state.history, state.catalog, targetsFor(w));
  const cur = state.settings.coachPin;
  if (rv.concern === 'missed') {
    const miss = rv.lifts.filter(l => l.status === 'missed' || (l.status === 'skipped' && l.target));
    const what = names(miss.map(l => l.exerciseId));
    const next = miss.filter(l => l.next).slice(0, 2).map(l => `${state.catalog.name(l.exerciseId, state.lang)} ${kgReps(l.next.kg, l.next.reps)}`).join(', ');
    setPin({ id: 'missed-' + w.id, kind: 'missed', title: t('pin.missedTitle', { what }), sub: next ? t('pin.missedSub', { next }) : '', ask: t('pin.missedAsk', { what }) });
  } else if (rv.concern === 'deload') {
    const l = rv.lifts.find(x => x.next?.reason === 'deload'), what = state.catalog.name(l.exerciseId, state.lang);
    setPin({ id: 'deload-' + l.exerciseId + '-' + dateKey(), kind: 'deload', title: t('pin.deloadTitle', { what }), sub: t('pin.deloadSub', { next: kgReps(l.next.kg, l.next.reps) }), ask: t('pin.deloadAsk', { what }) });
  } else if (cur && cur.kind !== 'behind') dropPin({ gone: false }); // back on plan: the old note goes
  checkWeek();
  return rv;
}

// Workouts saved before 1.49 have no plan kept on them: use the routine's.
function targetsFor(w) {
  const r = w.routineId && state.routines.find(x => x.id === w.routineId), out = {};
  for (const e of r?.exercises || []) {
    const reps = Math.max(0, ...e.sets.map(s => s.reps || 0));
    if (reps) out[e.exerciseId] = { kg: Math.max(0, ...e.sets.map(s => s.kg || 0)) || null, reps, sets: e.sets.length };
  }
  return out;
}

// Rest and other-sport days still to come this week (only when the plan has fixed weekdays).
function offDaysLeft(now = Date.now()) {
  if (!state.routines.some(r => routineDay(r) != null) && !Object.keys(state.settings.dayPlan || {}).length) return 0;
  const start = weekStart(now), from = Math.floor((now - start) / DAY) + 1;
  let n = 0;
  for (let i = from; i < 7; i++) { const d = dayOf(dateKey(start + i * DAY + DAY / 2), state.routines, state.settings.dayPlan); if (!d.routine) n++; }
  return n;
}

// On opening the app: is the week's workout goal slipping? Old notes are tidied away.
export function checkWeek(now = Date.now()) {
  const s = state.settings, cur = s.coachPin, { t } = state;
  if (state.active) return;
  const monday = dateKey(weekStart(now));
  if (cur?.kind === 'behind' && cur.id !== 'behind-' + monday) dropPin({ gone: false });
  else if (cur && cur.kind !== 'behind' && now - (cur.at || 0) > 7 * DAY) dropPin({ gone: false });
  if (!s.weeklyGoal || new Date(now).getDay() === 1) return; // Monday: the week has only begun
  const b = weekBehind(state.history, s.weeklyGoal, now, offDaysLeft(now));
  const pin = state.settings.coachPin;
  if (!b) { if (pin?.kind === 'behind') dropPin({ gone: false }); return; }
  if (pin && pin.kind !== 'behind') return; // a session note is more useful; one note at a time
  setPin({ id: 'behind-' + monday, kind: 'behind', title: t('pin.behindTitle', b), sub: t('pin.behindSub', { ...b, days: b.daysLeft }), ask: t('pin.behindAsk', b) });
}

// The note itself: at the top of the Coach, and on Today.
export function pinHTML(where = 'coach') {
  const p = state.settings.coachPin, { t } = state;
  if (!p) return '';
  const icon = p.kind === 'behind' ? I.chart : p.kind === 'deload' ? I.flame : I.workout;
  const open = where === 'today' ? '<div class="cpin solid"' : '<div class="cpin glass"';
  return `${open} data-part="pin" data-kind="${esc(p.kind)}">
    <span class="cpic">${icon}</span>
    <div class="l"><span class="label">${esc(t('pin.label'))}</span><strong>${esc(p.title)}</strong>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}
      <div class="cpacts"><button class="chip sm" data-pin="talk">${I.chat}<span>${esc(t('pin.talk'))}</span></button><button class="textbtn muted" data-pin="hide">${esc(t('pin.hide'))}</button></div></div>
  </div>`;
}
