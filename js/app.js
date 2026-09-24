// Entry point: navigation, dock, clock, service worker updates.
import * as store from './store.js';
import { state } from './store.js';
import { planFromHistory, elapsedSec } from './workout.js';
import { clock } from './format.js';
import { setHapticsGate, haptic } from './haptics.js';
import { keepAwake } from './wakelock.js';
import { $, esc } from './ui/dom.js';
import { I } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { handlePop } from './ui/sheet.js';
import { renderToday } from './ui/today.js';
import { renderWorkout, initWorkout, tickWorkout, syncNums, setWorkoutNav } from './ui/workout.js';
import { renderHistory, renderDetail } from './ui/history.js';
import { renderSettings, initSettings } from './ui/settings.js';
import { initVoice, orbHTML, voiceHandlePop, closeVoice, isVoiceOpen } from './ui/voice.js';

const TABS = ['today', 'workout', 'history'];
const SUB = ['detail', 'settings'];
const view = { screen: 'today', detailId: null, parent: 'history' };
const actions = {};
const app = $('#app');

setHapticsGate(() => state.settings.haptics);

// ---------- rendering ----------

function renderScreen(name = view.screen) {
  const root = $('#s-' + name);
  if (name === 'today') renderToday(root);
  else if (name === 'workout') renderWorkout(root);
  else if (name === 'history') renderHistory(root);
  else if (name === 'detail') renderDetail(root, view.detailId);
  else if (name === 'settings') renderSettings(root);
}

// Built once; later renders only move the pill and relabel, so the indicator can glide.
function renderDock() {
  const { t } = state;
  const dock = $('#dock');
  const tab = (name, icon, cls = '') => `<button class="tab${cls}" data-act="go" data-to="${name}">${icon}<span>${t('tab.' + name)}</span></button>`;
  if (!dock.dataset.built || dock.dataset.lang !== state.lang) {
    dock.innerHTML = '<span class="ind" aria-hidden="true"></span>' + tab('today', I.home) + tab('workout', I.workout) + orbHTML() + tab('history', I.history, ' wide');
    dock.dataset.built = '1';
    dock.dataset.lang = state.lang;
  }
  let on = null;
  for (const b of dock.querySelectorAll('.tab')) {
    const is = b.dataset.to === view.screen;
    b.classList.toggle('on', is);
    if (is) { b.setAttribute('aria-current', 'page'); on = b; } else b.removeAttribute('aria-current');
  }
  const ind = dock.querySelector('.ind');
  if (on && on.offsetWidth) {
    ind.style.width = on.offsetWidth + 'px';
    ind.style.transform = `translateX(${on.offsetLeft}px)`;
    requestAnimationFrame(() => ind.classList.add('ready'));
  }
}

function renderMini() {
  const w = state.active;
  const show = !!w && view.screen !== 'workout' && !SUB.includes(view.screen);
  app.classList.toggle('has-mini', show);
  const el = $('#minibar');
  el.tabIndex = show ? 0 : -1;
  if (!w) return;
  const cur = w.exercises[w.current];
  el.innerHTML = `<span class="dot"></span><span class="l"><strong>${esc(cur ? state.catalog.name(cur.exerciseId, state.lang) : state.t('workout.emptyTitle'))}</strong><span data-elapsed>${clock(elapsedSec(w))}</span></span><span class="go">${I.up}</span>`;
}

function renderAll() {
  document.documentElement.lang = state.lang;
  document.documentElement.dataset.motion = state.settings.motion;
  renderScreen();
  renderDock();
  renderMini();
}

// Direction for the transition: tabs by position, sub screens push in from the right.
const ORDER = { today: 0, workout: 1, history: 2, detail: 3, settings: 3 };
function show(name, { back = false } = {}) {
  const prev = view.screen;
  view.screen = name;
  const dir = prev === name ? 0 : (back ? -1 : Math.sign((ORDER[name] ?? 0) - (ORDER[prev] ?? 0)) || 1);
  for (const s of document.querySelectorAll('.screen')) {
    const on = s.dataset.screen === name;
    const was = s.classList.contains('on');
    if (on && !was) {
      s.classList.add('instant');
      s.style.setProperty('--off-x', `${dir * 28}px`);
      void s.offsetWidth;
      s.classList.remove('instant');
      s.classList.add('on', 'enter');
      clearTimeout(s._enter);
      s._enter = setTimeout(() => s.classList.remove('enter'), 800);
    } else if (!on && was) {
      s.style.setProperty('--off-x', `${-dir * 28}px`);
      s.classList.remove('on', 'enter');
    }
    s.inert = !on;
  }
  app.classList.toggle('sub', SUB.includes(name));
  renderAll();
}

