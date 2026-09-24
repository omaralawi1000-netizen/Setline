// Voice: the Orb, the voice screen, and the intent card.
// Pipeline: hold → record → Groq → parser → intent card → auto-commit (or confirm) → spoken reply.
import * as store from '../store.js';
import { state } from '../store.js';
import * as mic from '../voice.js';
import * as tts from '../tts.js';
import { transcribe, buildPrompt } from '../stt.js';
import { parse } from '../parser.js';
import { resolve, AUTO_MS } from '../commands.js';
import { translator } from '../i18n.js';
import { getKey } from '../keys.js';
import { sttModelId, ttsModelId } from '../settings.js';
import { firstPlannedIndex, lastDoneIndex, restRemaining } from '../workout.js';
import { unlockAudio } from '../audio.js';
import { haptic } from '../haptics.js';
import { $, esc } from './dom.js';
import { I } from './icons.js';
import { hideToast } from './toast.js';

const HOLD_MS = 280;          // shorter press = tap
const BARS = 27;
const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

let nav = { go: () => {}, showDetail: () => {}, openSettings: () => {} };
const v = {
  open: false, phase: 'idle', toggle: false, typing: false,
  press: null, token: 0, closing: null, popWaiting: 0,
  raf: 0, lvl: 0, hist: new Float32Array(64), histAt: 0
};
const card = { cmd: null, timer: 0, hideTimer: 0, committed: false, undoOp: null };

const el = {};

// ---------- helpers ----------

const tFor = lang => translator(lang || state.lang);
const langFor = intent => (state.settings.voiceLang === 'auto' ? intent.lang : state.settings.voiceLang) || state.lang;

function parseCtx() {
  const w = state.active;
  const ex = w?.exercises[w.current];
  const li = ex ? lastDoneIndex(ex) : -1;
  const pi = ex ? firstPlannedIndex(ex) : -1;
  return {
    lang: state.settings.voiceLang, unit: state.settings.unit, catalog: state.catalog, usage: state.usage,
    routines: state.routines, workoutExerciseIds: w ? w.exercises.map(e => e.exerciseId) : [],
    current: ex ? { exerciseId: ex.exerciseId, lastSet: li >= 0 ? ex.sets[li] : null, planned: pi >= 0 ? ex.sets[pi] : null } : null,
    restRunning: !!(w && restRemaining(w.rest) > 0)
  };
}

const snapshot = () => ({
  nameLang: state.lang, active: state.active, history: state.history, prs: state.prs, routines: state.routines,
  undoCount: state.undo.length, settings: state.settings, catalog: state.catalog, now: Date.now()
});

