// Voice: the Orb, the voice screen, and the intent card.
// Pipeline: hold → record → Groq → parser → intent card → auto-commit (or confirm) → spoken reply.
import * as store from '../store.js';
import { openPicker } from './picker.js';
import { state } from '../store.js';
import * as mic from '../voice.js';
import * as tts from '../tts.js';
import { transcribe, buildPrompt } from '../stt.js';
import { quickReport, noteHeard, noteMixup, openQuickReport, FLAG } from './report.js';
import { parse } from '../parser.js';
import { resolve, AUTO_MS } from '../commands.js';
import { translator } from '../i18n.js';
import { getKey } from '../keys.js';
import { sttModelId, ttsModelId, ttsAlt } from '../settings.js';
import { firstPlannedIndex, lastDoneIndex, restRemaining, suggestNext, lastSession } from '../workout.js';
import { unlockAudio } from '../audio.js';
import { haptic } from '../haptics.js';
import { $, esc } from './dom.js';
import { I } from './icons.js';
import { hideToast, toast } from './toast.js';
import { makeCustom } from '../catalog.js';
import { aiCommand, withFallback } from '../ai.js';
import { openMealSheet } from './meal.js';
import { foodTargets } from './food.js';
import { aiMeal } from '../ai.js';
import { MEAL_SCHEMA, mealPrompt, validateMeal } from '../meals.js';
import { coachModels } from '../settings.js';
import { addGoal } from './goals.js';
import { isQuestion, isPlanRequest, isNoise } from '../coach.js';
import { startCardioSession, finishSheet as cardioFinishSheet } from './cardio.js';
import { dateKey } from '../body.js';
import { planFor } from './routine.js';
import { orbPulse, orbShake, orbSpark } from './fx.js';
import { setOrb, handOrb } from './dotorb.js';
import { livePRSets } from '../pr.js';
import { createVoiceGlow } from './voiceglow.js';
import { ask as askCoach, ensureModels, wordsFrom, syncSpot } from './coach.js';
import { arcFly, releaseOrb } from './choreo.js';
import { cmdModels } from '../settings.js';
import { createEndpointer, looksUnfinished } from '../endpoint.js';
import { onFrame, nextFrame } from './frame.js';
import { perfNote } from './perf.js';

const endpoint = createEndpointer({ pauseMs: 850 });
const WAIT_MS = 3000; // sounded unfinished: still send after this much quiet

const HOLD_MS = 280;          // shorter press = tap
const BARS = 27;
const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

let nav = { go: () => {}, showDetail: () => {}, openSettings: () => {} };
const v = {
  mode: 'full',   // 'mini' = the orb floating above the dock, 'full' = the voice screen
  open: false, phase: 'idle', toggle: false, typing: false,
  press: null, token: 0, closing: null, popWaiting: 0,
  raf: 0, lvl: 0, lo: 0, hi: 0, hist: new Float32Array(64), histAt: 0
};
const card = { cmd: null, timer: 0, hideTimer: 0, committed: false, undoOp: null };

const el = {};

// ---------- helpers ----------

const tFor = lang => translator(lang || state.lang);
const langFor = intent => (state.settings.voiceLang === 'auto' ? intent.lang : state.settings.voiceLang) || state.lang;

// The numbers on the steppers right now (planned set, or what was dialed in).
const shownValues = ex => suggestNext(ex, lastSession(state.history, ex.exerciseId), state.catalog.get(ex.exerciseId)?.equipment === 'bodyweight' ? 0 : 20);

function parseCtx() {
  const w = state.active;
  const ex = w?.exercises[w.current];
  const li = ex ? lastDoneIndex(ex) : -1;
  const pi = ex ? firstPlannedIndex(ex) : -1;
  return {
    lang: state.settings.voiceLang, unit: state.settings.unit, catalog: state.catalog, usage: state.usage, now: Date.now(),
    routines: state.routines, workoutExerciseIds: w ? w.exercises.map(e => e.exerciseId) : [],
    current: ex ? { exerciseId: ex.exerciseId, lastSet: li >= 0 ? ex.sets[li] : null, planned: pi >= 0 ? ex.sets[pi] : null, shown: shownValues(ex) } : null,
    restRunning: !!(w && restRemaining(w.rest) > 0),
    screen: document.querySelector('.screen.on')?.id?.replace(/^s-/, '') || ''
  };
}

const snapshot = () => ({
  nameLang: state.lang, planFor, active: state.active, cardio: state.cardio, activeCardio: state.activeCardio,
  bodyweight: state.bodyweight, nutrition: state.nutrition, daily: state.daily, history: state.history, prs: state.prs, routines: state.routines,
  undoCount: state.undo.length, settings: state.settings, catalog: state.catalog, usage: state.usage, now: Date.now(), targets: foodTargets()
});

function speak(text, lang) {
  if (!text || state.settings.spoken === 'off') return;
  tts.speak(text, {
    key: getKey('google'), model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang,
    canSpeak: () => !mic.isRecording()
  });
}

// ---------- voice screen ----------

function build() {
  const layer = $('#voice');
  layer.innerHTML = `
    <div class="vbg"></div>
    <header class="top">
      <button class="iconbtn" data-v="close">${I.close}</button>
      <div class="live" id="vstatus"><i></i><span></span></div>
      <span class="chip" id="vlang"></span>
    </header>
    <div class="stagev" id="vstage">
      <div class="halo" id="vhalo"></div>
      <div class="ripples" id="vripples"><b></b><b></b><b></b></div>
      <span class="orbwrap" id="vorbwrap"><span class="orb big" id="vorb"><i class="core"><b></b><b></b><b></b></i><i class="spin"></i></span></span>
    </div>
    <div class="wave" id="vwave" aria-hidden="true">${'<i></i>'.repeat(BARS)}</div>
    <p class="say" id="vsay" aria-live="polite"></p>
    <div class="vreview" id="vreview" hidden>
      <p class="vrtext" id="vrtext" contenteditable="plaintext-only" enterkeyhint="send" spellcheck="true" autocapitalize="sentences"></p>
      <p class="vrhint" id="vrhint"></p>
      <div class="vracts"><button class="vrmic" data-v="more">${micIcon}<span></span></button><button class="vrsend" data-v="send"><span></span>${I.fwd}</button></div>
    </div>
    <form class="typebox solid" id="vtype" autocomplete="off">
      <input id="vinput" enterkeyhint="send" autocapitalize="off" autocorrect="on" spellcheck="false">
      <button class="send" type="submit">${I.fwd}</button>
    </form>
    <div class="hints" id="vhints"></div>
    <button class="hold" id="vhold"><span class="glow"></span>${micIcon}<span id="vholdtxt"></span></button>
    <p class="holdnote" id="vnote"></p>`;
  const mini = document.createElement('div');
  mini.className = 'ofloat';
  mini.id = 'ofloat';
  mini.hidden = true;
  mini.innerHTML = `<div class="oscrim" data-o="cancel"></div>
    <div class="obubble"><span class="ostatus" id="ostatus"></span><p class="osay" id="osay"></p></div>
    <div class="opull" id="opull" aria-hidden="true"><svg class="i" viewBox="0 0 24 24"><path d="M6 14.5l6-6 6 6"/></svg><span></span></div>
    <span class="owrap" id="owrap" data-o="orb"><span class="orb lift" id="oorb"><i class="core"><b></b><b></b><b></b></i><i class="spin"></i></span><span class="oglow"></span></span>`;
  document.getElementById('app').appendChild(mini);
  // the voice glow (voice-glow): under everything on the voice screen, over the floating orb's scrim
  el.glowFull = createVoiceGlow(layer, layer.querySelector('.vbg')?.nextSibling);
  el.glowMini = createVoiceGlow(mini, mini.querySelector('.obubble'));
  Object.assign(el, {
    mini, owrap: mini.querySelector('#owrap'), oorb: mini.querySelector('#oorb'), ostatus: mini.querySelector('#ostatus'), osay: mini.querySelector('#osay'), opull: mini.querySelector('#opull'),
    layer, status: $('#vstatus span'), lang: $('#vlang'), stage: $('#vstage'), halo: $('#vhalo'), ripples: $('#vripples'),
    orbwrap: $('#vorbwrap'), orb: $('#vorb'), wave: $('#vwave'), bars: [...$('#vwave').children], say: $('#vsay'),
    type: $('#vtype'), input: $('#vinput'), hints: $('#vhints'), hold: $('#vhold'), holdtxt: $('#vholdtxt'), note: $('#vnote'),
    card: $('#intent'), dockOrb: null,
    review: $('#vreview'), rtext: $('#vrtext'), rhint: $('#vrhint'), rmore: layer.querySelector('.vrmic'), rsend: layer.querySelector('.vrsend')
  });
}

const micIcon = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0M12 18v3"/></svg>';
const keyboardIcon = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8"/></svg>';

function paintStatic() {
  const t = state.t;
  el.layer.setAttribute('aria-label', t('voice.talk'));
  el.layer.querySelector('[data-v=close]').setAttribute('aria-label', t('common.close'));
  el.lang.textContent = t(`voice.lang.${state.settings.voiceLang}`);
  el.input.placeholder = t('voice.typePh');
  el.type.querySelector('.send').setAttribute('aria-label', t('voice.send'));
  const hints = state.active
    ? ['voice.hint.same', 'voice.hint.add', 'voice.hint.skip', 'voice.hint.next', 'voice.hint.last']
    : ['voice.hint.start', 'voice.hint.log', 'voice.hint.last'];
  el.hints.innerHTML = `<button class="kbd" data-v="type">${keyboardIcon}${t('voice.type')}</button>` +
    hints.map(k => `<button data-v="hint">${esc(t(k))}</button>`).join('');
}

