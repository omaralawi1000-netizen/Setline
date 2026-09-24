// Entry point: navigation, dock, clock, service worker updates.
import * as store from './store.js';
import { state } from './store.js';
import { elapsedSec, nextSetNumber } from './workout.js';
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
import { initVoice, orbHTML, voiceHandlePop, closeVoice, isVoiceOpen, openVoice } from './ui/voice.js';
import { renderCoach, initCoach, ask as askCoach, ensureModels } from './ui/coach.js';
import { initCardio, setCardioNav, tickCardio, renderCardioDetail, syncGps, startCardioSession, pickTypeSheet } from './ui/cardio.js';
import { initBody } from './ui/body.js';
import { initRoutine, setRoutineNav, renderRoutine, editRoutine, programsSheet, startRoutine } from './ui/routine.js';
import { setHistoryFilter } from './ui/history.js';
import { renderProgress, renderExercise, setRange } from './ui/progress.js';
import { countAll, burst } from './ui/fx.js';
import { initPress } from './ui/press.js';
import { autoBackup } from './ui/drive.js';
import { initHandsFree } from './ui/handsfree.js';
import { onCheckinClick } from './ui/checkin.js';
import { renderBody, initBodyScreen } from './ui/bodyscreen.js';
import { openScanner } from './ui/scan.js';
import { openMealSheet } from './ui/meal.js';
import { cardioElapsed, cardioName } from './cardio.js';
import { weekStart } from './stats.js';
import { nextRoutine } from './routines.js';
import { repeatTemplate } from './insights.js';

const TABS = ['today', 'workout', 'coach', 'history'];
const SUB = ['detail', 'settings', 'routine', 'progress', 'exercise', 'body'];
const view = { screen: 'today', detailId: null, detailKind: 'workout', parent: 'history' };
const actions = {};
const app = $('#app');

setHapticsGate(() => state.settings.haptics);

// ---------- rendering ----------

function renderScreen(name = view.screen) {
  const root = $('#s-' + name);
  if (name === 'today') renderToday(root);
  else if (name === 'workout') renderWorkout(root);
  else if (name === 'history') renderHistory(root);
  else if (name === 'coach') renderCoach(root);
  else if (name === 'detail') (view.detailKind === 'cardio' ? renderCardioDetail : renderDetail)(root, view.detailId);
  else if (name === 'routine') renderRoutine(root);
  else if (name === 'progress') renderProgress(root);
  else if (name === 'exercise') renderExercise(root, view.exerciseId);
  else if (name === 'settings') renderSettings(root);
  else if (name === 'body') renderBody(root);
}

// Built once; later renders only move the pill and relabel, so the indicator can glide.
function renderDock() {
  const { t } = state;
  const dock = $('#dock');
  const tab = (name, icon, cls = '') => `<button class="tab${cls}" data-act="go" data-to="${name}">${icon}<span>${t('tab.' + name)}</span></button>`;
  if (!dock.dataset.built || dock.dataset.lang !== state.lang) {
    dock.innerHTML = '<span class="ind" aria-hidden="true"></span>' + tab('today', I.home) + tab('workout', I.workout) + orbHTML() + tab('coach', I.chat) + tab('history', I.history);
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
    const to = `translateX(${on.offsetLeft}px)`;
    if (ind.style.transform && ind.style.transform !== to) { ind.classList.remove('moving'); void ind.offsetWidth; ind.classList.add('moving'); }
    ind.style.width = on.offsetWidth + 'px';
    ind.style.transform = to;
    requestAnimationFrame(() => ind.classList.add('ready'));
  }
}

function renderMini() {
  const w = state.active;
  const a = state.activeCardio;
  const show = !!(w || a) && view.screen !== 'workout' && !SUB.includes(view.screen);
  app.classList.toggle('has-mini', show);
  const el = $('#minibar');
  el.tabIndex = show ? 0 : -1;
  if (!w && a) {
    el.innerHTML = `<span class="dot${a.pausedAt ? ' paused' : ''}"></span><span class="l"><strong>${esc(cardioName(a.type, state.lang))}</strong><span data-cclock>${clock(cardioElapsed(a))}</span></span><span class="go">${I.up}</span>`;
    return;
  }
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
  // numbers count up the first time a screen is shown, not on every change
  const root = $('#s-' + view.screen);
  if (root && root._counted === false) { root._counted = true; countAll(root, state.lang); }
  else root?.querySelectorAll('[data-count]').forEach(el => { el.textContent = new Intl.NumberFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: Number(el.dataset.dp || 0), minimumFractionDigits: Number(el.dataset.dp || 0) }).format(Number(el.dataset.count)); });
}