function speak(text, lang) {
  if (!text || state.settings.spoken === 'off') return;
  tts.speak(text, {
    key: getKey('google'), model: ttsModelId(state.settings), voice: state.settings.voice, lang,
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
    <form class="typebox solid" id="vtype" autocomplete="off">
      <input id="vinput" enterkeyhint="send" autocapitalize="off" autocorrect="on" spellcheck="false">
      <button class="send" type="submit">${I.fwd}</button>
    </form>
    <div class="hints" id="vhints"></div>
    <button class="hold" id="vhold"><span class="glow"></span>${micIcon}<span id="vholdtxt"></span></button>
    <p class="holdnote" id="vnote"></p>`;
  Object.assign(el, {
    layer, status: $('#vstatus span'), lang: $('#vlang'), stage: $('#vstage'), halo: $('#vhalo'), ripples: $('#vripples'),
    orbwrap: $('#vorbwrap'), orb: $('#vorb'), wave: $('#vwave'), bars: [...$('#vwave').children], say: $('#vsay'),
    type: $('#vtype'), input: $('#vinput'), hints: $('#vhints'), hold: $('#vhold'), holdtxt: $('#vholdtxt'), note: $('#vnote'),
    card: $('#intent'), dockOrb: null
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
  v.phase = phase;
  el.layer.dataset.phase = phase;
  const t = state.t;
  const status = { idle: 'voice.ready', opening: 'voice.opening', listening: 'voice.listening', thinking: 'voice.thinking', result: 'voice.ready', error: 'voice.ready' }[phase];
  el.status.textContent = t(status);
  const rec = phase === 'listening' || phase === 'opening';
  el.holdtxt.textContent = t(rec ? (v.toggle ? 'voice.tapSend' : 'voice.release') : 'voice.hold');
  el.note.textContent = t(rec && v.toggle ? 'voice.tapNote' : 'voice.holdNote');
  el.hold.disabled = phase === 'thinking';
  el.layer.dataset.toggle = v.toggle ? '1' : '';
}

function flyOrb(open) {
  const from = document.querySelector('#dock .orbbtn .orb');
  if (!from || reduced()) return;
  const a = from.getBoundingClientRect();
  const b = el.orbwrap.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const dx = a.left + a.width / 2 - (b.left + b.width / 2);
  // on close the dock is still 30px low (it slides back up while the orb flies home)
  const dy = a.top + a.height / 2 - (b.top + b.height / 2) - (open ? 0 : 30);
  const s = a.width / b.width;
  const far = `translate(${dx}px, ${dy}px) scale(${s})`;
  const w = el.orbwrap;
  if (open) {
    w.style.transition = 'none';
    w.style.transform = far;
    void w.offsetWidth;
    w.style.transition = '';
    w.style.transform = '';
  } else {
    w.style.transform = far;
  }
}

export function openVoice() {
  hideToast();
  if (v.open) return;
  v.open = true;
  v.typing = false;
  el.layer.classList.remove('typing');
  paintStatic();
  el.say.innerHTML = '';
  setPhase('idle');
  document.getElementById('app').classList.add('voice', 'orbaway');
  el.layer.hidden = false;
  el.layer.inert = false;
  el.orbwrap.style.transform = '';
  void el.layer.offsetWidth;
  el.layer.classList.add('on');
  flyOrb(true);
  // own history entry so Android back closes the layer; wait for a previous close to settle first
  const push = () => { if (v.open && !history.state?.voice) history.pushState({ ...(history.state || {}), voice: 1 }, ''); };
  if (v.closing) v.closing.then(push); else push();
  startLoop();
}

// Close; resolves once history has settled so callers can navigate safely.
export function closeVoice({ fromPop = false } = {}) {
  if (!v.open) return v.closing || Promise.resolve();
  v.open = false;
  v.token++;
  v.press = null;
  v.toggle = false;
  mic.cancel();
  el.input.blur();
  el.layer.classList.remove('on');
  el.layer.inert = true;
  flyOrb(false);
  document.getElementById('app').classList.remove('voice');
  el.layer.classList.remove('carded');
  setTimeout(() => { if (!v.open) document.getElementById('app').classList.remove('orbaway'); }, reduced() ? 0 : 520);
  setTimeout(() => { if (!v.open) { el.layer.hidden = true; stopLoop(); el.orbwrap.style.transform = ''; } }, 600);
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

function startLoop() {
  if (v.raf) return;
  const tick = now => {
    v.raf = requestAnimationFrame(tick);
    const listening = v.phase === 'listening';
    const target = listening ? mic.level() : 0;
    v.lvl += (target - v.lvl) * (target > v.lvl ? 0.45 : 0.12);
    v.hist[v.histAt = (v.histAt + 1) % v.hist.length] = v.lvl;
    if (reduced()) return;
    const l = v.lvl;
    el.orb.style.transform = `scale(${1 + l * 0.12})`;
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
  v.raf = requestAnimationFrame(tick);
}

function stopLoop() { cancelAnimationFrame(v.raf); v.raf = 0; }

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
  try {
    await mic.start({ onMaxed: () => finishRec() });
  } catch (e) {
    if (token !== v.token) return;
    v.toggle = false;
    if (e.code === 'denied') return showError('voice.micDenied', 'voice.micDeniedSub', { type: true });
    if (e.code === 'nomic') return showError('voice.noMic', 'voice.micDeniedSub', { type: true });
    return showError('voice.sttFailed', 'voice.sttFailedSub', { type: true });
  }
  if (token !== v.token || !v.open) { mic.cancel(); return; }
  haptic('tap');
  setPhase('listening');
  if (v.pendingStop) { v.pendingStop = false; finishRec(); }
}

async function finishRec() {
  if (v.phase === 'opening') { v.pendingStop = true; return; }
  if (!mic.isRecording()) return;
  const token = v.token;
  v.toggle = false;
  setPhase('thinking');
  const r = await mic.stop();
  if (!r || token !== v.token) return;
  if (r.ms < 450 || r.peak < 0.04) return showError('voice.tooShort', 'voice.tooShortSub');
  const ex = state.active?.exercises[state.active.current];
  const recent = [...new Set([...(state.active?.exercises || []).map(e => e.exerciseId), ...Object.keys(state.usage).sort((a, b) => state.usage[b] - state.usage[a])])];
  let text;
  try {
    text = await transcribe(r.blob, {
      key: getKey('groq'), model: sttModelId(state.settings), language: state.settings.voiceLang,
      prompt: buildPrompt({ current: ex?.exerciseId, recent, catalog: state.catalog })
    });
  } catch (e) {
    if (token !== v.token) return;
    const map = { offline: ['voice.offline', 'voice.offlineSub'], badkey: ['voice.badKey', 'voice.badKeySub'], busy: ['voice.busy', 'voice.busySub'], nokey: ['voice.noKey', 'voice.noKeySub'] };
    const [a, b] = map[e.code] || ['voice.sttFailed', 'voice.sttFailedSub'];
    return showError(a, b, { retry: true, type: true, settings: e.code === 'badkey' || e.code === 'nokey' });
  }
  if (token !== v.token) return;
  if (!text) return showError('voice.tooShort', 'voice.tooShortSub', { retry: true });
  handleText(text);
}

function cancelRec() {
  v.token++;
  v.toggle = false;
  v.pendingStop = false;
  mic.cancel();
  if (v.open) setPhase('idle');
}

// ---------- text → intent → card ----------

function showWords(text) {
  const words = text.split(/\s+/).filter(Boolean);
  el.say.innerHTML = words.map((w, i) => `<span class="w" style="animation-delay:${Math.min(i, 14) * 38}ms">${esc(w)}</span>`).join(' ');
}

export function handleText(text, { typed = false } = {}) {
  text = String(text || '').trim();
  if (!text) return;
  if (card.cmd && !card.committed && card.cmd.kind === 'auto') commitNow(); // a new command lands the previous one
  if (v.open) showWords(text);
  const intent = parse(text, parseCtx());
  present(intent, { typed });
}

function present(intent, { typed = false } = {}) {
  const lang = langFor(intent);
  const cmd = resolve(intent, snapshot(), tFor(lang), lang);
  cmd.lang = lang;
  cmd.typed = typed;
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
  haptic('error');
  showCard({ kind: 'error', icon: 'alert', title: t(titleKey), sub: subKey ? t(subKey) : '', retry: !!opts.retry, settings: !!opts.settings, type: !!opts.type, local: true });
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
    if (cmd.retry && getKey('groq')) list.push(btn('retry', t('voice.retry')));
    if (cmd.settings) list.push(btn('settings', t('voice.openSettings')));
    if (cmd.type || (cmd.retry && !cmd.local)) list.push(btn('edit', cmd.local ? t('voice.type') : t('voice.edit')));
    actions = list.length ? `<span class="pair">${list.slice(0, 2).join('')}</span>` : btn('close', '×', 'x');
  } else actions = btn('close', '×', 'x');
  const chips = cmd.kind === 'ask' && cmd.choices?.length
    ? `<div class="cchips">${cmd.choices.map((ch, i) => `<button class="chip" data-c="choice" data-i="${i}">${esc(ch.label)}</button>`).join('')}</div>` : '';
  const value = cmd.value ? ` <span class="v">${esc(cmd.value)}</span>` : '';
  const html = `<div class="ic ${cmd.icon || 'check'}">${ICON[cmd.icon] || I.check}</div>
    <div class="ctext"><b>${esc(cmd.title)}${value}</b>${cmd.sub ? `<small>${esc(cmd.sub)}</small>` : ''}</div>
    ${actions}${chips}<span class="bar"></span>`;
  const shown = c.classList.contains('show');
  el.layer.classList.toggle('carded', v.open);
  c.dataset.kind = cmd.kind;
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
    return true;
  }
  if (run.op === 'start') {
    store.startWorkout(run.template);
    card.undoOp = { op: 'discardStart', id: state.active?.id };
    nav.go('workout');
    if (run.then) setTimeout(() => present({ ...run.then }), 350);
    return true;
  }
  if (run.op === 'undo') { store.undo(); return true; }
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
  if (!card.committed) {
    clearTimeout(card.timer);
    card.committed = true;
    el.card.classList.remove('counting');
    dismissCard({ keepPending: false });
    return;
  }
  const u = card.undoOp;
  if (u?.op === 'undo') store.undo();
  else if (u?.op === 'discardStart' && state.active?.id === u.id) { store.discard(); nav.go('today'); }
  dismissCard({ keepPending: false });
}

// ---------- wiring ----------

function onCardClick(e) {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  const k = b.dataset.c;
  const cmd = card.cmd;
  if (k === 'undo') return undoCard();
  if (k === 'close') return dismissCard();
  if (k === 'cancel') { haptic('tap'); return dismissCard({ keepPending: false }); }
  if (k === 'confirm') { b.disabled = true; card.committed = false; return commitConfirmed(cmd); }
  if (k === 'choice') {
    const ch = cmd?.choices?.[Number(b.dataset.i)];
    if (!ch) return;
    haptic('tap');
    dismissCard({ keepPending: false });
    return present({ ...ch.intent, heard: cmd.intent?.heard || '', lang: cmd.lang });
  }
  if (k === 'retry') { dismissCard({ keepPending: false }); if (!v.open) openVoice(); v.toggle = true; return startRec(); }
  if (k === 'edit') {
    const heard = cmd?.intent?.heard || '';
    dismissCard({ keepPending: false });
    if (!v.open) openVoice();
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
    if (b.dataset.v === 'type') return startTyping();
    if (b.dataset.v === 'hint') { haptic('tap'); cancelRec(); handleText(b.textContent, { typed: true }); }
  });
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
    haptic('tap');
    openVoice();
    if (state.settings.micMode === 'tap') { v.toggle = true; v.press = null; startRec(); return; }
    v.press = { t: performance.now(), orb: true };
    startRec();
  });
  const orbUp = e => {
    if (!e.target.closest?.('.orbbtn') || !v.press?.orb) return;
    const dt = performance.now() - v.press.t;
    v.press = null;
    if (dt >= HOLD_MS) finishRec();
    else cancelRec(); // a tap just opens the voice screen
  };
  document.getElementById('dock').addEventListener('pointerup', orbUp);
  document.getElementById('dock').addEventListener('pointercancel', () => { if (v.press?.orb) { v.press = null; cancelRec(); } });
  document.getElementById('dock').addEventListener('contextmenu', e => { if (e.target.closest('.orbbtn')) e.preventDefault(); });

  tts.onSpeaking(on => document.getElementById('app').classList.toggle('speaking', on));
  store.subscribe(reason => { if (reason === 'settings' && v.open) paintStatic(); });
}

export const orbHTML = () => `<button class="orbbtn" aria-label="${esc(state.t('voice.talk'))}"><span class="orb"><i class="core"><b></b><b></b><b></b></i></span></button>`;
export const isVoiceOpen = () => v.open;