function setPhase(phase) {
  // didn't get it: the orb shakes its head
  if (phase === 'error' && v.phase !== 'error') orbShake(v.mode === 'mini' ? el.oorb : el.orb);
  v.phase = phase;
  el.layer.dataset.phase = phase;
  const t = state.t;
  const status = { idle: 'voice.ready', opening: 'voice.opening', listening: 'voice.listening', thinking: 'voice.thinking', result: 'voice.ready', error: 'voice.ready', review: 'voice.ready', stuck: 'voice.micStuck' }[phase];
  el.status.textContent = t(status);
  const rec = phase === 'listening' || phase === 'opening';
  el.holdtxt.textContent = t(rec ? (v.toggle ? 'voice.tapSend' : v.review ? 'voice.releaseReview' : 'voice.release') : 'voice.hold');
  el.note.textContent = t(rec && v.toggle ? 'voice.tapNote' : 'voice.holdNote');
  el.hold.disabled = phase === 'thinking';
  el.layer.dataset.toggle = v.toggle ? '1' : '';
  el.mini.dataset.phase = phase;
  el.mini.dataset.toggle = v.toggle ? '1' : '';
  el.ostatus.textContent = t(phase === 'listening' && v.toggle ? 'voice.tapSendMini' : status);
  if (phase === 'stuck') el.status.textContent = t('voice.micStuck');
}

const translateY = node => { const t = getComputedStyle(node).transform; return t && t !== 'none' ? new DOMMatrix(t).m42 : 0; };
const scaleOf = node => { const t = getComputedStyle(node).transform; return t && t !== 'none' ? new DOMMatrix(t).a : 1; };

// The dock orb and the flying orbs are separate elements running the same blob animations. Line
// their clocks up before one hands over to the other, so the swap is invisible.
const dockOrb = () => document.querySelector('#dock .orbbtn .orb');
function syncOrb(src, dst) {
  if (!src || !dst) return;
  handOrb(src, dst); // the dotted orbs: the same pose, and just as swollen or lit
  if (dst.classList.contains('dotted')) return; // (their blobs are hidden: nothing else to line up)
  const a = src.querySelectorAll('.core, .core b'), b = dst.querySelectorAll('.core, .core b');
  b.forEach((d, i) => {
    const from = a[i]?.getAnimations?.() || [], to = d.getAnimations?.() || [];
    to.forEach((anim, j) => { if (from[j] && from[j].currentTime != null) anim.currentTime = from[j].currentTime; });
  });
}
// land: the flying orb and the dock orb swap in the same frame
function landOrb(src, after) {
  const app = document.getElementById('app');
  syncOrb(src, dockOrb());
  app.classList.add('orbland');
  app.classList.remove('orbaway');
  orbPulse('pulse-land'); // the dock takes it with a small settle
  after?.();
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('orbland')));
}

// FLIP the big orb to/from the dock orb. Works from wherever things are right now,
// so reopening or closing mid-flight (or from the typing layout) doesn't jump.
function flyOrb(open, fromEl = null) {
  const from = fromEl || document.querySelector('#dock .orbbtn .orb');
  const w = el.orbwrap;
  if (!from || reduced()) { w.style.transform = ''; return; }
  const current = getComputedStyle(w).transform;
  w.style.transition = 'none';
  w.style.transform = 'none';
  const b = w.getBoundingClientRect();            // resting box (inside the stage)
  const a = from.getBoundingClientRect();
  if (!a.width || !b.width) { w.style.transition = ''; w.style.transform = ''; return; }
  const k = scaleOf(el.stage) || 1;               // the stage is scaled while typing
  // the dock slides up as we close: aim for where it will be, not where it is
  const dockShift = open ? 0 : translateY(document.getElementById('dock'));
  const dx = (a.left + a.width / 2 - (b.left + b.width / 2)) / k;
  const dy = (a.top + a.height / 2 - dockShift - (b.top + b.height / 2)) / k;
  const far = `translate(${dx}px, ${dy}px) scale(${a.width / b.width})`;
  w.style.transform = open ? far : (current === 'none' ? '' : current);
  void w.offsetWidth;
  w.style.transition = '';
  w.style.transform = open ? '' : far;
}

// ---------- mini mode: the orb lifts out of the dock ----------

function flyMini(open) {
  const from = document.querySelector('#dock .orbbtn .orb');
  const w = el.owrap;
  if (!from || reduced()) { w.style.transform = ''; return; }
  const current = getComputedStyle(w).transform;
  w.style.transition = 'none';
  w.style.transform = 'none';
  const b = el.oorb.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const dockShift = open ? 0 : translateY(document.getElementById('dock'));
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  const dy = a.top + a.height / 2 - dockShift - (b.top + b.height / 2);
  const far = `translate(${dx}px, ${dy}px) scale(${a.width / b.width})`;
  w.style.transform = open ? far : (current === 'none' ? '' : current);
  void w.offsetWidth;
  w.style.transition = open ? '' : 'transform .5s cubic-bezier(.3,.7,.2,1)';
  w.style.transform = open ? '' : far;
}

// Once the voice screen has faded in, the page under it (which still shows through faintly) holds still (.app.voice-covered); it
// comes back the moment the screen starts to close, while the backdrop still covers it.
let coverTimer = 0;
function coverPage(on) {
  const app = document.getElementById('app');
  clearTimeout(coverTimer);
  if (!on) { app.classList.remove('voice-covered'); return; }
  coverTimer = setTimeout(() => { if (v.open && v.mode === 'full') app.classList.add('voice-covered'); }, reduced() ? 160 : 460);
}

function pushVoiceEntry() {
  const push = () => { if (v.open && !history.state?.voice) history.pushState({ ...(history.state || {}), voice: 1 }, ''); };
  if (v.closing) v.closing.then(push); else push();
}

// Food screen's "Say it": lift the orb and start listening straight away.
export function talkNow() {
  unlockAudio();
  if (!v.open) openMini();
  v.toggle = true;
  startRec();
}

export function openMini() {
  hideToast();
  if (v.open) return;
  v.open = true;
  v.mode = 'mini';
  el.osay.innerHTML = '';
  el.osay.classList.remove('over');
  el.owrap.style.translate = '';
  el.owrap.style.visibility = '';
  el.opull.style.opacity = '';
  el.opull.querySelector('span').textContent = state.t('voice.pullUp');
  setPhase('idle');
  document.getElementById('app').classList.add('voice-mini', 'orbaway');
  el.mini.hidden = false;
  syncOrb(dockOrb(), el.oorb);
  void el.mini.offsetWidth;
  el.mini.classList.add('on');
  flyMini(true);
  pushVoiceEntry();
  startLoop();
}

// Hand the live session over to the full voice screen (recording keeps going).
function expandFull() {
  if (!v.open || v.mode !== 'mini') return;
  haptic('tap');
  // pulled up while holding: letting go shows what you said to check first, nothing is sent yet
  v.review = !!v.press;
  const from = el.oorb;
  v.mode = 'full';
  v.typing = false;
  el.layer.classList.remove('typing');
  paintStatic();
  el.say.innerHTML = el.osay.innerHTML;
  document.getElementById('app').classList.add('voice');
  el.layer.hidden = false;
  el.layer.inert = false;
  el.orbwrap.style.transform = '';
  el.orbwrap.style.visibility = '';
  syncOrb(from, el.orb);
  void el.layer.offsetWidth;
  el.layer.classList.add('on');
  flyOrb(true, from);
  coverPage(true);
  setPhase(v.phase);
  el.mini.classList.remove('on');
  el.mini.classList.add('handoff');
  // (the scrim stays up until the voice screen's backdrop has faded in over it: both fading at once let
  // the page show through for a moment)
  setTimeout(() => { if (v.mode !== 'full') return; el.mini.hidden = true; el.mini.classList.remove('handoff'); document.getElementById('app').classList.remove('voice-mini'); el.owrap.style.translate = ''; }, reduced() ? 0 : 420);
}

export function openVoice() {
  hideToast();
  if (v.open) { if (v.mode === 'mini') expandFull(); return; }
  v.open = true;
  v.mode = 'full';
  v.typing = false;
  el.layer.classList.remove('typing');
  paintStatic();
  el.say.innerHTML = '';
  setPhase('idle');
  document.getElementById('app').classList.add('voice', 'orbaway');
  el.layer.hidden = false;
  el.layer.inert = false;
  el.orbwrap.style.transform = '';
  el.orbwrap.style.visibility = '';
  syncOrb(dockOrb(), el.orb);
  void el.layer.offsetWidth;
  el.layer.classList.add('on');
  flyOrb(true);
  coverPage(true);
  // own history entry so Android back closes the layer; wait for a previous close to settle first
  const push = () => { if (v.open && !history.state?.voice) history.pushState({ ...(history.state || {}), voice: 1 }, ''); };
  if (v.closing) v.closing.then(push); else push();
  startLoop();
}

