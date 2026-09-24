// Hands-free workout: the mic listens while you train, only speech is sent to speech-to-text,
// and only workout commands (or anything after "Coach") are acted on. Rest cues are spoken:
// "ten seconds", then what's next. Off whenever the workout ends or the app is hidden.
import { state, subscribe } from '../store.js';
import * as W from '../workout.js';
import { audioContext, unlockAudio } from '../audio.js';
import { createVad, toWav } from '../vad.js';
import { transcribe, buildPrompt } from '../stt.js';
import { sttModelId } from '../settings.js';
import { getKey } from '../keys.js';
import { weight } from '../format.js';
import * as tts from '../tts.js';
import * as mic from '../voice.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { toast } from './toast.js';
import { handleAmbient, speakCue } from './voice.js';

const hf = { want: false, on: false, stream: null, src: null, node: null, sink: null, vad: null, busy: 0, quietUntil: 0, status: 'off', heard: '', cue: { ten: 0, go: 0 }, timer: 0, lvlAt: 0 };
let worklet = null;

export const handsFreeOn = () => hf.want;
export const hfStatus = () => ({ on: hf.want, live: hf.on, status: hf.status, heard: hf.heard, level: hf.vad?.level ?? 0, floor: hf.vad?.floor ?? 0, calibrating: hf.vad?.calibrating ?? null, rate: hf.rate });

export async function toggleHandsFree() {
  if (hf.want) return stopHandsFree({ user: true });
  if (!getKey('groq')) { toast({ title: esc(state.t('voice.noKey')), sub: esc(state.t('voice.noKeySub')), error: true }); return; }
  hf.want = true;
  unlockAudio();
  await open();
  if (hf.on) { haptic('success'); speakCue(state.t('hf.onSay')); }
}

async function open() {
  if (hf.on || !hf.want || document.visibilityState === 'hidden') return;
  const ac = audioContext();
  if (!ac?.audioWorklet || !navigator.mediaDevices?.getUserMedia) { hf.want = false; toast({ title: esc(state.t('hf.unsupported')), error: true }); return paint(); }
  try {
    hf.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    worklet ||= ac.audioWorklet.addModule('js/tap-worklet.js');
    await worklet;
  } catch (e) {
    worklet = null;
    hf.stream?.getTracks().forEach(t => t.stop());
    hf.stream = null; hf.want = false;
    toast({ title: esc(state.t(e?.name === 'NotAllowedError' ? 'voice.micDenied' : 'hf.failed')), error: true });
    return paint();
  }
  if (!hf.want) { hf.stream.getTracks().forEach(t => t.stop()); hf.stream = null; return; }
  if (ac.state !== 'running') ac.resume().catch(() => {});
  hf.src = ac.createMediaStreamSource(hf.stream);
  hf.node = new AudioWorkletNode(ac, 'setline-tap');
  hf.sink = ac.createGain();
  hf.sink.gain.value = 0; // the worklet has to be pulled to run; nothing is heard
  hf.src.connect(hf.node).connect(hf.sink).connect(ac.destination);
  hf.rate = ac.sampleRate;
  hf.vad = createVad({ rate: hf.rate });
  hf.node.port.onmessage = e => onSamples(e.data);
  hf.on = true;
  hf.timer = setInterval(cues, 250);
  setStatus('listening');
}

function close() {
  clearInterval(hf.timer);
  try { hf.src?.disconnect(); hf.node?.disconnect(); hf.sink?.disconnect(); } catch {}
  if (hf.node) hf.node.port.onmessage = null;
  hf.stream?.getTracks().forEach(t => t.stop());
  Object.assign(hf, { on: false, stream: null, src: null, node: null, sink: null, vad: null });
}

export function stopHandsFree({ user = false } = {}) {
  if (!hf.want && !hf.on) return;
  hf.want = false;
  close();
  setStatus('off');
  if (user) haptic('tap');
}

function onSamples(buf) {
  if (!hf.on) return;
  const now = performance.now();
  // never listen to ourselves, or while the orb is recording
  if (tts.isSpeaking() || mic.isRecording()) { hf.quietUntil = now + 600; hf.vad.reset(); return; }
  if (now < hf.quietUntil) { hf.vad.reset(); return; }
  const utts = hf.vad.push(buf);
  if (now - hf.lvlAt > 60) { hf.lvlAt = now; level(Math.min(1, Math.pow(hf.vad.level * 7, 0.7))); }
  if (hf.vad.speaking && hf.status !== 'hearing') setStatus('hearing');
  else if (!hf.vad.speaking && hf.status === 'hearing' && !hf.busy) setStatus('listening');
  for (const u of utts) send(u, hf.rate);
}

