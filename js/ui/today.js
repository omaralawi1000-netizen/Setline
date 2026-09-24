// Today: greeting, start a routine or an empty workout, or resume.
import { state } from '../store.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { routineName, estimateMinutes } from '../routines.js';
import { greetingKey, clock } from '../format.js';
import { doneSetCount, elapsedSec } from '../workout.js';
import { getKey } from '../keys.js';
import { thisWeek, lastSessionSummary, latestPR, sparkline } from '../stats.js';
import { total, weight } from '../format.js';

const MIC = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0M12 18v3"/></svg>';

export function workoutTitle(w) {
  const r = w.routineId && state.routines.find(r => r.id === w.routineId);
  return r ? routineName(r, state.lang) : (w.name || state.t('workout.untitled'));
}

// Start cards, shared with the Workout tab's empty state.
export function startCardsHTML() {
  const { t, lang, catalog } = state;
  const [first, ...rest] = state.routines;
  let html = '';
  if (first) {
    const names = first.exercises.map(e => catalog.name(e.exerciseId, lang));
    html += `<div class="upcoming glass">
      <h2>${esc(routineName(first, lang))}</h2>
      <p>${t('today.exercisesAbout', { n: first.exercises.length, min: estimateMinutes(first) })}</p>
      <div class="exlist">${names.slice(0, 2).map(n => `<span class="chip">${esc(n)}</span>`).join('')}${names.length > 2 ? `<span class="chip">${t('today.more', { n: names.length - 2 })}</span>` : ''}</div>
      <button class="log" data-act="start-routine" data-id="${esc(first.id)}">${I.play}<span>${t('today.start')}</span></button>
      ${getKey('groq') ? `<p class="sayhint">${MIC}${esc(t('today.orSay', { text: `${t('voice.hint.start').split(' ')[0].toLowerCase()} ${routineName(first, lang).toLowerCase()}` }))}</p>` : ''}
    </div>`;
  }
  for (const r of rest) {
    html += `<button class="card solid routine" data-act="start-routine" data-id="${esc(r.id)}">
      <span class="l"><strong>${esc(routineName(r, lang))}</strong><span>${t('today.exercisesAbout', { n: r.exercises.length, min: estimateMinutes(r) })}</span></span>
      <span class="iconbtn">${I.play}</span></button>`;
  }
  html += `<div class="row2" style="grid-template-columns:1fr"><button class="btn2 solid" data-act="start-empty">${I.plus}<span>${t('today.startEmpty')}</span></button></div>`;
  return html;
}

export function renderToday(root) {
  const { t, active: w } = state;
  const hour = new Date().getHours();
  let main;
  if (w) {
    const cur = w.exercises[w.current];
    const names = w.exercises.map(e => state.catalog.name(e.exerciseId, state.lang));
    main = `<div class="upcoming glass">
      <span class="live"><i></i><span data-elapsed>${esc(clock(elapsedSec(w)))}</span></span>
      <h2>${esc(workoutTitle(w))}</h2>
      <p>${t('today.resumeSub', { sets: doneSetCount(w) })}</p>
      ${names.length ? `<div class="exlist">${cur ? `<span class="chip">${esc(state.catalog.name(cur.exerciseId, state.lang))}</span>` : ''}${names.length > 1 ? `<span class="chip">${t('today.more', { n: names.length - 1 })}</span>` : ''}</div>` : '<div style="height:14px"></div>'}
      <button class="log" data-act="go" data-to="workout"><span>${t('today.resume')}</span></button>
    </div>`;
  } else {
    main = startCardsHTML();
  }
  const cards = cardsHTML();
  root.innerHTML = `
    <header class="brand">
      <div><strong>Setline</strong><span>${t('app.tagline')}</span></div>
      <button class="iconbtn" data-act="open-settings" aria-label="${t('settings.title')}">${I.settings}</button>
    </header>
    <h1 class="greet">${t(greetingKey(hour))}</h1>
    <p class="sub">${t(w ? 'today.inProgress' : 'today.ready')}</p>
    ${main}${cards}`;
  // the week ring fills in as the screen arrives
  const fg = root.querySelector('.week .fg');
  if (fg) {
    const to = fg.dataset.to;
    if (root.classList.contains('enter')) requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = to; }));
    else fg.style.strokeDashoffset = to;
  }
}