// Close; resolves once history has settled so callers can navigate safely.
export function closeVoice({ fromPop = false } = {}) {
  if (!v.open) return v.closing || Promise.resolve();
  nav.warmCoach?.(false);
  v.open = false;
  v.token++;
  v.press = null;
  v.toggle = false;
  mic.cancel();
  // (what you said stays on the screen while it fades; it's cleared once the screen has gone)
  v.review = false; v.reviewing = false;
  if (v.mode === 'mini') {
    endReview();
    // the orb sinks back into the dock
    el.mini.classList.remove('on');
    el.oorb.style.transform = '';
    el.owrap.style.translate = '';
    flyMini(false);
    document.getElementById('app').classList.remove('voice-mini'); // the dock comes back for the orb to land in
    let landed = false;
    const land = e => {
      if (landed || v.open || (e && e.propertyName !== 'transform')) return;
      landed = true;
      landOrb(el.oorb, () => { el.mini.hidden = true; document.getElementById('app').classList.remove('voice-mini'); });
    };
    el.owrap.addEventListener('transitionend', land);
    setTimeout(() => { el.owrap.removeEventListener('transitionend', land); land(); }, reduced() ? 0 : 640);
    setTimeout(() => { if (!v.open) { el.mini.hidden = true; stopLoop(); el.owrap.style.transform = ''; el.owrap.style.transition = ''; } }, 600);
    if (fromPop || !history.state?.voice) return v.closing || Promise.resolve();
    v.closing = new Promise(res => { v.popWaiting++; v.popResolve = res; history.back(); }).then(() => { v.closing = null; });
    return v.closing;
  }
  el.input.blur();
  coverPage(false);
  // the orb goes home (the dock's orb, or the message box's in the Coach) on the same kind of gentle
  // curve as everything else, while the screen fades
  const app = document.getElementById('app'), dock = document.getElementById('dock');
  const home = app.classList.contains('coaching') ? document.querySelector('#composer .corb .orb') : dockOrb();
  const hb = home?.getBoundingClientRect(), ab = app.getBoundingClientRect();
  const lift = app.classList.contains('coaching') ? 0 : new DOMMatrix(getComputedStyle(dock).transform).m42 || 0; // (the dock is on its way back up)
  const to = hb && { x: hb.left - ab.left + hb.width / 2, y: hb.top - ab.top + hb.height / 2 - lift, w: hb.width };
  dock.style.transition = 'opacity .3s var(--e-out)'; // (it comes back in place: the orb lands on it, not on a moving target)
  // its words and buttons drop to a fifth while the backdrop still covers the page, then the page comes
  // up as they finish going (never a dark moment, never both screens at once)
  el.layer.classList.add('closing');
  const fades = reduced() ? [...el.layer.children].map(c => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear', fill: 'forwards' })) : [
    el.layer.querySelector('.vbg')?.animate([{ opacity: 1 }, { opacity: 0.84, offset: 0.32, easing: 'ease-out' }, { opacity: 0 }], { duration: 200, fill: 'forwards' }),
    ...[...el.layer.children].filter(c => !c.classList.contains('vbg')).map(c => c.animate([{ opacity: 1 }, { opacity: 0.2, offset: 0.6 }, { opacity: 0 }], { duration: 100, easing: 'linear', fill: 'forwards' }))
  ].filter(Boolean);
  el.layer.classList.remove('on');
  el.layer.inert = true;
  el.orb.style.transform = '';
  app.classList.remove('voice');
  el.layer.classList.remove('carded');
  const token = v.token;
  const flown = home ? arcFly(el.orb, home, { to, keepFrom: true, onland: () => {
    app.classList.add('orbland'); app.classList.remove('orbaway'); // (the dock's orb is there on the same frame, not faded in)
    requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('orbland')));
  } }) : Promise.resolve();
  flown.then(() => {
    dock.style.transition = '';
    releaseOrb(el.orb);
    el.layer.classList.remove('closing');
    if (!v.reviewing) endReview(); // (unless a new review has begun since)
    fades.forEach(f => f.cancel());
    if (v.open || v.token !== token) return; // (opened again meanwhile)
    app.classList.remove('orbaway');
    el.layer.hidden = true; stopLoop(); el.orbwrap.style.transform = '';
  });
  // only step back over our own entry, never past it (that would leave the app)
  if (fromPop || !history.state?.voice) return v.closing || Promise.resolve();
  v.closing = new Promise(res => { v.popWaiting++; v.popResolve = res; history.back(); }).then(() => { v.closing = null; });
  return v.closing;
}

// reopened while the old entry was being popped: give the open layer its entry back
function push2() { if (!history.state?.voice) history.pushState({ ...(history.state || {}), voice: 1 }, ''); }

// popstate hook: returns true if the voice layer consumed it.
export function voiceHandlePop() {
  if (v.popWaiting) { v.popWaiting--; v.popResolve?.(); if (v.open) push2(); return true; }
  if (v.open) { closeVoice({ fromPop: true }); return true; }
  return false;
}

// ---------- level animation (transform/opacity only) ----------

const WANT = { state: 'idle', level: 0, bands: [0, 0, 0], b8: null }, B8 = new Float32Array(8), QUIETB = { low: 0, high: 0, rms: 0, voice: [0, 0, 0] }, GSRC = { listening: false, processing: false, rms: 0, voice: null };
function startLoop() {
  if (v.raf) return;
  const tick = now => {
    const listening = v.phase === 'listening';
    const target = listening ? mic.level() : 0;
    v.lvl += (target - v.lvl) * (target > v.lvl ? 0.45 : 0.12);
    v.hist[v.histAt = (v.histAt + 1) % v.hist.length] = v.lvl;
    // tapped to talk: a pause sends it, but only once what you said sounds finished
    const dt = v.lastTick ? now - v.lastTick : 0;
    v.lastTick = now;
    if (listening && v.toggle) {
      const ev = endpoint.push(target, dt);
      if (ev === 'pause') speculate();
      else if (ev === 'resume') { v.spec = null; v.waiting = false; setPausing(''); }
      if (v.waiting && endpoint.quietMs >= WAIT_MS) { v.waiting = false; finishRec(); }
    }
    // the voice glow along the bottom: the recorder's own level and bands while it records, the
    // processing sweep while the words are worked out, nothing otherwise (a meter, so it keeps
    // answering the voice with reduced motion; only its breathing, flow and sweep stop)
    const b = listening ? mic.bands() : QUIETB;
    const glow = v.mode === 'mini' ? el.glowMini : el.glowFull, quiet = v.mode === 'mini' ? el.glowFull : el.glowMini;
    const gsrc = GSRC; gsrc.listening = listening; gsrc.processing = v.phase === 'thinking'; gsrc.rms = b.rms; gsrc.voice = b.voice;
    glow?.step(Math.min(0.05, dt / 1000), gsrc, reduced());
    if (quiet?.on) quiet.off();
    // the dotted orb ripples with the voice (the lows round its middle, the highs at its poles)
    // (one state object and one band array, refilled each frame: nothing allocated per frame)
    WANT.state = !v.open ? 'idle' : listening ? 'listening' : v.phase === 'thinking' ? 'thinking' : 'idle';
    WANT.level = v.lvl; WANT.bands[0] = b.low; WANT.bands[1] = b.voice[1] * 3; WANT.bands[2] = b.high;
    WANT.b8 = listening && mic.bands8(B8) ? B8 : null;
    setOrb(v.mode === 'mini' ? el.oorb : el.orb, WANT);
    if (reduced()) return;
    const l = v.lvl;
    // the body of the voice swells the orb's core, its edge (s, t, k) lights the rim
    v.lo += (b.low - v.lo) * (b.low > v.lo ? 0.4 : 0.12);
    v.hi += (b.high - v.hi) * (b.high > v.hi ? 0.55 : 0.18);
    const fq = v.mode === 'mini' ? el.oorb : el.orb;
    if (!fq.classList.contains('dotted')) { // (the blobs and rim they light are hidden on a dotted orb)
      fq.style.setProperty('--lo', v.lo.toFixed(3));
      fq.style.setProperty('--hi', v.hi.toFixed(3));
    }
    // alive, not mechanical: a slow breath, and a soft squash and stretch that follows the voice
    const breath = v.phase === 'thinking' ? 0 : 0.012 * Math.sin(now / 700);
    const sx = 1 + breath + l * 0.07 + l * 0.025 * Math.sin(now / 95);
    const sy = 1 + breath + l * 0.09 + l * 0.025 * Math.cos(now / 110);
    if (v.mode === 'mini') {
      el.oorb.style.transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      el.owrap.style.setProperty('--l', l.toFixed(3));
      return;
    }
    el.orb.style.transform = `scale(${(1 + (sx - 1) * 0.7).toFixed(4)}, ${(1 + (sy - 1) * 0.7).toFixed(4)})`;
    el.halo.style.opacity = String(listening ? 0.35 + l * 0.65 : v.phase === 'thinking' ? 0.5 : 0.22);
    el.halo.style.transform = `scale(${1 + l * 0.3})`;
    el.ripples.style.opacity = listening ? String(0.35 + l * 0.65) : '0';
    for (let i = 0; i < BARS; i++) {
      const d = Math.abs(i - (BARS - 1) / 2);
      let h;
      if (v.phase === 'thinking') h = 0.16 + 0.22 * (Math.sin(now / 170 - i * 0.55) + 1) / 2;
      else if (listening) {
        const past = v.hist[(v.histAt - Math.round(d * 1.6) + v.hist.length) % v.hist.length];
        const env = 1 - (d / ((BARS - 1) / 2)) * 0.55;
        const jitter = 0.85 + 0.15 * Math.sin(now / 90 + i * 1.7);
        h = 0.14 + 0.86 * Math.min(1, past * 1.35) * env * jitter;
      } else h = 0.14;
      el.bars[i].style.transform = `scaleY(${h.toFixed(3)})`;
    }
  };
  v.raf = onFrame(tick);
}

function stopLoop() { v.raf?.(); v.raf = 0; v.lastTick = 0; el.glowFull?.off(); el.glowMini?.off(); }

// ---------- recording ----------

function preflight() {
  if (!getKey('groq')) return showError('voice.noKey', 'voice.noKeySub', { settings: true, type: true }), false;
  if (navigator.onLine === false) return showError('voice.offline', 'voice.offlineSub', { type: true }), false;
  return true;
}