async function send(samples, rate) {
  hf.busy++;
  setStatus('thinking');
  const ex = state.active?.exercises[state.active.current];
  let text = '';
  try {
    text = await transcribe(new Blob([toWav(samples, rate)], { type: 'audio/wav' }), {
      key: getKey('groq'), model: sttModelId(state.settings), language: state.settings.voiceLang,
      prompt: buildPrompt({ current: ex?.exerciseId, recent: (state.active?.exercises || []).map(e => e.exerciseId), catalog: state.catalog })
    });
  } catch { text = ''; }
  hf.busy--;
  if (!hf.on) return;
  const acted = text && handleAmbient(text);
  hf.heard = acted ? text : '';
  if (acted) haptic('tap');
  setStatus(acted ? 'heard' : hf.busy ? 'thinking' : 'listening');
  if (acted) setTimeout(() => { if (hf.status === 'heard') setStatus('listening'); }, 2200);
}

// ---------- rest cues ----------

function cueText() {
  const { t, lang } = state;
  const w = state.active;
  const ex = w?.exercises[w.current];
  if (!ex) return t('hf.go');
  const bw = state.catalog.get(ex.exerciseId)?.equipment === 'bodyweight';
  const v = W.suggestNext(ex, W.lastSession(state.history, ex.exerciseId), bw ? 0 : 20);
  const name = state.catalog.name(ex.exerciseId, lang);
  const kg = weight(v.kg, state.settings.unit, lang);
  const unit = t(`say.${state.settings.unit}`);
  const next = !ex.sets.some(s => s.done);
  return t(next ? 'hf.cueNext' : 'hf.cue', { name, n: W.nextSetNumber(ex), kg, unit, reps: v.reps, bw: bw && !v.kg });
}

function cues() {
  const r = state.active?.rest;
  if (!r || !hf.on) return;
  const left = (r.endsAt - Date.now()) / 1000;
  if (left <= 10.5 && left > 8 && r.duration > 25 && hf.cue.ten !== r.startedAt) { hf.cue.ten = r.startedAt; speakCue(state.t('hf.ten')); }
  if (left <= 0.3 && left > -3 && hf.cue.go !== r.startedAt) { hf.cue.go = r.startedAt; speakCue(cueText()); }
}

// ---------- the pill on the workout screen ----------

export function hfPillHTML() {
  if (!hf.want) return '';
  const { t } = state;
  return `<div class="hfpill" id="hfpill" data-s="${hf.status}"><span class="hfdot"><i></i></span><span class="hft" id="hft">${esc(statusText())}</span><button class="chip" data-act="handsfree">${t('hf.off')}</button></div>`;
}

function statusText() {
  const { t } = state;
  return hf.status === 'heard' && hf.heard ? `“${hf.heard}”` : t(`hf.s.${hf.status}`);
}

function setStatus(s) {
  hf.status = s;
  paint();
}

function paint() {
  const pill = document.getElementById('hfpill');
  const btn = document.querySelector('[data-act=handsfree].iconbtn');
  btn?.setAttribute('aria-pressed', String(hf.want));
  btn?.classList.toggle('is-on', hf.want);
  if (!hf.want) { pill?.classList.add('bye'); setTimeout(() => pill?.remove(), 260); return; }
  if (!pill) { document.querySelector('#s-workout > header.top')?.insertAdjacentHTML('afterend', hfPillHTML()); return; }
  pill.dataset.s = hf.status;
  const tx = pill.querySelector('#hft');
  const txt = statusText();
  if (tx && tx.textContent !== txt) { tx.textContent = txt; tx.classList.remove('swap'); void tx.offsetWidth; tx.classList.add('swap'); }
}

function level(l) {
  document.getElementById('hfpill')?.style.setProperty('--l', l.toFixed(3));
}

// ---------- lifecycle ----------

export function initHandsFree() {
  subscribe(reason => {
    if (!state.active && hf.want) stopHandsFree();
    else if (reason === 'finish' || reason === 'discard') stopHandsFree();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (hf.on) { close(); hf.status = 'paused'; } }
    else if (hf.want) open();
  });
}
