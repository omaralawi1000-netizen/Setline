// Goal autopilot UI: Today card, goal sheet, the aim on the workout screen, lines for the Coach.
import * as store from '../store.js';
import { state } from '../store.js';
import { makeGoal, goalStatus } from '../goals.js';
import { liftSummaries } from '../stats.js';
import { stepFor } from '../progression.js';
import { weight } from '../format.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { setGoalLines } from './coach.js';

const DAY = 86_400_000, WEEK = 7 * DAY;
const u = () => state.t(`unit.${state.settings.unit}`);
const kg = v => weight(v, state.settings.unit, state.lang);
const dateTxt = t => new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }).format(t);
const statusOf = g => goalStatus(g, state.history, Date.now(), { step: stepFor(state.catalog.get(g.exerciseId)) });
const goalName = g => `${state.catalog.name(g.exerciseId, state.lang)} ${kg(g.kg)} ${u()}${g.reps > 1 ? ` × ${g.reps}` : ''}`;

export function addGoal({ exerciseId, kg: k, reps, deadline }) {
  const goals = [...(state.settings.goals || [])].filter(g => g.exerciseId !== exerciseId); // one goal per lift
  goals.push(makeGoal({ exerciseId, kg: k, reps, deadline }, state.history));
  store.setSettings({ goals });
  haptic('success');
}

export function removeGoal(id) {
  store.setSettings({ goals: (state.settings.goals || []).filter(g => g.id !== id) });
  haptic('tap');
}

// ---------- Today ----------

export function goalCardsHTML() {
  const { t } = state;
  const goals = state.settings.goals || [];
  if (!goals.length) return '';
  return `<div class="section"><span class="label">${t('goal.label')}</span><button class="textbtn" data-goal="new">${t('goal.add')}</button></div>
    ${goals.map((g, i) => {
      const st = statusOf(g);
      const k = g.reps > 1 ? 1 / (1 + g.reps / 30) : 1; // e1RM change → change in the goal's own weight
      const aim = st.aim ? t('goal.aim', { set: `${kg(st.aim.kg)} ${u()} × ${st.aim.reps}` }) : '';
      const pace = st.state === 'done' ? t('goal.doneSub') : st.state === 'new' ? t('goal.newSub') : st.state === 'missed' ? t('goal.missedSub')
        : t('goal.pace', { need: kg(Math.round(Math.max(0, (st.neededPerWeek ?? 0) * k) * 10) / 10), trend: st.trend != null ? `${st.trend >= 0 ? '+' : ''}${kg(Math.round(st.trend * k * 10) / 10)}` : '–', unit: u() });
      return `<button class="gcard glass ${st.state}" data-goal="open" data-id="${esc(g.id)}" style="--i:${i}">
        <div class="ghead"><span class="l"><strong>${esc(goalName(g))}</strong><span>${esc(t('goal.by', { date: dateTxt(g.deadline) }))} · ${esc(t('goal.weeksLeft', { n: Math.max(0, Math.round(st.weeksLeft)) }))}</span></span>
          <span class="gstate">${esc(t('goal.state.' + st.state))}</span></div>
        <div class="gbar"><i class="fill" style="transform:scaleX(${st.pct.toFixed(3)})"></i><i class="gnow" style="left:${(st.expectedPct * 100).toFixed(1)}%"></i></div>
        <div class="gfoot"><span>${esc(st.nowKg != null ? t('goal.now', { v: kg(Math.round(st.nowKg * 2) / 2), reps: g.reps, unit: u() }) : t('goal.noData'))}</span>${aim ? `<b>${esc(aim)}</b>` : ''}</div>
        <span class="gpace">${esc(pace)}</span>
      </button>`;
    }).join('')}`;
}

// ---------- the aim on the workout screen ----------