async function startRec() {
  if (mic.isRecording() || v.phase === 'opening') return;
  if (!preflight()) return;
  tts.stop();
  if (card.cmd) dismissCard(); // lands a pending command
  el.say.innerHTML = '';
  const token = ++v.token;
  setPhase('opening');
  const opening = performance.now();
  // the mic hasn't opened in 4 s (a permission prompt that never came, a device held elsewhere): say
  // so, with a way to try again, and note why
  const watchdog = setTimeout(async () => {
    if (token !== v.token || v.phase !== 'opening') return;
    let why = 'getUserMedia still pending';
    try { const q = await navigator.permissions?.query({ name: 'microphone' }); if (q) why += `, permission ${q.state}`; } catch {}
    console.warn('[voice] mic did not start within 4 s:', why);
    perfNote('mic stuck: ' + why);
    if (token !== v.token || v.phase !== 'opening') return;
    v.token++; v.toggle = false; v.pendingStop = false;
    mic.cancel();
    setPhase('stuck');
  }, 4000);
  try {
    await mic.start({ onMaxed: () => finishRec() });
    clearTimeout(watchdog);
  } catch (e) {
    clearTimeout(watchdog);
    if (token !== v.token) return;
    v.toggle = false;
    if (e.code === 'denied') return showError('voice.micDenied', 'voice.micDeniedSub', { type: true });
    if (e.code === 'nomic') return showError('voice.noMic', 'voice.micDeniedSub', { type: true });
    return showError('voice.sttFailed', 'voice.sttFailedSub', { type: true });
  }
  if (token !== v.token || !v.open) { mic.cancel(); return; }
  haptic('tap');
  if (v.pendingStop && performance.now() - opening > 700) {
    // released while Chrome asked for the mic: nothing useful was recorded
    v.pendingStop = false;
    mic.cancel();
    setPhase('idle');
    showCard({ kind: 'info', icon: 'info', title: state.t('voice.micReady'), sub: state.t('voice.micReadySub'), lang: state.lang });
    return;
  }
  endpoint.reset();
  v.spec = null; v.waiting = false; setPausing('');
  setPhase('listening');
  if (v.pendingStop) { v.pendingStop = false; finishRec(); }
}

function sttOpts() {
  const ex = state.active?.exercises[state.active.current];
  const recent = [...new Set([...(state.active?.exercises || []).map(e => e.exerciseId), ...Object.keys(state.usage).sort((a, b) => state.usage[b] - state.usage[a])])];
  return {
    key: getKey('groq'), model: sttModelId(state.settings), language: state.settings.voiceLang,
    prompt: buildPrompt({ current: ex?.exerciseId, recent, catalog: state.catalog })
  };
}
// "Keep talking" after a sentence got cut off: the new words continue the old ones
const withCarry = text => { const c = v.carry; v.carry = ''; return [c, text].filter(Boolean).join(' ').trim(); };

// A pause: listen to what we have so far. Finished → send it now (no second upload).
// Sounds unfinished ("…for", "and", "um") → keep listening, and say so.
async function speculate() {
  const blob = mic.snapshot();
  if (!blob || blob.size < 800) return;
  const spec = v.spec = { token: v.token };
  setPausing('check');
  let text;
  try { text = await transcribe(blob, sttOpts()); }
  catch { if (v.spec === spec) { v.spec = null; v.waiting = true; setPausing(''); } return; }
  if (v.spec !== spec || spec.token !== v.token || !mic.isRecording() || v.phase !== 'listening') return;
  v.spec = null;
  if (looksUnfinished(text)) { v.waiting = true; setPausing('wait'); return; }
  v.toggle = false;
  mic.cancel();
  setPausing('');
  setPhase('thinking');
  deliver(withCarry(text));
}
function setPausing(k) {
  el.mini.dataset.pause = k;
  el.layer.dataset.pause = k;
  if (v.phase === 'listening') el.ostatus.textContent = state.t(k === 'wait' ? 'voice.takeTime' : v.toggle ? 'voice.tapSendMini' : 'voice.listening');
}

async function finishRec() {
  if (v.phase === 'opening') { v.pendingStop = true; return; }
  if (!mic.isRecording()) return;
  // let go: the orb answers the finger at once, a small settle, while your words are made out
  nav.warmCoach?.(true); // (in case it's for the Coach: painted, invisibly, while the words are made out)
  if (v.mode === 'mini' && !reduced()) el.oorb.animate([{ scale: '1' }, { scale: '0.94', offset: 0.3 }, { scale: '1' }], { duration: 360, easing: 'cubic-bezier(.3,1.2,.5,1)' });
  const token = v.token;
  v.toggle = false;
  v.spec = null; v.waiting = false; setPausing('');
  setPhase('thinking');
  const r = await mic.stop();
  if (!r || token !== v.token) return;
  // never sent empty: a hold with nothing in it is "too short" (or, in review, just back to what you had)
  if (r.ms < 400 || (r.measured && r.peak < 0.03) || r.blob.size < 800) return v.review && v.open ? showReview(withCarry('')) : showError('voice.tooShort', 'voice.tooShortSub');
  let text;
  try {
    text = await transcribe(r.blob, sttOpts());
  } catch (e) {
    if (token !== v.token) return;
    const map = { offline: ['voice.offline', 'voice.offlineSub'], badkey: ['voice.badKey', 'voice.badKeySub'], busy: ['voice.busy', 'voice.busySub'], nokey: ['voice.noKey', 'voice.noKeySub'] };
    const [a, b] = map[e.code] || ['voice.sttFailed', 'voice.sttFailedSub'];
    // the code helps tell a blocked request from a bad key or a server error
    return showError(a, b, { retry: true, type: true, settings: e.code === 'badkey' || e.code === 'nokey', code: e.status || e.code });
  }
  if (token !== v.token) return;
  text = withCarry(text);
  if (!text && !(v.review && v.open)) return showError('voice.tooShort', 'voice.tooShortSub', { retry: true });
  deliver(text);
}

function cancelRec() {
  v.token++;
  v.toggle = false;
  v.pendingStop = false;
  mic.cancel();
  if (v.open) setPhase('idle');
}

// ---------- review: what you said, to check before it goes ----------

// After a pull-up, what you said is shown big in the middle, editable with a tap, with Send, "Say more"
// (it adds to it) and ✕ (the top close) to throw it away. Nothing is sent until Send.
function deliver(text) {
  if (v.review && v.open && v.mode === 'full') return showReview(text);
  handleText(text);
}
function showReview(text) {
  v.reviewing = true;
  el.say.innerHTML = '';
  el.rtext.textContent = text || '';
  el.rhint.textContent = state.t(text ? 'voice.reviewHint' : 'voice.reviewEmpty');
  el.rmore.querySelector('span').textContent = state.t('voice.reviewMore');
  el.rsend.querySelector('span').textContent = state.t('voice.reviewSend');
  el.review.hidden = false;
  el.layer.classList.add('reviewing');
  setPhase('review');
  syncSend();
  preparse(reviewText());
  nav.warmCoach?.(true);
  haptic('tap');
}
const reviewText = () => el.rtext.textContent.replace(/\s+/g, ' ').trim();
let preT = 0;
function syncSend() { el.rsend.disabled = !reviewText(); clearTimeout(preT); preT = setTimeout(() => preparse(reviewText()), 250); }
function endReview() {
  v.review = false; v.reviewing = false;
  if (!el.review) return;
  el.review.hidden = true;
  el.layer.classList.remove('reviewing');
  el.rtext.blur?.();
}
function reviewSend() {
  const text = reviewText();
  if (!text) return;
  haptic('success');
  // (the review stays up: sent to the Coach, its words fly into their bubble; anything else closes it.
  // Nothing is written to the page before that's known, so the handoff can measure it for free.)
  v.review = false;
  const was = v.phase;
  handleText(text);
  if (v.open && v.phase === was) setPhase('thinking');
}
function reviewMore() {
  const text = reviewText();
  el.review.hidden = true;
  el.layer.classList.remove('reviewing');
  v.reviewing = false;
  v.carry = text; // what you say next is added to it
  el.say.textContent = text;
  v.toggle = true; // tap the button (or pause) when you're done
  startRec();
}

// ---------- text → intent → card ----------

function showWords(text) {
  const words = text.split(/\s+/).filter(Boolean);
  (v.mode === 'mini' ? el.osay : el.say).innerHTML = words.map((w, i) => `<span class="w" style="animation-delay:${Math.min(i, 14) * 38}ms">${esc(w)}</span>`).join(' ');
  if (v.mode === 'mini') fitSay();
}
// The floating orb's words keep to three lines: a longer sentence shows its end, fading out at the top.
function fitSay() {
  const o = el.osay;
  o.scrollTop = o.scrollHeight;
  o.classList.toggle('over', o.scrollHeight > o.clientHeight + 1);
}

// What the parser makes of the words on the review screen is worked out while you look at them (it can
// take a good part of a frame budget on the phone), so Send answers on the frame you tap it.
let pre = null;
const ctxSig = c => JSON.stringify([c.lang, c.unit, c.workoutExerciseIds, c.current, c.restRunning, c.screen]);
function parseFor(text) {
  const ctx = parseCtx();
  if (pre && pre.text === text && pre.sig === ctxSig(ctx) && Date.now() - pre.at < 60000) return pre.intent;
  return parse(text, ctx);
}
function preparse(text) {
  if (!text) return;
  (window.requestIdleCallback || setTimeout)(() => {
    const ctx = parseCtx();
    try { pre = { text, sig: ctxSig(ctx), intent: parse(text, ctx), at: Date.now() }; } catch { pre = null; }
  }, { timeout: 600 });
}

export function handleText(text, { typed = false } = {}) {
  text = String(text || '').trim();
  if (!text) return;
  if (!typed) noteHeard(text); // kept for a bug report
  if (card.cmd && !card.committed && card.cmd.kind === 'auto') commitNow(); // a new command lands the previous one
  if (v.open && !v.reviewing) showWords(text); // (on the review screen your words are already there)
  const intent = parseFor(text);
  if (intent.type === 'Unknown') {
    // one stray word the mic caught ("with", "doing", gym noise) is not sent anywhere
    if (!typed && isNoise(text)) return showError('voice.tooShort', 'voice.tooShortSub', { retry: true });
    if (isQuestion(text) || isPlanRequest(text)) return toCoach(text);
    if (getKey('google')) return aiFallback(text, intent, { typed });
  }
  present(intent, { typed });
}