// Direction for the transition: tabs by position, sub screens push in from the right.
const ORDER = { today: 0, workout: 1, coach: 2, history: 3, detail: 4, settings: 4, routine: 4, progress: 4, body: 4, exercise: 5 };
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
      s._counted = false;
      clearTimeout(s._enter);
      s._enter = setTimeout(() => s.classList.remove('enter'), 800);
    } else if (!on && was) {
      s.style.setProperty('--off-x', `${-dir * 28}px`);
      s.classList.remove('on', 'enter');
    }
    s.inert = !on;
  }
  app.classList.toggle('is-sub', SUB.includes(name));
  app.classList.toggle('coaching', name === 'coach');
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

function showDetail(id, { fromFinish = false, kind = 'workout' } = {}) {
  view.detailKind = kind;
  if (fromFinish) {
    // After finishing, land in History with the detail on top.
    history.replaceState({ screen: 'history' }, '');
    view.screen = 'history';
  }
  pushSub('detail', { detailId: id, detailKind: kind });
  if (fromFinish) setTimeout(celebrate, 380);
}

// Finishing is a moment: sparks from the summary, warm ones for every record.
function celebrate() {
  const root = $('#s-detail');
  const hero = root.querySelector('.summary');
  if (!hero) return;
  hero.classList.add('celebrate');
  burst(hero, { count: 22, spread: 120 });
  const prs = [...root.querySelectorAll('.prs li, .prs .tag')];
  prs.slice(0, 4).forEach((el, i) => setTimeout(() => burst(el, { warm: true, count: 12, spread: 60 }), 350 + i * 160));
}

addEventListener('popstate', e => {
  if (handlePop()) return;
  if (voiceHandlePop()) return;
  const s = e.state || { screen: 'today' };
  if (s.detailId) { view.detailId = s.detailId; view.detailKind = s.detailKind || 'workout'; }
  if (s.exerciseId) view.exerciseId = s.exerciseId;
  const next = TABS.includes(s.screen) || SUB.includes(s.screen) ? s.screen : 'today';
  show(next, { back: SUB.includes(view.screen) && !SUB.includes(next) });
});

// ---------- actions ----------

Object.assign(actions, {
  go: el => { if (el.closest('#dock')) haptic('tap'); go(el.dataset.to); },
  back: () => history.back(),
  'open-settings': () => pushSub('settings'),
  detail: el => pushSub('detail', { detailId: el.dataset.id, detailKind: el.dataset.kind || 'workout' }),
  'start-routine': el => startRoutine(el.dataset.id),
  'repeat-workout': el => {
    const w = state.history.find(x => x.id === el.dataset.id);
    if (!w) return;
    if (state.active || state.activeCardio) return go('workout');
    store.startWorkout(repeatTemplate(w));
    haptic('success');
    go('workout');
  },
  'start-empty': () => {
    if (state.activeCardio) return go('workout');
    if (!state.active) store.startWorkout({});
    haptic('success');
    go('workout');
  }
});
initPress(document);
initHandsFree();
initBodyScreen($('#s-body'));
initWorkout($('#s-workout'), actions);
initSettings(actions, $('#s-settings'));
setWorkoutNav({ go, showDetail });
initVoice({ go: name => go(name, { quiet: true }), showDetail, openSettings: () => pushSub('settings') });
initCoach({ openSettings: () => pushSub('settings') });
setCardioNav({ go, showDetail });
initCardio();
initBody();
setRoutineNav({ go, openRoutine: () => pushSub('routine'), back: () => history.back() });
initRoutine($('#s-routine'));

// buttons shared across screens
app.addEventListener('click', e => {
  const r = e.target.closest('[data-routine]');
  if (r) {
    haptic('tap');
    if (r.dataset.routine === 'new') editRoutine(null);
    else if (r.dataset.routine === 'edit') editRoutine(r.dataset.id);
    else if (r.dataset.routine === 'programs') programsSheet();
    return;
  }
  const ex = e.target.closest('[data-ex]');
  if (ex) { haptic('tap'); pushSub('exercise', { exerciseId: ex.dataset.ex }); return; }
  if (e.target.closest('[data-progress]')) { haptic('tap'); pushSub('progress'); return; }
  if (e.target.closest('[data-bodyscreen]')) { haptic('tap'); pushSub('body'); return; }
  const pr = e.target.closest('[data-prange]');
  if (pr) { setRange(Number(pr.dataset.prange)); haptic('tap'); renderScreen('progress'); countAll($('#s-progress'), state.lang); return; }
  const f = e.target.closest('[data-hfilter]');
  if (f) { setHistoryFilter(f.dataset.hfilter); haptic('tap'); renderScreen('history'); return; }
  if (e.target.closest('[data-review=ask]')) { go('coach'); askCoach(state.t('review.prompt')); }
  const ck = e.target.closest('[data-ck]');
  if (ck && !ck.disabled) { onCheckinClick(ck, () => { renderScreen('today'); }); return; }
  const dl = e.target.closest('[data-deload]');
  if (dl) {
    haptic('tap');
    const k = dl.dataset.deload, now = Date.now();
    if (k === 'start') { store.setSettings({ deloadUntil: weekEnd(now), deloadSnoozed: 0 }); toast({ title: esc(state.t('deload.started')), sub: esc(state.t('deload.sub')) }); }
    else if (k === 'later') store.setSettings({ deloadSnoozed: now + 14 * 86_400_000 });
    else if (k === 'end') store.setSettings({ deloadUntil: 0, deloadSnoozed: now + 21 * 86_400_000 });
  }
});