const C = 157.08;

// This week, last session and latest PR, from real history only.
function cardsHTML() {
  const { t, lang, settings } = state;
  const unit = settings.unit;
  const u = t(`unit.${unit}`);
  const wk = thisWeek(state.history);
  const goal = settings.weeklyGoal;
  const letters = t('today.days').split(' ');
  const week = `<div class="mini solid" role="img" aria-label="${esc(t('today.weekAria', { n: wk.count, goal }))}"><span class="t">${t('today.thisWeek')}</span>
      <div class="week"><div class="ring"><svg viewBox="0 0 60 60" aria-hidden="true"><circle class="bg" cx="30" cy="30" r="25"/><circle class="fg" cx="30" cy="30" r="25" style="stroke-dashoffset:${C}" data-to="${C * (1 - Math.min(1, wk.count / goal))}"/></svg><b>${wk.count}/${goal}</b></div></div>
      <div class="days" aria-hidden="true">${wk.days.map((on, i) => `<i class="${on ? 'on' : ''}${i === wk.today ? ' now' : ''}" title="${letters[i]}"></i>`).join('')}</div>
    </div>`;
  const last = lastSessionSummary(state.history);
  const lastCard = last ? `<button class="mini solid" data-act="detail" data-id="${esc(last.workout.id)}"><span class="t">${t('today.lastSession')}</span><strong>${esc(workoutTitle(last.workout))}</strong>
      <span class="vol"><b>${total(last.volume, unit, lang)}</b><span>${esc(t('today.lastSessionSub', { volume: '', unit: u, min: last.minutes }).trim())}</span></span></button>` : '';
  let html = `<div class="grid2${last ? '' : ' one'}">${week}${lastCard}</div>`;
  const p = latestPR(state.history);
  if (p) {
    const name = state.catalog.name(p.pr.exerciseId, lang);
    const kgTxt = kg => `${weight(kg, unit, lang)} ${u}`;
    const headline = p.pr.kind === 'e1rm' ? `${kgTxt(p.pr.kg)} × ${p.pr.reps}` : p.pr.kind === 'reps' ? `${p.pr.reps} × ${kgTxt(p.pr.kg)}` : `${kgTxt(p.pr.kg)} × ${p.pr.reps}`;
    const sub = p.pr.kind === 'weight' ? (p.deltaKg ? t('today.prUp', { name, kg: kgTxt(p.deltaKg) }) : t('today.prFirst', { name }))
      : p.pr.kind === 'e1rm' ? t('today.prE1rm', { name, v: kgTxt(p.pr.value) }) : t('today.prReps', { name, reps: p.pr.reps, kg: kgTxt(p.pr.kg) });
    const sp = sparkline(p.series);
    const chart = sp ? `<svg viewBox="0 0 120 56" aria-hidden="true"><path d="${sp.area}" fill="url(#sf)"/><polyline points="${sp.line}" fill="none" stroke="url(#sp)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${sp.last.x}" cy="${sp.last.y}" r="4.5" fill="#FFD9A8"/><circle class="pulse" cx="${sp.last.x}" cy="${sp.last.y}" r="9" fill="#FFD9A8" opacity=".18"/></svg>` : '';
    html += `<button class="pr solid" data-act="detail" data-id="${esc(p.workout.id)}"><span class="l"><span class="tag">${t('today.newPr')}</span><strong>${esc(headline)}</strong><span class="p">${esc(sub)}</span></span>${chart}</button>`;
  }
  return html;
}