// The Coach box: a clear command (food, a set, water, targets…) is done, not discussed.
const DO_TYPES = new Set(['LogSet', 'LogSets', 'LogBatch', 'LogRel', 'AdjustNext', 'LogMeal', 'RepeatMeal', 'Report', 'LogWater', 'SetTarget', 'LogBodyweight', 'LogProtein', 'LogCardio', 'StartCardio', 'StartRoutine', 'CheckIn', 'AddWarmup', 'WarmupDone', 'SetGoal']);
export function actOnText(text) {
  text = String(text || '').trim();
  if (!text || /\?\s*$/.test(text) || isQuestion(text)) return null;
  const intent = parse(text, { ...parseCtx(), screen: 'coach' });
  if (!DO_TYPES.has(intent.type)) return null;
  present(intent, { typed: true });
  return intent.type;
}

// Hands-free: speech the app overheard. It acts only on what reads as a workout command, or on
// anything said after "Coach"/"Setline"; everything else (chat, music, the gym) is ignored.
const HF_OK = new Set(['LogSet', 'LogSets', 'AddWarmup', 'WarmupDone', 'LogRel', 'AdjustNext', 'RepeatLast', 'AdjustLast', 'EditLast', 'DeleteLast', 'Undo', 'NextExercise', 'PrevExercise',
  'StartRest', 'AdjustRest', 'SkipRest', 'Query', 'AddExercise', 'SwapExercise', 'LogProtein', 'LogBodyweight']);
export const WAKE = /^\s*(?:hey |hej |ok |okay )?(?:coach|setline|set line|sætlajn)\b[\s,.:!-]*/i;
export function handleAmbient(text) {
  const raw = String(text || '').trim();
  if (!raw || v.open) return false;
  const m = WAKE.exec(raw);
  if (m) {
    const rest = raw.slice(m[0].length).trim();
    if (!rest) return false;
    handleText(rest);
    return true;
  }
  const intent = parse(raw, parseCtx());
  if (!HF_OK.has(intent.type)) return false;
  if (card.cmd && !card.committed && card.cmd.kind === 'auto') commitNow();
  present(intent);
  return true;
}

// Spoken cue with the reply voice (hands-free rest cues).
export const speakCue = (text, lang = state.lang) => speak(text, lang);

// Questions land in the Coach thread; the answer is streamed there and spoken when complete.
async function toCoach(text) {
  dismissCard();
  if (v.open) return handToCoach(text);
  if (v.open) { setPhase('result'); await new Promise(r => setTimeout(r, 380)); await closeVoice(); }
  nav.go('coach');
  askCoach(text);
}

// A question for the Coach, from the floating orb (let go) or from the voice screen (Send). Everything
// flows to the bottom right, where your messages live, from the same frame:
// - what you said becomes your message (its own bubble, flown from where the words were, shrinking
//   into place; see coach.js wordsFly),
// - the orb goes on one gentle curve to its place at the right end of the message box, passing under
//   the words, and the box takes it with a small press in depth,
// - the frost (or the voice screen) fades over 180 ms while the Coach fades in, already at its latest
//   message, with nothing from the thread's past on top of the voice screen or the page.
// Reduced motion: 150 ms fades, nothing moves.
async function handToCoach(text) {
  const app = document.getElementById('app');
  const mini = v.mode === 'mini', calm = reduced();
  const src0 = mini ? el.oorb : el.orb, box0 = document.getElementById('composer'), corb0 = box0.querySelector('.corb .orb');
  // (measured before anything is written, so it costs nothing: where the orb is, and where the box's orb
  // will be, less the little drop the hidden box sits at)
  // (and whether your words will fly down to their message, or up: below the Coach's last message, which
  // is laid out already, invisibly)
  const lastMsg = document.querySelector('#s-coach #thread > .msg:last-child'), wordsAt = (mini ? el.osay : el.rtext).getBoundingClientRect();
  const lands = lastMsg ? Math.min(lastMsg.getBoundingClientRect().bottom + 40, box0.getBoundingClientRect().top - 30) : 0;
  const wordsGoDown = lands > wordsAt.top + wordsAt.height / 2;
  const a0 = { ...centreOf(src0), w: src0.getBoundingClientRect().width }, b0 = centreOf(corb0), drop0 = new DOMMatrix(getComputedStyle(box0).transform).m42 || 0, w0 = corb0.getBoundingClientRect().width;
  const tA = performance.now(); // (the tap: every delay below counts from it, however long the Coach takes to draw)
  setPhase('result');
  v.open = false; v.token++; v.press = null; v.toggle = false;
  mic.cancel();
  coverPage(false);
  // (the voice screen's history entry is popped meanwhile: nothing waits for it)
  const popped = history.state?.voice ? new Promise(res => { v.popWaiting++; v.popResolve = res; history.back(); }) : Promise.resolve();
  const words = mini ? el.osay : !el.review.hidden ? el.rtext : el.say;
  const src = mini ? el.oorb : el.orb;
  const box = document.getElementById('composer'), corb = box.querySelector('.corb .orb');
  const under = document.querySelector('.screen.on');
  const anims = [];
  const go = (x, f, o) => { if (x) anims.push(x.animate(f, { fill: 'both', ...o })); };
  const fade = [{ opacity: 1 }, { opacity: 0 }];
  // On this frame, before anything heavy: what runs on its own (the orb's flight, the fades) starts
  // now, so it keeps moving smoothly while the Coach is laid out just after.
  const a = a0, to = { x: b0.x, y: b0.y - drop0, w: w0 };
  const t = calm ? 150 : 120, bg = calm ? 150 : 180;
  app.classList.add('choreo', 'awaitland');
  // (the voice screen covers the page under it already: that simply goes; under the frost it fades, below)
  if (under && under.id !== 's-coach') {
    if (mini) { under.style.visibility = 'visible'; go(under, fade, { duration: calm ? 150 : 90, easing: 'ease-out' }); } // (under the frost, which stays)
    else under.style.visibility = 'hidden';
  }
  if (mini) {
    for (const x of [el.opull, el.ostatus, ...el.mini.querySelectorAll('.vglow')]) go(x, fade, { duration: t, easing: 'ease-out' });
    el.mini.style.pointerEvents = 'none';
  } else {
    const step = calm ? fade : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }];
    for (const x of [el.review.querySelector('.vracts'), el.rhint, el.hints, el.hold, el.note]) go(x, step, { duration: t, easing: 'ease-out' });
    for (const x of [el.layer.querySelector('.top'), ...el.layer.querySelectorAll('.vglow')]) go(x, fade, { duration: t, easing: 'ease-out' });
    el.layer.inert = true;
  }
  // the orb: from the floating orb, down and along the bottom; from the top of the voice screen, round
  // the left of your words and along the bottom (never over them)
  // (from the top: out to the left first, clear of your words as they set off to the right, then down
  // and along into its place; most of the way is flown before the Coach has faded in)
  const ctrl = mini ? { x: a.x, y: to.y + 6 } : { x: -150, y: a.y + (to.y - a.y) * 0.88 };
  // (from the top it lets your words set off first and goes round behind them: they cross its way down,
  // or, flying up to a message higher up, they have to be clear of its way first)
  const flight = arcFly(src, corb, { from: a, to, ctrl, delay: mini || calm ? 0 : wordsGoDown ? 150 : 240, keepFrom: true, onland: () => { app.classList.remove('orbaway'); nav.impact?.(centreOf(corb)); } });
  // Just after that frame: the Coach, with your words flying into their message
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  wordsFrom(words, text);
  const { entry } = nav.coachHandin();
  popped.then(entry);
  app.classList.remove(mini ? 'voice-mini' : 'voice'); // (the message box is there, under the frost or the screen)
  const coach = document.getElementById('s-coach');
  const since = ms => calm ? 0 : Math.max(0, ms - (performance.now() - tA));
  // the Coach comes in over the frost, rising a little from 60 ms: everything but your new message (that's your words)
  // (the conversation itself holds back at a third while your words fly across it, so they stay the one
  // thing you read, and comes up the rest of the way as they land)
  const head = [...coach.children].filter(c => c.id !== 'thread'), thread = [...coach.querySelectorAll('#thread > .msg')];
  for (const c of calm ? [...head, ...thread] : head) go(c, calm ? [{ opacity: 0.005 }, { opacity: 1 }] : [{ opacity: 0.005, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
    { duration: calm ? 150 : 200, delay: since(60), easing: 'cubic-bezier(.2,.8,.2,1)' });
  if (!calm) for (const c of thread) go(c, [{ opacity: 0.005, transform: 'translateY(10px)' }, { opacity: 0.34, transform: 'none', offset: 0.36 }, { opacity: 0.34, offset: 0.7 }, { opacity: 1 }],
    { duration: 560, delay: since(60), easing: 'cubic-bezier(.2,.8,.2,1)' });
  go(document.querySelector('.aura .veil'), [{ opacity: 0 }, { opacity: 1 }], { duration: calm ? 150 : 200, delay: since(60), easing: 'ease-out' });
  // the frost (or the voice screen's backdrop) stays until now, with the Coach coming in: then it fades as it arrives
  if (mini) {
    go(el.mini.querySelector('.oscrim'), fade, { duration: bg, delay: since(60), easing: 'ease-out' });
  } else go(el.layer.querySelector('.vbg'), fade, { duration: bg, delay: since(40), easing: 'ease-out' });
  app.classList.add('handin');
  coach.scrollTop = coach.scrollHeight;
  askCoach(text); // (your message, flown from your words, and the reply on its way)
  await Promise.all([flight, new Promise(r => setTimeout(r, calm ? 170 : 620))]); // (and the words have landed, the conversation come up)
  anims.forEach(x => x.cancel());
  if (under) under.style.visibility = '';
  for (const m of coach.querySelectorAll('.msg')) m.classList.add('seen'); // (nothing plays its entrance again)
  if (mini) {
    el.mini.classList.remove('on');
    el.mini.hidden = true;
    el.mini.style.pointerEvents = '';
    el.owrap.style.transform = ''; el.owrap.style.translate = '';
  } else {
    el.layer.classList.remove('on', 'carded');
    el.layer.hidden = true;
    endReview();
    el.orbwrap.style.transform = '';
  }
  for (const x of [el.osay, el.rtext, el.say]) x.style.visibility = '';
  releaseOrb(src);
  app.classList.remove('handin', 'choreo', 'orbaway');
  stopLoop();
  setTimeout(() => { if (app.classList.contains('awaitland')) { app.classList.remove('awaitland'); syncSpot(); } }, 1600); // (a safety net: normally the landing does it)
}
const centreOf = x => { const a = document.getElementById('app').getBoundingClientRect(), r = x.getBoundingClientRect(); return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 }; };