// Tabs replace the current history entry; sub screens push one so Android back works.
function go(name, { quiet = false } = {}) {
  if (!TABS.includes(name)) return;
  if (name === view.screen) { if (!quiet) $('#s-' + name).scrollTo({ top: 0, behavior: 'smooth' }); return; }
  history.replaceState({ screen: name }, '');
  $('#s-' + name).scrollTop = 0;
  show(name);
}

function pushSub(name, extra = {}) {
  view.parent = TABS.includes(view.screen) ? view.screen : view.parent;
  Object.assign(view, extra);
  history.pushState({ screen: name, ...extra, parent: view.parent }, '');
  $('#s-' + name).scrollTop = 0;
  show(name);
}

function showDetail(id, { fromFinish = false } = {}) {
  if (fromFinish) {
    // After finishing, land in History with the detail on top.
    history.replaceState({ screen: 'history' }, '');
    view.screen = 'history';
  }
  pushSub('detail', { detailId: id });
}

addEventListener('popstate', e => {
  if (handlePop()) return;
  if (voiceHandlePop()) return;
  const s = e.state || { screen: 'today' };
  if (s.detailId) view.detailId = s.detailId;
  const next = TABS.includes(s.screen) || SUB.includes(s.screen) ? s.screen : 'today';
  show(next, { back: SUB.includes(view.screen) && !SUB.includes(next) });
});

// ---------- actions ----------

Object.assign(actions, {
  go: el => { if (el.closest('#dock')) haptic('tap'); go(el.dataset.to); },
  back: () => history.back(),
  'open-settings': () => pushSub('settings'),
  detail: el => pushSub('detail', { detailId: el.dataset.id }),
  'start-routine': el => {
    const r = state.routines.find(r => r.id === el.dataset.id);
    if (!r || state.active) return go('workout');
    store.startWorkout(planFromHistory(r, state.history));
    haptic('success');
    go('workout');
  },
  'start-empty': () => {
    if (!state.active) store.startWorkout({});
    haptic('success');
    go('workout');
  }
});
initWorkout($('#s-workout'), actions);
initSettings(actions, $('#s-settings'));
setWorkoutNav({ go, showDetail });
initVoice({ go: name => go(name, { quiet: true }), showDetail, openSettings: () => pushSub('settings') });

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !app.contains(el)) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

store.subscribe(reason => {
  keepAwake(!!state.active);
  if (reason === 'draft') return syncNums($('#s-workout'));
  if (reason === 'reset' && isVoiceOpen()) closeVoice();
  // a re-render mid-entrance would restart the stagger; let the entrance end instead
  document.querySelector('.screen.on.enter')?.classList.remove('enter');
  if (reason === 'error') {
    if (state.error) toast({ title: esc(state.t('toast.storageError')), error: true, ms: 6000 });
    return;
  }
  renderAll();
});

// ---------- clock: derived from timestamps, only while visible ----------

let ticker = 0;
function tick() {
  const w = state.active;
  if (!w) return;
  const now = Date.now();
  const txt = clock(elapsedSec(w, now));
  for (const el of document.querySelectorAll('[data-elapsed]')) if (el.textContent !== txt) el.textContent = txt;
  if (view.screen === 'workout') tickWorkout($('#s-workout'), now);
}
function startClock() { if (!ticker) ticker = setInterval(tick, 250); tick(); }
function stopClock() { clearInterval(ticker); ticker = 0; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { startClock(); renderAll(); }
  else stopClock();
});

// ---------- service worker ----------

function initSW() {
  if (!('serviceWorker' in navigator)) return;
  // Reload only when the user asked for the update (first install also fires controllerchange).
  let asked = false, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!asked || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = () => {
      if (!reg.waiting || !navigator.serviceWorker.controller) return;
      const el = $('#update');
      el.innerHTML = `<i></i>${esc(state.t('toast.update'))}`;
      el.tabIndex = 0;
      el.classList.add('show');
      el.onclick = async () => { asked = true; await store.flush(); reg.waiting?.postMessage('skipWaiting'); };
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => { if (sw.state === 'installed') offer(); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

// ---------- boot ----------

async function boot() {
  try {
    await store.init();
  } catch (e) {
    console.error('init failed', e?.name);
    document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;inset:auto 20px 40px;z-index:99;color:#FF8A9A;font-weight:700;text-align:center">${esc(state.t('toast.storageError'))}</p>`);
  }
  if (new URLSearchParams(location.search).has('seed')) {
    const { seed } = await import('./seed.js');
    await seed(store);
  }
  const start = state.active ? 'workout' : 'today';
  history.replaceState({ screen: start }, '');
  show(start);
  startClock();
  initSW();
}

boot();

addEventListener('pageshow', e => { if (e.persisted) renderAll(); });
addEventListener('resize', () => renderDock());