export function goalAimHTML(exerciseId) {
  const g = (state.settings.goals || []).find(x => x.exerciseId === exerciseId);
  if (!g) return '';
  const st = statusOf(g);
  if (!st.aim || st.state === 'done' || st.state === 'missed') return '';
  return `<p class="gaim ${st.state}">${I.flame}<span>${esc(state.t('goal.aimWorkout', { goal: `${kg(g.kg)} ${u()}`, date: dateTxt(g.deadline), set: `${kg(st.aim.kg)} × ${st.aim.reps}` }))}</span></p>`;
}

// ---------- the Coach ----------

setGoalLines(() => (state.settings.goals || []).map(g => {
  const st = statusOf(g);
  return `GOAL: ${state.catalog.name(g.exerciseId, 'en')} ${g.kg} kg x${g.reps} by ${new Date(g.deadline).toISOString().slice(0, 10)}; status ${st.state}; e1RM now ${st.current ?? 'unknown'} of ${st.target}; trend ${st.trend ?? 'unknown'} kg/week, needs ${st.neededPerWeek ?? '?'} kg/week; this week's aim ${st.aim ? `${st.aim.kg}x${st.aim.reps}` : 'none'}.`;
}));

// ---------- the sheet: set or view a goal ----------

const DEADLINES = [8, 12, 16, 24];

export function openGoalSheet({ id = null, exerciseId = null } = {}) {
  const { t } = state;
  const existing = id ? (state.settings.goals || []).find(g => g.id === id) : null;
  if (existing) return viewSheet(existing);
  const lifts = liftSummaries(state.history).slice(0, 8).map(l => l.id);
  const f = { exerciseId: exerciseId || lifts[0] || 'bench-press', reps: 1, weeks: 12 };
  const best = () => liftSummaries(state.history).find(l => l.id === f.exerciseId)?.best?.v ?? 60;
  f.kg = Math.round((best() * 1.08) / 2.5) * 2.5;
  openSheet(el => {
    const paint = () => {
      el.innerHTML = `<div class="sbody"><h2>${t('goal.newTitle')}</h2><p class="lead">${t('goal.newLead')}</p>
        <div class="field"><label>${t('goal.lift')}</label><div class="opts">${[...new Set([f.exerciseId, ...lifts])].map(x => `<button class="chip" data-gx="${esc(x)}" aria-pressed="${x === f.exerciseId}">${esc(state.catalog.name(x, state.lang))}</button>`).join('')}</div></div>
        <div class="field"><label>${t('goal.target')}</label><div class="bigstep"><button class="step" data-gk="-2.5">−</button><input id="gkg" inputmode="decimal" value="${esc(kg(f.kg))}"><span>${u()}</span><button class="step" data-gk="2.5">+</button></div></div>
        <div class="field"><label>${t('goal.reps')}</label><div class="opts">${[1, 3, 5, 8].map(r => `<button class="chip" data-gr="${r}" aria-pressed="${r === f.reps}">${r === 1 ? t('goal.max') : `× ${r}`}</button>`).join('')}</div></div>
        <div class="field"><label>${t('goal.when')}</label><div class="opts">${DEADLINES.map(w => `<button class="chip" data-gw="${w}" aria-pressed="${w === f.weeks}">${esc(t('goal.inWeeks', { n: w }))}</button>`).join('')}</div></div>
        <p class="snote">${esc(t('goal.hint', { now: kg(best()), unit: u() }))}</p>
        <div class="acts"><button class="log" data-g="save">${I.check}<span>${t('goal.save')}</span></button></div></div>`;
    };
    paint();
    el.addEventListener('click', e => {
      const x = e.target.closest('[data-gx]'), k = e.target.closest('[data-gk]'), r = e.target.closest('[data-gr]'), w = e.target.closest('[data-gw]');
      if (x) { f.exerciseId = x.dataset.gx; f.kg = Math.round((best() * 1.08) / 2.5) * 2.5; haptic('tap'); return paint(); }
      if (k) { f.kg = Math.max(2.5, f.kg + Number(k.dataset.gk)); el.querySelector('#gkg').value = kg(f.kg); haptic('tap'); return; }
      if (r) { f.reps = Number(r.dataset.gr); haptic('tap'); return paint(); }
      if (w) { f.weeks = Number(w.dataset.gw); haptic('tap'); return paint(); }
      if (e.target.closest('[data-g=save]')) {
        const typed = Number(String(el.querySelector('#gkg').value).replace(',', '.'));
        if (typed > 0) f.kg = state.settings.unit === 'lb' ? typed / 2.20462 : typed;
        addGoal({ exerciseId: f.exerciseId, kg: f.kg, reps: f.reps, deadline: Date.now() + f.weeks * WEEK });
        closeTop();
        toast({ title: esc(t('goal.saved')), sub: esc(goalName((state.settings.goals || []).at(-1))) });
      }
    });
  }, { label: t('goal.newTitle') });
}