// What the parser couldn't read goes to Flash-Lite. Never blocks local commands:
// if anything changed while it was thinking, the answer comes back as a suggestion.
let aiSeq = 0;
const stateSig = () => {
  const w = state.active;
  return w ? `${w.id}|${w.current}|${w.exercises.map(e => e.sets.filter(x => x.done).length).join(',')}|${w.rest?.startedAt || 0}` : 'none';
};
async function aiFallback(text, parsed, { typed }) {
  const mine = ++aiSeq;
  const sig = stateSig();
  const lang = langFor(parsed);
  const t = tFor(lang);
  if (v.open) setPhase('thinking');
  // "Working it out" only if it takes a while (over 0.6 s), and then for at least 0.8 s, so a quick
  // answer never flashes it
  let waitAt = 0;
  const waitT = setTimeout(() => {
    if (mine !== aiSeq) return;
    waitAt = performance.now();
    if (v.open && v.mode === 'mini') el.ostatus.textContent = t('voice.thinkingAi');
    else showCard({ kind: 'wait', icon: 'info', title: t('voice.thinkingAi'), sub: t('voice.heard', { text }), lang, intent: parsed });
  }, 600);
  let intent;
  try {
    await ensureModels();
    const ctx = { ...parseCtx(), hasWorkout: !!state.active };
    // 4 s in total across the chosen model and its runner-up
    const until = performance.now() + 4000;
    intent = await withFallback(cmdModels(state.settings), model => aiCommand(text, ctx, { key: getKey('google'), model, timeout: Math.max(800, until - performance.now()) }));
  } catch {
    intent = null;
  }
  clearTimeout(waitT);
  if (waitAt) await new Promise(r => setTimeout(r, Math.max(0, 800 - (performance.now() - waitAt))));
  if (mine !== aiSeq) return; // a newer AI request superseded this one
  if (intent?.type === 'question') return toCoach(text);
  const full = intent ? { ...intent, heard: text, lang: parsed.lang } : parsed;
  if (card.cmd?.kind === 'auto' && !card.committed) await commitNow();
  if (!intent || stateSig() === sig) return present(full, { typed });
  // state moved on: ask before acting
  const cmd = resolve(full, snapshot(), t, lang);
  cmd.lang = lang;
  if (cmd.kind === 'auto') { cmd.kind = 'confirm'; cmd.icon = 'ask'; cmd.sub = t('voice.suggestion'); }
  speak(cmd.say, lang);
  showCard(cmd);
  if (v.open) setPhase('result');
}

// "yes" / "do it": confirms the card waiting for it, else runs the Coach's top suggestion (see coach.js)
let confirmHook = () => false;
export const onConfirmWord = fn => { confirmHook = fn; };

// A spoken name that isn't in the library becomes your own exercise: the kit from its words
// ("machine", "cable", …), the muscle from the nearest known lift ("… curl" → biceps).
async function newExerciseFrom(rawName) {
  const nameTxt = String(rawName || '').trim().replace(/^./, c => c.toUpperCase());
  const have = state.catalog.findExact(nameTxt);
  if (have) return have.id;
  const low = nameTxt.toLowerCase();
  const equipment = /machine|maskine/.test(low) ? 'machine' : /cable|kabel|rope/.test(low) ? 'cable' : /smith/.test(low) ? 'smith' : /dumbbell|håndvægt/.test(low) ? 'dumbbell' : /ez/.test(low) ? 'ezbar' : /kettlebell/.test(low) ? 'kettlebell' : /barbell|stang/.test(low) ? 'barbell' : 'machine';
  let muscle = 'chest';
  for (const w of low.split(/\s+/).reverse()) { const hit = state.catalog.rank(w)[0]; if (hit?.s >= 50) { muscle = hit.e.muscles[0]; break; } }
  const r = makeCustom({ name: nameTxt, muscle, equipment });
  if (!r.ok) return null;
  await store.addCustomExercise(r.exercise);
  toast({ title: esc(state.t('voice.added', { name: r.exercise.en })) });
  return r.exercise.id;
}

function present(intent, { typed = false } = {}) {
  if (intent.type === 'Confirm') {
    if (card.cmd?.kind === 'confirm' && !card.committed) { const c = card.cmd; if (v.open) closeVoice(); commitConfirmed(c); return; }
    if (confirmHook()) { if (v.open) closeVoice(); return; }
  }
  const lang = langFor(intent);
  const cmd = resolve(intent, snapshot(), tFor(lang), lang);
  cmd.lang = lang;
  cmd.typed = typed;
  if (cmd.run?.op === 'meal-ai') return estimateMeal(cmd, intent, lang);
  if (cmd.kind === 'cancel') {
    dismissCard({ keepPending: false });
    speak(tFor(lang)('say.cancel'), lang);
    if (v.open) setTimeout(() => closeVoice(), 350);
    return;
  }
  speak(cmd.say, lang);
  if (v.open && v.mode === 'mini') {
    setPhase(cmd.kind === 'error' ? 'error' : 'result');
    setTimeout(() => { if (v.open && v.mode === 'mini') closeVoice(); }, 420);
    setTimeout(() => showCard(cmd), 180);
    return;
  }
  showCard(cmd);
  if (v.open) {
    setPhase(cmd.kind === 'error' ? 'error' : 'result');
    if (cmd.kind !== 'error') setTimeout(() => { if (v.open && card.cmd === cmd) closeVoice(); }, cmd.kind === 'info' ? 1100 : 720);
  }
}

function showError(titleKey, subKey, opts = {}) {
  const t = state.t;
  v.toggle = false;
  mic.cancel();
  if (v.open) setPhase('error');
  else orbShake(dockOrb());
  haptic('error');
  const sub = (subKey ? t(subKey) : '') + (opts.code ? ` (${opts.code})` : '');
  if (v.open && v.mode === 'mini') setTimeout(() => { if (v.open && v.mode === 'mini') closeVoice(); }, 250);
  showCard({ kind: 'error', icon: 'alert', title: t(titleKey), sub, retry: !!opts.retry, settings: !!opts.settings, type: !!opts.type, local: true });
}

// A meal the food list doesn't know: the AI estimates it right in the card, then it logs like a set.
let mealSeq = 0;
async function estimateMeal(cmd, intent, lang) {
  const t = tFor(lang), mine = ++mealSeq;
  const key = getKey('google');
  if (!key) { if (v.open) await closeVoice(); openMealSheet({ text: cmd.run.text }); return; }
  if (v.open) { setPhase('result'); setTimeout(() => { if (v.open) closeVoice(); }, 300); }
  showCard({ kind: 'wait', icon: 'info', title: t('meal.estimating'), value: cmd.run.text, sub: t('meal.estimatingSub'), lang, intent });
  let meal = null;
  try {
    await ensureModels();
    const raw = await withFallback(coachModels(state.settings), model => aiMeal({ key, model, prompt: mealPrompt(cmd.run.text, lang), schema: MEAL_SCHEMA, timeout: 20000 }), { rounds: 2 });
    // not food after all ("what's going on?"): it was meant for the Coach
    if (raw && raw.food === false) { if (mine === mealSeq) { dismissCard(); toCoach(intent.heard || cmd.run.text); } return; }
    meal = validateMeal(raw);
  } catch { meal = null; }
  if (mine !== mealSeq) return;
  if (!meal) { showCard({ kind: 'error', icon: 'alert', title: t('meal.notUnderstood'), sub: cmd.run.text, lang, intent, type: true }); return; }
  present({ type: 'MealReady', meal, slot: cmd.run.slot, heard: intent.heard, lang });
}

// ---------- the intent card ----------