// A deload runs to the end of next Sunday if started late in the week, else to this Sunday.
function weekEnd(now) {
  const end = weekStart(now) + 7 * 86_400_000;
  return end - now < 3 * 86_400_000 ? end + 7 * 86_400_000 : end;
}

app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || !app.contains(el)) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

// Rest alerts: when rest ends while the screen is off, a notification with the next set.
let restTimer = 0, restFor = 0;
function scheduleRestAlert() {
  const r = state.active?.rest;
  if (!state.settings.restAlerts || !r || r.endsAt <= Date.now()) { clearTimeout(restTimer); restFor = 0; return; }
  if (restFor === r.endsAt) return;
  clearTimeout(restTimer);
  restFor = r.endsAt;
  restTimer = setTimeout(async () => {
    restFor = 0;
    if (document.visibilityState === 'visible' || Notification.permission !== 'granted') return;
    const w = state.active, ex = w?.exercises[w.current];
    const reg = await navigator.serviceWorker?.ready;
    reg?.showNotification(state.t('workout.restDone'), {
      body: ex ? `${state.catalog.name(ex.exerciseId, state.lang)} · ${state.t('workout.setNext', { n: nextSetNumber(ex) })}` : '',
      tag: 'setline-rest', renotify: true, icon: 'icons/icon-192.png', vibrate: [120, 80, 120]
    });
  }, r.endsAt - Date.now());
}

store.subscribe(reason => {
  keepAwake(!!state.active || !!state.activeCardio);
  if (reason === 'finish' || (reason === 'cardio' && !state.activeCardio)) setTimeout(autoBackup, 1500);
  syncGps();
  scheduleRestAlert();
  if (reason === 'draft') return syncNums($('#s-workout'));
  if (reason === 'chat' && view.screen !== 'coach') return;
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
  const a = state.activeCardio;
  if (a) {
    const txt = clock(cardioElapsed(a));
    for (const el of document.querySelectorAll('[data-cclock]')) if (el.textContent !== txt) el.textContent = txt;
    if (view.screen === 'workout' && !state.active) tickCardio($('#s-workout'));
  }
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
  const start = state.active || state.activeCardio ? 'workout' : 'today';
  history.replaceState({ screen: start }, '');
  show(start);
  startClock();
  initSW();
  ensureModels();
  shortcut();
  autoBackup();
}

// Home-screen shortcuts (long-press the icon): ?go=next | cardio | talk
function shortcut() {
  const q = new URLSearchParams(location.search);
  const to = q.get('go');
  if (!to) return;
  q.delete('go');
  history.replaceState(history.state, '', location.pathname + (q.size ? `?${q}` : ''));
  if (to === 'next') {
    if (state.active || state.activeCardio) return go('workout');
    const r = nextRoutine([...state.routines].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), state.history);
    if (r) startRoutine(r.id);
  } else if (to === 'cardio') {
    if (state.active || state.activeCardio) return go('workout');
    pickTypeSheet({ onPick: startCardioSession });
  } else if (to === 'talk') setTimeout(openVoice, 250);
  else if (to === 'scan') setTimeout(openScanner, 250);
  else if (to === 'meal') setTimeout(() => openMealSheet(), 250);
}

boot();

addEventListener('pageshow', e => { if (e.persisted) renderAll(); });
addEventListener('resize', () => renderDock());


// Android keeps the layout size when the keyboard opens; lift the composer above it and hide the dock.
if (globalThis.visualViewport) {
  const vv = visualViewport;
  const onVV = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    app.style.setProperty('--kb', kb + 'px');
    app.classList.toggle('kb', kb > 120);
  };
  vv.addEventListener('resize', onVV);
  vv.addEventListener('scroll', onVV);
}
