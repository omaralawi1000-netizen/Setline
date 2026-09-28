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
import { unlockAudio, resumeAudio } from '../audio.js';
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
import { orbPulse, orbShake, orbSpark, moving, token } from './fx.js';
import { setOrb } from './dotorb.js';
import { theOrb, frost, flyOrb, flyOrbTo, orbGesture, orbSettleGesture, orbPos, onOrbMove, orbHome, seatOrb, viewSize, chatMoving, revealChat } from './stage.js';
import { perfNote } from './perf.js';
import { spring } from './spring.js';
import { createHoldTalk } from './holdtalk.js';
import { M, slowmo } from '../motion.config.js';
import { onFrame, nextFrame } from './frame.js';
import { livePRSets } from '../pr.js';
import { ask as askCoach, ensureModels } from './coach.js';
import { cmdModels } from '../settings.js';
import { createEndpointer, looksUnfinished } from '../endpoint.js';

const endpoint = createEndpointer({ pauseMs: 850 });
const WAIT_MS = 3000; // sounded unfinished: still send after this much quiet

const HOLD_MS = 280;          // shorter press = tap
const BARS = 27;
const RM = matchMedia('(prefers-reduced-motion: reduce)'); // (a live query: asked every frame, made once)
const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && RM.matches);

let nav = { go: () => {}, showDetail: () => {}, openSettings: () => {} };
const v = {
  open: false, phase: 'idle', toggle: false, typing: false,
  press: null, token: 0, closing: null, popWaiting: 0,
  raf: null, lvl: 0, hist: new Float32Array(64), histAt: 0, closeSeq: 0,
  mode: '', autoSend: false, pressing: false, blocked: false, failed: false, edited: false, watchdog: 0, micError: ''
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

// ---------- the voice layer: quick mode and the review sheet ----------
// One orb (js/ui/stage.js) flies between the dock, halfway up the screen (quick: you hold and talk),
// the top of the review sheet, and the message box. The waveform and two labels ride with it.

const BIG = 184; // the orb's size while you talk (the old voice screen's orb)

function build() {
  const layer = $('#voice');
  layer.className = 'vflow';
  layer.innerHTML = `
    <section class="rv" id="vreview" role="dialog">
      <header class="rvtop"><button class="iconbtn" data-v="discard">${I.close}</button><div class="live" id="vpill"><i></i><span class="xs"><span class="on"></span><span></span></span></div><span class="chip" id="vlang"></span></header>
      <div class="rvspace"></div>
      <div class="rvtext" id="vtextbox"><textarea id="vtext" rows="2" readonly enterkeyhint="send" autocapitalize="sentences" autocomplete="off" spellcheck="false"></textarea><span class="rvshim" id="vshim"></span></div>
      <div class="rvhints" id="vhints"></div>
      <div class="rvbar"><button class="rvmic" id="vmic">${micIcon}</button><button class="rvsend" id="vsend">${I.fwd}<span></span></button></div>
    </section>
    <div class="vq" id="vq">
      <p class="vlabel vup" id="vup"></p>
      <div class="wave" id="vwave" aria-hidden="true">${'<i></i>'.repeat(BARS)}</div>
      <p class="vlabel vstat" id="vstat"><span class="xs"><span class="on"></span><span></span></span></p>
      <p class="vlabel vlow" id="vlow"></p>
    </div>`;
  Object.assign(el, {
    layer, vq: $('#vq'), up: $('#vup'), status: $('#vstat .xs'), stat: $('#vstat'), pill: $('#vpill .xs'), low: $('#vlow'), wave: $('#vwave'), bars: [...$('#vwave').children],
    review: $('#vreview'), lang: $('#vlang'), text: $('#vtext'), textbox: $('#vtextbox'), shim: $('#vshim'), hints: $('#vhints'),
    mic: $('#vmic'), send: $('#vsend'), card: $('#intent'), orb: theOrb()
  });
  // the waveform and labels ride with the orb (a transform, and their spacing from its size)
  let lastR = 0;
  onOrbMove(p => {
    if (!v.open && !el.layer.classList.contains('handing')) return;
    // in quick mode they wait at the orb's resting place (and follow the finger), so they don't ride up
    // from the dock with it; from the review sheet on, they go where the orb goes
    const quick = v.mode === 'quick';
    const y = quick ? quickOrb().y + v.fingerDy : p.y, x = quick ? viewSize().W / 2 : p.x;
    el.vq.style.transform = `translate3d(${(x - viewSize().W / 2).toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    const r = quick ? BIG / 2 : p.size / 2;
    if (Math.abs(r - lastR) > 0.5) { lastR = r; el.vq.style.setProperty('--r', `${r.toFixed(1)}px`); }
  });
}

const micIcon = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0M12 18v3"/></svg>';
const keyboardIcon = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8"/></svg>';

function paintStatic() {
  const t = state.t;
  el.review.setAttribute('aria-label', t('voice.talk'));
  el.review.querySelector('[data-v=discard]').setAttribute('aria-label', t('voice.discard'));
  el.lang.textContent = t(`voice.lang.${state.settings.voiceLang}`);
  el.text.setAttribute('aria-label', t('voice.typePh'));
  el.shim.textContent = t('voice.transcribing');
  el.up.textContent = t('voice.swipeUp');
  el.low.textContent = t('voice.release');
  el.mic.setAttribute('aria-label', t('voice.recordMore'));
  el.send.querySelector('span').textContent = t('voice.send');
  const hints = state.active
    ? ['voice.hint.same', 'voice.hint.add', 'voice.hint.skip', 'voice.hint.next', 'voice.hint.last']
    : ['voice.hint.start', 'voice.hint.log', 'voice.hint.last'];
  el.hints.innerHTML = `<button class="kbd" data-v="type">${keyboardIcon}${t('voice.type')}</button>` +
    hints.map(k => `<button data-v="hint">${esc(t(k))}</button>`).join('');
  el.hints.scrollLeft = 0; // (the row always starts at its first chip)
}

function setPhase(phase) {
  // didn't get it: the orb shakes its head
  if (phase === 'error' && v.phase !== 'error') orbShake(el.orb);
  v.phase = phase;
  el.layer.dataset.phase = phase;
  paintLabel();
  syncSend();
}
// the label under the waveform says what's happening, in the words of the mode you're in
function paintLabel() {
  const t = state.t, p = v.phase;
  // quick mode: what the mic is doing, under the waveform ("Release to send" is its own line under that)
  let k = '';
  if (v.failed) k = 'voice.micFailed';
  else if (v.blocked) k = 'voice.micBlocked';
  else if (p === 'opening') k = 'voice.opening';
  else if (p === 'listening') k = el.layer.dataset.pause === 'wait' ? 'voice.takeTime' : 'voice.listening';
  crossLabel(el.status, k ? t(k) : '');
  // the review sheet: the old voice screen's status pill
  const pill = v.failed ? 'voice.micFailed' : { idle: 'voice.ready', opening: 'voice.opening', listening: 'voice.listening', thinking: 'voice.thinking', result: 'voice.ready', error: 'voice.ready' }[p] || 'voice.ready';
  crossLabel(el.pill, t(pill));
}
const reviewText = () => el.text.value.trim();
function syncSend() {
  el.send.disabled = !reviewText() || v.phase === 'thinking' || v.phase === 'opening' || v.phase === 'listening';
  el.review.classList.toggle('filled', !!reviewText());
}

// A label that changes swaps in place: the old text fades out (80 ms), then the new one fades in
// (120 ms). The two are never on screen together.
function crossLabel(host, text) {
  const [a, b] = host.children, cur = a.classList.contains('on') ? a : b, next = cur === a ? b : a;
  if (cur.textContent === text) return;
  if (reduced() || !cur.textContent) { cur.textContent = text; next.textContent = ''; return; }
  next.textContent = text;
  next.classList.add('on');
  cur.classList.remove('on');
  clearTimeout(host._x);
  host._x = setTimeout(() => { if (!cur.classList.contains('on')) cur.textContent = ''; }, 90);
}

const dockBtn = () => document.querySelector('#dock .orbbtn');
const dockOrb = () => document.querySelector('#dock .orbbtn .orb');

// ---------- the review sheet's own spring (its top edge) ----------
const reviewTop = () => viewSize().H * (1 - M.reviewHeightPct / 100);
let rv0 = 1; // where it started from (for its opening stretch)
const rvSpring = spring({ y: 0 }, { onRest: () => el.layer.classList.remove('rvmoving'), onUpdate: ({ y }) => {
  if (!el.layer.classList.contains('rvmoving') && rvSpring?.running) el.layer.classList.add('rvmoving');
  const k = rv0 > 0 ? Math.max(0, Math.min(1, 1 - y / rv0)) : 1;
  el.review.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scaleX(${(0.92 + 0.08 * k).toFixed(4)})`;
} });
const reviewOrb = () => ({ x: viewSize().W / 2, y: reviewTop() + rvSpring.value.y + 56 + (BIG * M.reviewScale) / 2, size: BIG * M.reviewScale });
const quickOrb = () => ({ x: viewSize().W / 2, y: viewSize().H * (M.orbRestPct / 100), size: BIG });

function showLayer(mode) {
  const a = document.getElementById('app');
  el.layer.hidden = false;
  el.layer.inert = false;
  el.layer.classList.remove('handing', 'm-quick', 'm-review', 'blocked');
  el.layer.classList.add('on', `m-${mode}`);
  el.layer.style.setProperty('--rvh', String(M.reviewHeightPct));
  el.layer.style.setProperty('--p', '0');
  a.classList.add('voice');
  frost(true);
}

// Quick mode: the finger is still down; the orb rises from the dock to halfway up the screen.
function enterQuick() {
  hideToast();
  v.pressing = false;
  if (!getKey('groq') || navigator.onLine === false) {
    hold.reset();
    teardown('nokey');
    preflight();
    return;
  }
  v.open = true;
  v.mode = 'quick';
  v.fingerDy = 0;
  v.blocked = false;
  v.failed = false;
  flyOrb(quickOrb, { size: BIG }); // (measured where it is first, before anything else changes)
  paintStatic();
  showLayer('quick');
  for (const x of [...el.status.children, ...el.pill.children]) { x.textContent = ''; } // (fresh: nothing to fade from)
  dockBtn()?.classList.remove('pressing');
  resumeAudio();
  startLoop();
  startRec(); // the same start as the old voice sheet's hold
}
function quickFollow({ offset, progress }) {
  v.fingerDy = offset;
  orbGesture({ dy: offset, stretch: progress });
  el.layer.style.setProperty('--p', progress.toFixed(3));
}

// Review: the sheet grows up out of the orb and the orb rides up to its top. From quick (the finger
// still down and talking), or opened on its own (the Food screen's "Say it", Retry, Edit).
function enterReview({ from = 'quick', live = false } = {}) {
  const { H } = viewSize();
  v.open = true;
  v.mode = 'review';
  v.autoSend = live;
  v.edited = false;
  el.text.value = '';
  el.textbox.classList.remove('busy');
  paintStatic();
  if (from === 'quick') {
    const y = orbPos().y;
    orbSettleGesture();
    rv0 = Math.max(1, y - reviewTop());
    el.layer.classList.remove('m-quick');
    el.layer.classList.add('m-review');
  } else {
    showLayer('review');
    rv0 = H - reviewTop();
    startLoop();
  }
  rvSpring.set({ y: rv0 });
  rvSpring.to({ y: 0 });
  flyOrb(reviewOrb, { size: BIG });
  paintLabel();
  syncSend();
  pushVoiceEntry();
}

function pushVoiceEntry() {
  const push = () => { if (v.open && v.mode === 'review' && !history.state?.voice) history.pushState({ ...(history.state || {}), voice: 1 }, ''); };
  if (v.closing) v.closing.then(push); else push();
}

// Food screen's "Say it": open the voice sheet and start listening straight away.
export function talkNow() {
  unlockAudio();
  if (!v.open) openVoice({ live: true });
  v.toggle = true;
  startRec();
}

// The review sheet on its own (Food's "Say it", Retry, Edit, the home-screen shortcut).
export function openVoice({ live = false } = {}) {
  hideToast();
  if (v.open) { if (live) v.autoSend = true; return; }
  if (!chatUnderIsFree()) return;
  enterReview({ from: 'dock', live });
}
const chatUnderIsFree = () => !chatMoving();

// Every way out of the voice layer ends here (release, cancel, X, an error, Back, the app hiding): the
// state machine goes idle, the mic stops (unless the recording is on its way to be transcribed), the
// layer and its sheet go, the orb flies home and the frost fades. Whatever the animations do, a hard
// reset a moment later leaves nothing behind.
function teardown(reason, { keepRec = false, orb = 'dock', slide = true } = {}) {
  const app = document.getElementById('app');
  const wasReview = v.mode === 'review' || el.layer.classList.contains('m-review');
  v.open = false;
  v.mode = '';
  v.press = null;
  v.toggle = false;
  v.autoSend = false;
  v.blocked = false;
  v.failed = false;
  v.pressing = false;
  clearTimeout(v.watchdog);
  if (!keepRec) cancelRec();
  hold?.reset();
  el.text.blur();
  el.text.readOnly = true;
  dockBtn()?.classList.remove('pressing');
  app.classList.remove('voice');
  el.layer.inert = true;
  el.layer.classList.remove('on', 'm-quick', 'blocked', 'failed', 'carded');
  if (!app.classList.contains('chatsheet')) frost(false);
  const seq = ++v.closeSeq;
  const finish = () => {
    if (seq !== v.closeSeq || v.open) return;
    el.layer.classList.remove('m-review', 'handing', 'rvmoving');
    el.layer.hidden = true;
    el.text.value = '';
    el.textbox.classList.remove('busy');
    rvSpring.halt();
    el.review.style.transform = '';
    el.vq.style.transform = '';
    for (const n of document.querySelectorAll('.flytext')) n.remove();
    stopLoop();
    if (orb === 'dock' && orbHome() === 'flying') seatOrb('dock');
  };
  if (wasReview && slide) rvSpring.to({ y: viewSize().H - reviewTop() }).then(finish);
  else if (!wasReview) setTimeout(finish, 220 * slowmo); // (the labels fade out first)
  if (orb === 'dock' && orbHome() !== 'dock') flyOrbTo('dock', { size: 60 }).then(landed => { if (landed && seq === v.closeSeq) orbPulse('pulse-land'); });
  setTimeout(finish, (reduced() ? 160 : 800) * slowmo); // the hard reset
  void reason;
}

// Close whatever the voice layer shows: the sheet slides back down, the orb flies home to the dock
// and the frost fades. Resolves once history has settled so callers can navigate safely.
export function closeVoice({ fromPop = false } = {}) {
  if (!v.open) return v.closing || Promise.resolve();
  teardown('close');
  // only step back over our own entry, never past it (that would leave the app)
  if (fromPop || !history.state?.voice) return v.closing || Promise.resolve();
  v.closing = new Promise(res => { v.popWaiting++; v.popResolve = res; history.back(); }).then(() => { v.closing = null; });
  return v.closing;
}

// reopened while the old entry was being popped: give the open layer its entry back
function push2() { if (!history.state?.voice) history.pushState({ ...(history.state || {}), voice: 1 }, ''); }

// popstate hook: returns true if the voice layer consumed it.
export function voiceHandlePop() {
  if (v.popWaiting) { v.popWaiting--; v.popResolve?.(); if (v.open && v.mode === 'review') push2(); return true; }
  if (v.open) { closeVoice({ fromPop: true }); return true; }
  return false;
}

// ---------- level animation (transform/opacity only) ----------

function startLoop() {
  if (v.raf) return;
  const orb = el.orb, light = orb.querySelector('.olight');
  orb.classList.add('driven');
  v.lightO = 0.45;
  // on the app's one shared frame (js/ui/frame.js), with the orbs
  const tick = now => {
    const listening = v.phase === 'listening';
    const target = listening ? mic.level() : 0;
    v.lvl += (target - v.lvl) * (target > v.lvl ? 0.45 : 0.12);
    v.hist[v.histAt = (v.histAt + 1) % v.hist.length] = v.lvl;
    // tapped to talk: a pause sends it, but only once what you said sounds finished
    const dt = v.lastTick ? now - v.lastTick : 0;
    v.lastTick = now;
    if (listening && v.toggle && v.autoSend) {
      const ev = endpoint.push(target, dt);
      if (ev === 'pause') speculate();
      else if (ev === 'resume') { v.spec = null; v.waiting = false; setPausing(''); }
      if (v.waiting && endpoint.quietMs >= WAIT_MS) { v.waiting = false; finishRec(); }
    }
    const b = listening ? mic.bands() : { low: 0, high: 0, rms: 0, voice: [0, 0, 0] };
    // the dotted orb ripples with the voice (the lows round its middle, the highs at its poles)
    setOrb(orb, { state: listening ? 'listening' : v.phase === 'thinking' ? 'thinking' : 'idle', level: v.lvl, bands: [b.low, b.voice[1] * 3, b.high] });
    if (reduced()) return;
    const l = v.lvl;
    // alive, not mechanical: a slow breath, and a soft squash and stretch that follows the voice
    const breath = v.phase === 'thinking' ? 0 : 0.012 * Math.sin(now / 700);
    const sx = 1 + breath + l * 0.07 + l * 0.025 * Math.sin(now / 95);
    const sy = 1 + breath + l * 0.09 + l * 0.025 * Math.cos(now / 110);
    orb.style.transform = `scale(${(1 + (sx - 1) * 0.7).toFixed(4)}, ${(1 + (sy - 1) * 0.7).toFixed(4)})`;
    // its light on the frost: brighter with your voice (eased here: a transition would restart every frame)
    const k = 1 - Math.exp(-dt / 100);
    v.lightO += ((listening ? 0.45 + l * 0.55 : v.phase === 'thinking' ? 0.5 : 0.35) - v.lightO) * k;
    light.style.opacity = v.lightO.toFixed(3);
    light.style.transform = `scale(${(1 + l * 0.25).toFixed(3)})`;
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

function stopLoop() {
  v.raf?.(); v.raf = null; v.lastTick = 0;
  const orb = el.orb, light = orb?.querySelector('.olight');
  if (!orb) return;
  orb.classList.remove('driven');
  orb.style.transform = '';
  if (light) { light.style.opacity = ''; light.style.transform = ''; }
  setOrb(orb, null);
}

// ---------- recording ----------

function preflight() {
  if (!getKey('groq')) return showError('voice.noKey', 'voice.noKeySub', { settings: true, type: true }), false;
  if (navigator.onLine === false) return showError('voice.offline', 'voice.offlineSub', { type: true }), false;
  return true;
}

// The mic opens here, the same way for every screen (the hold, the review sheet's mic, Say it, Retry).
async function startRec() {
  if (mic.isRecording() || v.phase === 'opening') return;
  if (!preflight()) return;
  tts.stop();
  if (card.cmd) dismissCard(); // lands a pending command
  const token = ++v.token;
  setPhase('opening');
  const opening = performance.now();
  // not listening within 4 s: say so (tap to retry), and leave a trace of why
  clearTimeout(v.watchdog);
  v.watchdog = setTimeout(() => { if (token === v.token && v.phase !== 'listening') micDidntStart(token, v.micError || 'timeout'); }, 4000);
  try {
    await mic.start({ onMaxed: () => finishRec() });
  } catch (e) {
    if (token !== v.token) return;
    v.toggle = false;
    v.micError = e.name2 || e.code;
    clearTimeout(v.watchdog);
    logMic(e.name2 || e.code);
    if (v.mode === 'quick') { // held with no mic: say so; letting go opens the sheet to type instead
      v.blocked = e.code === 'denied' || e.code === 'nomic';
      if (!v.blocked) return micDidntStart(token, e.name2 || e.code);
      setPhase('error');
      el.layer.classList.add('blocked');
      return;
    }
    if (e.code === 'denied') return showError('voice.micDenied', 'voice.micDeniedSub', { type: true });
    if (e.code === 'nomic') return showError('voice.noMic', 'voice.micDeniedSub', { type: true });
    return showError('voice.sttFailed', 'voice.sttFailedSub', { type: true });
  }
  if (token !== v.token || !v.open) { mic.cancel(); clearTimeout(v.watchdog); return; }
  if (v.mode !== 'quick') haptic('tap');
  if (v.pendingStop && performance.now() - opening > 700) {
    // released while Chrome asked for the mic: nothing useful was recorded
    v.pendingStop = false;
    mic.cancel();
    clearTimeout(v.watchdog);
    setPhase('idle');
    showCard({ kind: 'info', icon: 'info', title: state.t('voice.micReady'), sub: state.t('voice.micReadySub'), lang: state.lang });
    return;
  }
  endpoint.reset();
  v.spec = null; v.waiting = false; setPausing('');
  resumeAudio();
  // "Listening" only once audio is really coming in (the recorder has data, or the meter can read it)
  await new Promise(res => { const stop = onFrame(() => { if (token !== v.token || !mic.isRecording() || mic.flowing()) { stop(); res(); } }); });
  if (token !== v.token || !mic.isRecording()) return;
  clearTimeout(v.watchdog);
  setPhase('listening');
  if (v.pendingStop) { v.pendingStop = false; finishRec(); }
}
function logMic(why) {
  const say = state => { const line = `mic: ${why} (permission ${state})`; console.warn(line); perfNote(line); };
  try { navigator.permissions?.query({ name: 'microphone' }).then(p => say(p.state), () => say('unknown')); } catch { say('unknown'); }
}
function micDidntStart(token, why) {
  if (token !== v.token) return;
  logMic(why);
  mic.cancel();
  v.failed = true;
  el.layer.classList.add('failed');
  setPhase('error');
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
  el.layer.dataset.pause = k;
  if (v.phase === 'listening') crossLabel(el.status, state.t(k === 'wait' ? 'voice.takeTime' : 'voice.listening'));
}

async function finishRec() {
  if (v.phase === 'opening') { v.pendingStop = true; return; }
  if (!mic.isRecording()) return;
  const token = v.token;
  v.toggle = false;
  v.spec = null; v.waiting = false; setPausing('');
  setPhase('thinking');
  const intoSheet = v.open && v.mode === 'review';
  if (intoSheet) el.textbox.classList.add('busy'); // "Transcribing…" where the words will appear
  const r = await mic.stop();
  if (!r || token !== v.token) { el.textbox.classList.remove('busy'); return; }
  if (r.ms < 400 || (r.measured && r.peak < 0.03) || r.blob.size < 800) return showError('voice.didntCatch', 'voice.tooShortSub'); // (an empty recording is never sent)
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
  if (!text) return showError('voice.tooShort', 'voice.tooShortSub', { retry: true });
  deliver(text);
}
// What you said goes where you said it: into the review sheet (sent when you tap Send, or at once
// when it was opened to listen and send), otherwise straight on to be understood and done.
function deliver(text) {
  if (v.open && v.mode === 'review') {
    appendReview(text);
    setPhase('idle');
    if (v.autoSend) sendReview();
    return;
  }
  handleText(text);
}

function cancelRec() {
  v.token++;
  v.toggle = false;
  v.pendingStop = false;
  clearTimeout(v.watchdog);
  mic.cancel();
  el.textbox?.classList.remove('busy');
  setPhase('idle'); // (always: a phase left at "opening" once made every later start a no-op)
}

// ---------- text → intent → card ----------

export function handleText(text, { typed = false } = {}) {
  text = String(text || '').trim();
  if (!text) return;
  if (!typed) noteHeard(text); // kept for a bug report
  if (card.cmd && !card.committed && card.cmd.kind === 'auto') commitNow(); // a new command lands the previous one
  const intent = parse(text, parseCtx());
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
// - Released from quick mode: the chat is already up (your message shimmering in it), so the words
//   just fill in and it's asked.
// - Sent from the review sheet: the sheet's surface becomes the chat, your words fly into their
//   bubble and the orb into the message box.
// - Anywhere else: the Coach opens and it's asked.
async function toCoach(text) {
  dismissCard();
  if (v.open && v.mode === 'review') { await new Promise(r => setTimeout(r)); if (v.open && v.mode === 'review' && nav.coachUnder?.()) return reviewToChat(text); }
  if (v.open) await closeVoice();
  nav.go('coach');
  askCoach(text);
}

// Released in quick mode: send, and don't wait on the voice screen. The chat rises over the frost
// at once with your message shimmering at the bottom while the words are worked out; the orb shrinks
// into the message box. If it turns out to be a command, the chat goes back down and it's done.
function quickSend() {
  if (v.blocked) { // no mic: type it instead
    v.blocked = false;
    hold.done();
    el.layer.classList.remove('blocked');
    enterReview({ from: 'quick' });
    startTyping();
    return;
  }
  if (v.failed) { // the mic never started: nothing to send; the card offers to try again
    teardown('failed');
    showError('voice.micFailed', 'voice.micFailedSub', { retry: true, type: true });
    return;
  }
  if (v.phase !== 'listening' || !mic.isRecording()) { // let go before any audio came in
    teardown('empty');
    showError('voice.didntCatch', 'voice.tooShortSub');
    return;
  }
  // exactly what "Release to send" did: the recording is transcribed and routed (commands done,
  // questions to the Coach); meanwhile the orb sinks back into the dock and the frost fades
  finishRec();
  teardown('send', { keepRec: true });
}

// Send from the review sheet.
function sendReview() {
  const text = reviewText();
  if (!text || v.phase === 'thinking') { hold.done(); return; }
  if (mic.isRecording()) cancelRec();
  el.text.blur();
  setPhase('thinking');
  hold.done();
  handleText(text, { typed: v.edited });
}

// The review sheet turns into the chat: its controls go, its surface rises to where the chat's is
// (the chat is already in place under it, laid out and at its end), your words fly from the sheet
// into their bubble with the text scaling down to the bubble's size, and the orb flies into the
// message box. Then the chat's own content fades up on the same surface.
function reviewToChat(text) {
  const words = el.text, from = words.getBoundingClientRect(), A = document.getElementById('app').getBoundingClientRect();
  const fromFont = parseFloat(getComputedStyle(words).fontSize) || 27;
  v.open = false;
  v.mode = '';
  v.token++;
  mic.cancel();
  hold.reset();
  el.layer.inert = true;
  el.layer.classList.add('handing');
  el.layer.classList.remove('on', 'm-review');
  document.getElementById('app').classList.remove('voice');
  askCoach(text);
  const seq = ++v.closeSeq;
  nextFrame(() => {
    // measured once, before anything moves this frame: the bubble at its final place
    const mine = [...document.querySelectorAll('#s-coach .msg.me')].pop(), bub = mine?.querySelector('.bub');
    const chatTop = document.getElementById('s-coach')?.getBoundingClientRect().top ?? 0;
    let fly = null;
    if (bub && !reduced()) {
      const to = bub.getBoundingClientRect(), cs = getComputedStyle(bub);
      fly = document.createElement('div');
      fly.className = 'flytext';
      fly.innerHTML = `<div class="bub"></div>`;
      const b = fly.firstChild;
      b.textContent = bub.textContent;
      Object.assign(b.style, { boxSizing: 'border-box', width: `${to.width}px`, padding: cs.padding, borderRadius: cs.borderRadius, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, background: 'transparent', whiteSpace: to.height < parseFloat(cs.lineHeight) * 1.8 + parseFloat(cs.paddingTop) * 2 ? 'nowrap' : 'normal', position: 'relative' });
      const bg = document.createElement('span');
      Object.assign(bg.style, { position: 'absolute', inset: '0', borderRadius: cs.borderRadius, background: cs.background, opacity: '0' });
      fly.prepend(bg);
      fly.style.width = `${to.width}px`;
      document.getElementById('app').append(fly);
      mine.style.visibility = 'hidden';
      const k0 = fromFont / (parseFloat(cs.fontSize) || 16);
      const pad = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0;
      const x0 = from.left - A.left - pad * k0, y0 = from.top - A.top - padT * k0, x1 = to.left - A.left, y1 = to.top - A.top;
      const g = spring({ t: 0 }, { onUpdate: ({ t }) => {
        const k = k0 + (1 - k0) * t;
        fly.style.transform = `translate3d(${(x0 + (x1 - x0) * t).toFixed(1)}px, ${(y0 + (y1 - y0) * t).toFixed(1)}px, 0) scale(${k.toFixed(4)})`;
        bg.style.opacity = Math.min(1, t * 1.4).toFixed(3);
      } });
      g.set({ t: 0 });
      fly._go = g.to({ t: 1 });
    }
    const rise = rvSpring.to({ y: chatTop - (A.top + reviewTop()) });
    const orbGoes = flyOrbTo('composer');
    Promise.all([rise, fly?._go]).then(() => {
      if (seq !== v.closeSeq) return;
      revealChat(); // the chat's own content fades up on the surface the sheet became
      if (mine) mine.style.visibility = '';
      setTimeout(() => { fly?.remove(); if (seq === v.closeSeq) teardown('sent', { keepRec: true, orb: 'none', slide: false }); }, 200 * slowmo);
    });
    // (if anything above stalls, the chat is shown and the sheet cleared anyway)
    setTimeout(() => { if (seq !== v.closeSeq) return; revealChat(); if (mine) mine.style.visibility = ''; teardown('sent', { keepRec: true, orb: 'none', slide: false }); }, 1200 * slowmo);
    orbGoes.then(landed => { stopLoop(); if (landed) nav.landInBox?.(); });
  });
}

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
  // "Working it out" only if it takes a while (600 ms); once shown, it stays long enough to read
  let shownAt = 0;
  const waitCard = setTimeout(() => { if (mine === aiSeq) { showCard({ kind: 'wait', icon: 'info', title: t('voice.thinkingAi'), sub: t('voice.heard', { text }), lang, intent: parsed }); shownAt = performance.now(); } }, 600);
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
  clearTimeout(waitCard);
  if (shownAt) { const left = 800 - (performance.now() - shownAt); if (left > 0) await new Promise(r => setTimeout(r, left)); }
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
    if (!v.open) openVoice({ live: true });
    el.text.value = v.carry; // (what was heard so far, in the sheet; the rest is added to it)
    v.carry = '';
    syncSend();
    v.toggle = true;
    return startRec();
  }
  if (k === 'retry') { dismissCard({ keepPending: false }); if (!v.open) openVoice({ live: true }); v.toggle = true; return startRec(); }
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
  if (prefill) { el.text.value = prefill; v.edited = true; }
  syncSend();
  setTimeout(() => { el.text.focus(); const n = el.text.value.length; el.text.setSelectionRange(n, n); }, 60);
}
// what you said arrives in the review sheet: added after what's there, large and editable
function appendReview(text) {
  el.text.value = [reviewText(), text].filter(Boolean).join(' ');
  el.textbox.classList.remove('busy');
  syncSend();
}

// The review sheet's mic: hold to add more, or tap to start and tap again to stop
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
function holdUp(e) {
  const p = v.press;
  v.press = null;
  if (!p) return;
  const dt = performance.now() - p.t;
  if (dt >= HOLD_MS) return finishRec();
  v.toggle = true;
  if (v.phase === 'listening' || v.phase === 'opening') setPhase(v.phase);
  void e;
}

// ---------- the dock orb: hold to talk (js/ui/holdtalk.js) ----------
let hold = null;
function pressStart() {
  dockBtn()?.classList.add('pressing'); // the orb grows under the finger in this same frame
  unlockAudio(); // (the mic itself starts at the hold, 250 ms on, like it always did)
}
function pressTap() {
  dockBtn()?.classList.remove('pressing');
  v.pressing = false;
  haptic('tap');
  nav.openCoach?.();
}
function cancelHold(reason, from) {
  dockBtn()?.classList.remove('pressing');
  v.pressing = false;
  if (from === 'pressing') return;
  if (v.open) teardown(reason);
}

export function initVoice(n) {
  nav = n;
  build();
  el.layer.hidden = true;
  el.layer.inert = true;
  hold = createHoldTalk({
    canStart: () => !v.open && !chatMoving() && orbHome() === 'dock',
    vibrate: ms => { try { navigator.vibrate?.(ms); } catch {} },
    press: pressStart,
    tap: pressTap,
    quick: enterQuick,
    follow: quickFollow,
    review: () => enterReview({ from: 'quick' }),
    send: quickSend,
    reviewRelease: () => { if (mic.isRecording() || v.phase === 'opening') finishRec(); },
    reviewInterrupt: () => cancelRec(),
    reviewSend: sendReview,
    cancel: cancelHold
  });

  // the review sheet
  el.mic.addEventListener('pointerdown', holdDown);
  // the words: large and still until you tap them, then editable
  el.text.addEventListener('click', () => { if (!el.text.readOnly) return; el.text.readOnly = false; v.edited = true; el.text.focus(); });
  // the mic didn't start: tap the line to try again
  el.stat.addEventListener('click', () => { if (!v.failed) return; v.failed = false; el.layer.classList.remove('failed'); setPhase('idle'); startRec(); });
  el.mic.addEventListener('pointerup', holdUp);
  el.mic.addEventListener('pointercancel', () => { v.press = null; });
  el.mic.addEventListener('contextmenu', e => e.preventDefault());
  el.send.addEventListener('click', () => { haptic('tap'); if (!hold.send()) sendReview(); });
  el.text.addEventListener('input', () => { v.edited = true; syncSend(); });
  el.text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!el.send.disabled) el.send.click(); } });
  el.layer.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (b?.dataset.v === 'discard') { haptic('tap'); return closeVoice(); }
    if (b?.dataset.v === 'type') return startTyping();
    if (b?.dataset.v === 'hint') { haptic('tap'); cancelRec(); handleText(b.textContent, { typed: true }); }
  });
  el.card.addEventListener('click', onCardClick);

  // the dock orb: a tap opens the Coach, holding talks
  const dock = document.getElementById('dock');
  const onOrb = e => e.target.closest?.('.orbbtn');
  let finger = null, swallowUntil = 0;
  dock.addEventListener('pointerdown', e => {
    if (!onOrb(e) || e.button > 0) return;
    e.preventDefault();
    if (!hold.down({ x: e.clientX, y: e.clientY, pointerId: e.pointerId })) return;
    finger = e.pointerId;
    try { onOrb(e).setPointerCapture(e.pointerId); } catch {}
  });
  // the finger is followed on the window (so wherever it goes, and even if the capture is lost, its
  // movement and its lifting are seen), and read once per frame (the orb follows it there)
  let pending = null;
  addEventListener('pointermove', e => {
    if (e.pointerId !== finger || hold.state === 'idle') return;
    const first = !pending;
    pending = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    if (first) nextFrame(() => { const p = pending; pending = null; if (p) hold.move(p); });
  }, { passive: true });
  addEventListener('pointerup', e => {
    if (e.pointerId !== finger) return;
    finger = null;
    swallowUntil = performance.now() + 400; // (the click a phone makes from this touch does nothing)
    if (pending) { hold.move(pending); pending = null; }
    hold.up({ x: e.clientX, y: e.clientY, pointerId: e.pointerId });
  }, true);
  addEventListener('pointercancel', e => { if (e.pointerId !== finger) return; finger = null; pending = null; hold.cancel('pointercancel'); }, true);
  document.addEventListener('click', e => { if (performance.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  dock.addEventListener('contextmenu', e => { if (onOrb(e)) e.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { finger = null; hold.cancel('visibility'); } });
  addEventListener('blur', () => { finger = null; hold.cancel('blur'); });

  tts.onSpeaking(on => document.getElementById('app').classList.toggle('speaking', on));
  store.subscribe(reason => { if (reason === 'settings' && v.open) paintStatic(); });
}

// The dock's orb button: an empty seat; the one orb sits in it when it's home (js/ui/stage.js)
export const orbHTML = () => `<button class="orbbtn" aria-label="${esc(state.t('voice.talk'))}"><span class="obub" aria-hidden="true"></span><span class="orest" aria-hidden="true"><i><b></b></i><i><b></b></i></span></button>`;
export const isVoiceOpen = () => v.open;
export const holdState = () => hold?.state || 'idle';