const ICON = { check: I.check, ask: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.8v.4M12 17v.1"/></svg>', alert: I.alert, info: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 11v5.5M12 7.6v.1"/></svg>' };

function showCard(cmd) {
  clearTimeout(card.timer);
  clearTimeout(card.hideTimer);
  hideToast();
  card.cmd = cmd;
  card.committed = false;
  card.undoOp = null;
  const t = tFor(cmd.lang);
  const c = el.card;
  const btn = (k, label, cls = '') => `<button class="undo ${cls}" data-c="${k}">${esc(label)}</button>`;
  let actions = '';
  if (cmd.kind === 'auto') actions = btn('undo', t('common.undo'));
  else if (cmd.kind === 'confirm') actions = `<span class="pair">${btn('cancel', t('common.cancel'))}${btn('confirm', t('voice.confirm'), 'primary')}</span>`;
  else if (cmd.kind === 'error') {
    const list = [];
    if (cmd.intent?.heard && getKey('groq')) list.push(btn('more', t('voice.more')));
    else if (cmd.retry && getKey('groq')) list.push(btn('retry', t('voice.retry')));
    if (cmd.settings) list.push(btn('settings', t('voice.openSettings')));
    if (cmd.type || (cmd.retry && !cmd.local)) list.push(btn('edit', cmd.local ? t('voice.type') : t('voice.edit')));
    actions = list.length ? `<span class="pair">${list.slice(0, 2).join('')}</span>` : btn('close', '×', 'x');
  } else if (cmd.kind === 'wait') actions = '<span class="spin2" aria-hidden="true"></span>';
  else actions = btn('close', '×', 'x');
  const chips = cmd.kind === 'ask' && cmd.choices?.length
    ? `<div class="cchips">${cmd.choices.map((ch, i) => `<button class="chip" data-c="choice" data-i="${i}">${esc(ch.label)}</button>`).join('')}</div>` : '';
  const value = cmd.value ? ` <span class="v">${esc(cmd.value)}</span>` : '';
  // got it wrong? one tap: it's undone and reported, with what was heard and what it did
  const flag = cmd.intent?.heard && ['auto', 'error', 'ask', 'confirm', 'info'].includes(cmd.kind) ? `<button class="cflag" data-c="report" aria-label="${esc(t('qr.wrong'))}">${FLAG}</button>` : '';
  const html = `<div class="ic ${cmd.icon || 'check'}">${ICON[cmd.icon] || I.check}</div>
    <div class="ctext"><b>${esc(cmd.title)}${value}</b>${cmd.sub ? `<small>${esc(cmd.sub)}</small>` : ''}</div>
    ${flag}${actions}${chips}<span class="bar"></span>`;
  const shown = c.classList.contains('show');
  el.layer.classList.toggle('carded', v.open);
  c.dataset.kind = cmd.kind;
  c.classList.toggle('flagged', !!flag);
  c.classList.remove('done', 'counting');
  if (shown && !reduced()) {
    c.classList.add('swap');
    setTimeout(() => { if (card.cmd === cmd) { c.innerHTML = html; c.classList.remove('swap'); arm(cmd); } }, 140);
  } else {
    c.innerHTML = html;
    void c.offsetWidth;
    c.classList.add('show');
    arm(cmd);
  }
}

function arm(cmd) {
  const c = el.card;
  if (cmd.kind === 'auto') {
    c.style.setProperty('--ms', AUTO_MS + 'ms');
    void c.offsetWidth;
    c.classList.add('counting');
    card.timer = setTimeout(() => commitNow(), AUTO_MS);
  } else if (cmd.kind === 'info') {
    card.hideTimer = setTimeout(() => dismissCard(), 5200);
  } else if (cmd.kind === 'error' && !v.open) {
    card.hideTimer = setTimeout(() => dismissCard(), 6000);
  }
}

function dismissCard({ keepPending = true } = {}) {
  clearTimeout(card.timer);
  clearTimeout(card.hideTimer);
  if (keepPending && card.cmd?.kind === 'auto' && !card.committed) commitNow();
  card.cmd = null;
  el.card.classList.remove('show', 'counting');
  el.layer?.classList.remove('carded');
}

// Commit the current auto/confirm card. Re-resolves against the latest state first.
async function commitNow() {
  const cmd = card.cmd;
  if (!cmd || card.committed) return;
  clearTimeout(card.timer);
  card.committed = true;
  const fresh = resolve(cmd.intent, snapshot(), tFor(cmd.lang), cmd.lang);
  if (fresh.kind !== 'auto') { fresh.lang = cmd.lang; showCard(fresh); return; } // state moved on: show what it means now
  const run = fresh.run;
  el.card.classList.remove('counting');
  el.card.classList.add('done');
  if (v.closing) await v.closing;
  const ok = await execute(run, cmd);
  if (!ok) return;
  if (card.cmd === cmd) card.hideTimer = setTimeout(() => { if (card.cmd === cmd) dismissCard(); }, 2600);
}

// The set a command just logged, if it logged one.
function loggedSet(before, after) {
  if (!after) return null;
  const had = new Set();
  for (const e of before?.exercises || []) for (const s of e.sets) if (s.done) had.add(s.id);
  for (const e of after.exercises) for (const s of e.sets) if (s.done && !had.has(s.id)) return s.id;
  return null;
}

// A set logged by voice: a spark leaves the dock orb and lands on its row (gold for a record, and the
// orb flares gold). Anything else, or a row you can't see: the orb's ring.
function sparkTo(id) {
  const pr = !!id && livePRSets(state.prs, state.active).has(id);
  orbPulse(pr ? 'pulse-warm' : 'pulse');
  if (!id || v.open) return;
  // (the page may still be drawing the row, or changing to the workout)
  const find = (tries = 0) => {
    const row = document.querySelector(`#s-workout.on #sets [data-id="${id}"]`);
    if (row) orbSpark(dockOrb(), row.querySelector('.ck') || row, { warm: pr });
    else if (tries < 4) setTimeout(() => find(tries + 1), 120);
  };
  requestAnimationFrame(() => find());
}

async function execute(run, cmd) {
  if (!run) return true;
  haptic('success');
  if (run.op === 'update') {
    const before = state.active;
    let next;
    try { next = store.update(w => run.fn(w, Date.now()), { undo: 'voice', reason: 'voice' }); }
    catch { showError('toast.limit', null); return false; }
    if (next) card.undoOp = { op: 'undo', before };
    if (run.nav) nav.go(run.nav);
    if (run.done) speak(run.done, cmd.lang);
    sparkTo(loggedSet(before, state.active));
    return true;
  }
  orbPulse();
  if (run.op === 'start') {
    store.startWorkout(run.template);
    card.undoOp = { op: 'discardStart', id: state.active?.id };
    nav.go('workout');
    if (run.then) setTimeout(() => present({ ...run.then }), 350);
    return true;
  }
  if (run.op === 'undo') { store.undo(); return true; }
  if (run.op === 'cardio-log') { const s = await store.addCardio(run.session); card.undoOp = { op: 'cardio-del', id: s.id }; return true; }
  if (run.op === 'cardio-start') { startCardioSession(run.type); card.undoOp = { op: 'cardio-discard' }; return true; }
  if (run.op === 'cardio-finish') { dismissCard(); if (v.open) await closeVoice(); nav.go('workout'); cardioFinishSheet(); return false; }
  if (run.op === 'cardio-discard') { await store.discardCardio(); nav.go('today'); card.hideTimer = setTimeout(() => dismissCard(), 1500); return false; }
  if (run.op === 'bodyweight') {
    const date = dateKey();
    const prev = state.bodyweight.find(e => e.date === date)?.kg ?? null;
    await store.logBodyweight(run.kg, date);
    card.undoOp = { op: 'bw', date, prev };
    return true;
  }
  if (run.op === 'protein') { await store.logProtein(run.grams); card.undoOp = { op: 'protein', grams: run.grams }; return true; }
  if (run.op === 'goal') { addGoal(run.goal); return true; }
  if (run.op === 'checkin') { const r = await store.saveCheckin(run.patch); card.undoOp = { op: 'checkin', prev: r.prev }; return true; }
  if (run.op === 'meal') { dismissCard(); if (v.open) await closeVoice(); openMealSheet({ text: run.text }); return false; }
  if (run.op === 'report') { dismissCard(); if (v.open) await closeVoice(); quickReport(run.kind, run.text); return false; }
  if (run.op === 'meal-log') { const ms = await store.logMeals(run.meals); card.undoOp = { op: 'meals-del', ids: ms.map(m => m.id) }; return true; }
  if (run.op === 'water') { await store.logWater(run.ml); card.undoOp = { op: 'water', ml: run.ml }; return true; }
  if (run.op === 'targets') { store.setSettings({ foodTargets: run.targets }); card.undoOp = { op: 'targets', prev: state.settings.foodTargets ?? null, was: run.prev }; return true; }
  if (run.op === 'discard') {
    await store.discard();
    card.hideTimer = setTimeout(() => dismissCard(), 1500);
    nav.go('today');
    return false;
  }
  if (run.op === 'finish') {
    const done = await store.finish();
    dismissCard();
    if (done) nav.showDetail(done.id, { fromFinish: true }); else nav.go('today');
    return false;
  }
  return true;
}

function undoCard() {
  const cmd = card.cmd;
  if (!cmd) return;
  haptic('tap');
  // undoing what the voice just did usually means it got you wrong: kept for a bug report
  if (cmd.intent?.heard) noteMixup({ heard: cmd.intent.heard, did: [cmd.title, cmd.value].filter(Boolean).join(' · '), type: cmd.intent.type });
  if (!card.committed) {
    clearTimeout(card.timer);
    card.committed = true;
    el.card.classList.remove('counting');
    dismissCard({ keepPending: false });
    return;
  }
  const u = card.undoOp;
  if (u?.op === 'cardio-del') store.deleteCardio(u.id);
  else if (u?.op === 'cardio-discard') { store.discardCardio(); nav.go('today'); }
  else if (u?.op === 'bw') { if (u.prev == null) store.deleteBodyweight(u.date); else store.logBodyweight(u.prev, u.date); }
  else if (u?.op === 'protein') store.undoProtein(u.grams);
  else if (u?.op === 'meal-del') store.deleteMeal(u.id);
  else if (u?.op === 'meals-del') store.deleteMeals(u.ids);
  else if (u?.op === 'water') store.logWater(-u.ml);
  else if (u?.op === 'targets') store.setSettings({ foodTargets: u.prev });
  else if (u?.op === 'checkin') store.restoreCheckin(u.prev);
  else if (u?.op === 'undo') store.undo();
  else if (u?.op === 'discardStart' && state.active?.id === u.id) { store.discard(); nav.go('today'); }
  dismissCard({ keepPending: false });
}

// ---------- wiring ----------

async function onCardClick(e) {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  const k = b.dataset.c;
  const cmd = card.cmd;
  if (k === 'undo') return undoCard();
  if (k === 'report') {
    const heard = cmd?.intent?.heard || '', did = [cmd?.title, cmd?.value].filter(Boolean).join(' · ');
    if (cmd?.kind === 'auto') undoCard(); else dismissCard({ keepPending: false });
    if (v.open) closeVoice();
    return openQuickReport({ source: 'voice', heard, did });
  }
  if (k === 'close') return dismissCard();
  if (k === 'cancel') { haptic('tap'); return dismissCard({ keepPending: false }); }
  if (k === 'confirm') { b.disabled = true; card.committed = false; return commitConfirmed(cmd); }
  if (k === 'choice') {
    const ch = cmd?.choices?.[Number(b.dataset.i)];
    if (!ch) return;
    haptic('tap');
    dismissCard({ keepPending: false });
    if (ch.intent.type === 'NewExercise') { // a new exercise in your library, then the set goes on it
      const id = await newExerciseFrom(ch.intent.name);
      if (id) return present({ ...ch.intent.then, exerciseId: id, heard: cmd.intent?.heard || '', lang: cmd.lang });
      return;
    }
    if (ch.intent.type === 'PickExercise') { // the full list, then the set goes on the one you pick
      const then = ch.intent.then;
      return openPicker({ onPick: id => present({ ...then, exerciseId: id, heard: cmd.intent?.heard || '', lang: cmd.lang }) });
    }
    return present({ ...ch.intent, heard: cmd.intent?.heard || '', lang: cmd.lang });
  }
  if (k === 'more') {
    v.carry = cmd?.intent?.heard || '';
    dismissCard({ keepPending: false });
    if (!v.open) openMini();
    el.osay.textContent = v.carry;
    fitSay();
    el.say.textContent = v.carry;
    v.toggle = true;
    return startRec();
  }
  if (k === 'retry') { dismissCard({ keepPending: false }); if (!v.open) openMini(); v.toggle = true; return startRec(); }
  if (k === 'edit') {
    const heard = cmd?.intent?.heard || '';
    dismissCard({ keepPending: false });
    openVoice();
    return startTyping(heard);
  }
  if (k === 'settings') { dismissCard({ keepPending: false }); closeVoice().then(() => nav.openSettings()); }
}

async function commitConfirmed(cmd) {
  if (!cmd) return;
  card.committed = true;
  if (v.closing) await v.closing;
  if (v.open) await closeVoice();
  el.card.classList.add('done');
  const ok = await execute(cmd.run, cmd);
  if (ok && card.cmd === cmd) card.hideTimer = setTimeout(() => dismissCard(), 2000);
}

function startTyping(prefill = '') {
  v.typing = true;
  cancelRec();
  el.layer.classList.add('typing');
  el.input.value = prefill;
  setTimeout(() => { el.input.focus(); el.input.setSelectionRange(prefill.length, prefill.length); }, 60);
}

function holdDown(e) {
  if (e.button > 0) return;
  e.preventDefault();
  unlockAudio();
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  if (v.toggle && (mic.isRecording() || v.phase === 'opening')) { v.press = null; finishRec(); return; }
  if (v.phase === 'thinking') return;
  v.press = { t: performance.now() };
  startRec();
}

function holdUp(tapMeansToggle) {
  return e => {
    const p = v.press;
    v.press = null;
    if (!p) return;
    const dt = performance.now() - p.t;
    if (dt >= HOLD_MS) return finishRec();
    if (tapMeansToggle) { v.toggle = true; if (v.phase === 'listening' || v.phase === 'opening') setPhase(v.phase); }
    else cancelRec();
    void e;
  };
}

// Pulling the lifted orb up: it tracks the finger with a little resistance, ticks at the
// threshold and hands over to the full screen; a quick flick up does the same.
const PULL_AT = 110;
function pullTo(p, e) {
  // dragged down, away from the page: let go of it all, nothing is sent
  if (e.clientY - p.y > 70 && v.mode === 'mini' && !p.cancelled) {
    p.cancelled = true;
    if (v.press === p) { clearTimeout(p.timer); v.press = null; }
    haptic('tap');
    releasePull();
    cancelRec();
    closeVoice();
    return;
  }
  const raw = Math.min(0, e.clientY - p.y);
  const now = performance.now();
  const vel = p.lastY != null ? (e.clientY - p.lastY) / Math.max(1, now - p.lastT) : 0; // px/ms, negative is up
  p.lastY = e.clientY; p.lastT = now;
  const band = -PULL_AT * (1 - Math.exp(raw / PULL_AT)) * 1.15; // rubber band: eases off as it goes
  el.owrap.classList.add('drag');
  el.owrap.style.translate = `0 ${band.toFixed(1)}px`;
  el.opull.style.opacity = String(Math.min(1, -raw / 80));
  if (raw < -PULL_AT || (raw < -40 && vel < -1.1)) { p.expanded = true; releasePull(); expandFull(); }
}
function releasePull() {
  el.owrap.classList.remove('drag');
  el.owrap.style.translate = '';
  el.opull.style.opacity = '';
}

export function initVoice(n) {
  nav = n;
  build();
  el.layer.hidden = true;
  el.layer.inert = true;

  // voice screen
  el.hold.addEventListener('pointerdown', holdDown);
  el.hold.addEventListener('pointerup', holdUp(true));
  el.hold.addEventListener('pointercancel', () => { v.press = null; });
  el.hold.addEventListener('contextmenu', e => e.preventDefault());
  el.layer.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    if (b.dataset.v === 'close') return closeVoice();
    if (b.dataset.v === 'send') return reviewSend();
    if (b.dataset.v === 'more') { haptic('tap'); return reviewMore(); }
    if (b.dataset.v === 'type') return startTyping();
    if (b.dataset.v === 'hint') { haptic('tap'); cancelRec(); handleText(b.textContent, { typed: true }); }
  });
  el.rtext.addEventListener('input', syncSend);
  el.rtext.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); reviewSend(); } });
  el.type.addEventListener('submit', e => {
    e.preventDefault();
    const text = el.input.value;
    el.input.blur();
    el.layer.classList.remove('typing');
    v.typing = false;
    handleText(text, { typed: true });
  });
  el.card.addEventListener('click', onCardClick);

  // dock orb: hold to talk (or tap to toggle, per setting)
  document.getElementById('dock').addEventListener('pointerdown', e => {
    const orb = e.target.closest('.orbbtn');
    if (!orb || e.button > 0) return;
    e.preventDefault();
    unlockAudio();
    try { orb.setPointerCapture(e.pointerId); } catch {}
    // hands-free and the orb is up: touching the dock orb again sends, like tapping the floating one
    if (v.open && v.mode === 'mini' && v.toggle && (mic.isRecording() || v.phase === 'opening')) { haptic('tap'); v.press = null; finishRec(); return; }
    // a tap opens the Coach; holding talks (the mic starts once it's clearly a hold)
    nav.warmCoach?.(true); // (a tap opens the Coach: it's painted, invisibly, while the finger is down)
    const press = v.press = { t: performance.now(), orb: true, y: e.clientY, waiting: true };
    orb.classList.add('pressing');
    press.timer = setTimeout(() => {
      if (v.press !== press || !press.waiting) return;
      press.waiting = false;
      press.t = performance.now() - HOLD_MS; // counts as a hold from here
      haptic('success');
      openMini();
      startRec();
    }, 240);
  });
  // while holding: drag the orb up to open the full voice screen
  document.getElementById('dock').addEventListener('pointermove', e => {
    const p = v.press;
    if (!p?.orb || !v.open || v.mode !== 'mini') return;
    pullTo(p, e);
  });
  const orbUp = e => {
    document.querySelector('#dock .orbbtn')?.classList.remove('pressing');
    if (!e.target.closest?.('.orbbtn') || !v.press?.orb) return;
    const p = v.press;
    if (p.waiting) { clearTimeout(p.timer); v.press = null; haptic('tap'); nav.openCoach?.(); return; } // a tap: the Coach
    const dt = performance.now() - p.t;
    v.press = null;
    if (v.mode === 'mini') releasePull();
    if (p.tapMode) return; // tap mode keeps listening until the orb is tapped again
    if (dt >= HOLD_MS || p.expanded) return finishRec();
    // a quick tap: keep listening hands-free; tap the floating orb to send
    v.toggle = true;
    if (v.phase === 'listening' || v.phase === 'opening') setPhase(v.phase);
  };
  document.getElementById('dock').addEventListener('pointerup', orbUp);
  document.getElementById('dock').addEventListener('pointercancel', () => { nav.warmCoach?.(false); document.querySelector('#dock .orbbtn')?.classList.remove('pressing'); if (v.press?.orb) { const p = v.press; v.press = null; if (p.waiting) clearTimeout(p.timer); else cancelRec(); } });
  document.getElementById('dock').addEventListener('contextmenu', e => { if (e.target.closest('.orbbtn')) e.preventDefault(); });

  // floating orb: tap to send (or to listen again), tap outside to cancel
  el.mini.addEventListener('click', e => {
    const o = e.target.closest('[data-o]')?.dataset.o;
    if (o === 'cancel') { haptic('tap'); cancelRec(); closeVoice(); }
    else if (o === 'orb') {
      haptic('tap');
      if (mic.isRecording() || v.phase === 'opening') finishRec();
      else if (v.phase !== 'thinking') { v.toggle = true; startRec(); }
    }
  });
  let drag = null;
  el.owrap.addEventListener('pointerdown', e => { drag = { y: e.clientY, t: performance.now() }; try { el.owrap.setPointerCapture(e.pointerId); } catch {} });
  el.owrap.addEventListener('pointermove', e => { if (drag && v.mode === 'mini') pullTo(drag, e); });
  const dragEnd = () => { if (drag) { drag = null; releasePull(); } };
  el.owrap.addEventListener('pointerup', dragEnd);
  el.owrap.addEventListener('pointercancel', dragEnd);

  // the parser's first sentence is its slowest (nothing compiled yet): run one while the app is idle,
  // so the first thing you say isn't also a hitch at the moment you let go
  (window.requestIdleCallback || setTimeout)(() => { try { parse('bench press 80 kg 8 reps', parseCtx()); } catch {} }, { timeout: 4000 });
  tts.onSpeaking(on => document.getElementById('app').classList.toggle('speaking', on));
  store.subscribe(reason => { if (reason === 'settings' && v.open) paintStatic(); });
}

export const orbHTML = () => `<button class="orbbtn" aria-label="${esc(state.t('voice.talk'))}"><span class="obub" aria-hidden="true"></span><span class="orb"><i class="core"><b></b><b></b><b></b></i></span><span class="orest" aria-hidden="true"><i><b></b></i><i><b></b></i></span></button>`;
export const isVoiceOpen = () => v.open;