function viewSheet(g) {
  const { t } = state;
  const st = statusOf(g);
  openSheet(el => {
    const pts = st.series.slice(-12);
    const all = [...pts.map(p => p.v), st.target];
    const lo = Math.min(...all) * 0.97, hi = Math.max(...all) * 1.02;
    const x0 = pts[0]?.t ?? g.createdAt, x1 = g.deadline;
    const X = tt => 12 + ((tt - x0) / Math.max(1, x1 - x0)) * 316, Y = v => 130 - ((v - lo) / Math.max(1, hi - lo)) * 118;
    const line = pts.map(p => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const last = pts.at(-1);
    el.innerHTML = `<div class="sbody"><h2>${esc(goalName(g))}</h2><p class="lead">${esc(t('goal.by', { date: dateTxt(g.deadline) }))} · <span class="gstate ${st.state}">${esc(t('goal.state.' + st.state))}</span></p>
      ${pts.length >= 2 ? `<svg class="gchart" viewBox="0 0 340 140" aria-hidden="true">
        <line x1="0" x2="340" y1="${Y(st.target).toFixed(1)}" y2="${Y(st.target).toFixed(1)}" class="gt"/>
        <polyline points="${line}" class="gl"/>
        ${last && st.projected ? `<line x1="${X(last.t).toFixed(1)}" y1="${Y(last.v).toFixed(1)}" x2="${X(g.deadline).toFixed(1)}" y2="${Y(Math.min(st.projected, hi)).toFixed(1)}" class="gp"/>` : ''}
        ${pts.map(p => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3"/>`).join('')}
        <text x="336" y="${(Y(st.target) - 6).toFixed(1)}" text-anchor="end">${esc(state.t('goal.targetLabel'))}</text></svg>` : ''}
      <div class="summary solid"><div><b>${st.nowKg != null ? esc(kg(Math.round(st.nowKg * 2) / 2)) : '–'}</b><span>${t('goal.nowLabel')}</span></div><div><b>${esc(kg(g.kg))}</b><span>${t('goal.targetLabel')}</span></div><div><b>${st.projKg != null ? esc(kg(Math.round(st.projKg * 2) / 2)) : '–'}</b><span>${t('goal.projLabel')}</span></div></div>
      <p class="snote center">${esc(t('goal.forReps', { reps: g.reps, unit: u() }))}</p>
      ${st.aim ? `<p class="gaim">${I.flame}<span>${esc(t('goal.aim', { set: `${kg(st.aim.kg)} ${u()} × ${st.aim.reps}` }))}</span></p>` : ''}
      <p class="snote">${esc(t('goal.explain'))}</p>
      <div class="acts"><button class="btn2 solid danger" data-g="del">${I.trash}<span>${t('goal.remove')}</span></button></div></div>`;
    el.querySelector('[data-g=del]').onclick = async () => { await closeTop(); removeGoal(g.id); toast({ title: esc(t('goal.removed')) }); };
  }, { label: goalName(g) });
}

export function initGoals() {
  document.getElementById('app').addEventListener('click', e => {
    const b = e.target.closest('[data-goal]');
    if (!b) return;
    haptic('tap');
    if (b.dataset.goal === 'new') openGoalSheet({ exerciseId: b.dataset.ex || null });
    else openGoalSheet({ id: b.dataset.id });
  });
}
