// Today: greeting, start a routine or an empty workout, or resume.
import { state } from '../store.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { routineName, estimateMinutes } from '../routines.js';
import { greetingKey, clock } from '../format.js';
import { doneSetCount, elapsedSec } from '../workout.js';
import { getKey } from '../keys.js';

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
  root.innerHTML = `
    <header class="brand">
      <div><strong>Setline</strong><span>${t('app.tagline')}</span></div>
      <button class="iconbtn" data-act="open-settings" aria-label="${t('settings.title')}">${I.settings}</button>
    </header>
    <h1 class="greet">${t(greetingKey(hour))}</h1>
    <p class="sub">${t(w ? 'today.inProgress' : 'today.ready')}</p>
    ${main}`;
}
