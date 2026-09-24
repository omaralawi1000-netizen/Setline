// "Let's get to know you": the Coach asks, you answer out loud (or type), it reacts and asks the
// next thing it doesn't know yet. Fills the onboarding answers as it goes.
import { state } from '../store.js';
import { INTERVIEW_SCHEMA, interviewSystem, interviewPrompt, firstQuestion, mergeHeard } from '../profile.js';
import { aiPlan, withFallback } from '../ai.js';
import { coachModels, sttModelId, ttsModelId, ttsAlt } from '../settings.js';
import { getKey } from '../keys.js';
import * as tts from '../tts.js';
import * as mic from '../voice.js';
import { unlockAudio } from '../audio.js';
import { haptic } from '../haptics.js';
import { listenSmart } from './listen.js';
import { esc } from './dom.js';
import { I } from './icons.js';

const MAX_TURNS = 14;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a: the onboarding answers (mutated). onChange(heard: Set) after every turn; onDone() when it wraps up.
export function mountInterview(root, a, { onChange = () => {}, onDone = () => {} } = {}) {
  const { t } = state;
  const lang = state.lang;
  const canTalk = !!getKey('groq');
  const c = { msgs: [], phase: 'idle', talking: false, alive: true, listener: null, turns: 0, heard: new Set(), finished: false };
  a.asked = a.asked || {};

  root.innerHTML = `<div class="iv">
      <ol class="ivthread" aria-live="polite"></ol>
      <div class="ivbar">
        ${canTalk ? `<button class="ivorb" data-iv="orb" aria-label="${esc(t('iv.talk'))}"><span class="orb" id="ivorb"><i class="core"><b></b><b></b><b></b></i><i class="spin"></i></span></button>` : ''}
        <span class="ivstatus"></span>
        <form class="ivtype"><input enterkeyhint="send" autocomplete="off" maxlength="400" placeholder="${esc(t('iv.typePh'))}"><button type="submit" aria-label="${esc(t('iv.send'))}">${I.fwd}</button></form>
      </div>
    </div>`;
  const thread = root.querySelector('.ivthread'), status = root.querySelector('.ivstatus'), orb = root.querySelector('#ivorb');
  const input = root.querySelector('.ivtype input');

  const paint = () => {
    thread.innerHTML = c.msgs.map((m, i) => `<li class="ivm ${m.who}${m.seen ? ' seen' : ''}" style="--i:${i}">${esc(m.text)}</li>`).join('') +
      (c.phase === 'thinking' ? '<li class="ivm ai typing"><span class="dots"><i></i><i></i><i></i></span></li>' : '');
    c.msgs.forEach(m => { m.seen = true; });
    thread.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    setStatus();
  };
  const setStatus = (k = c.phase) => {
    root.querySelector('.iv').dataset.phase = k;
    status.textContent = {
      idle: canTalk ? (c.msgs.length > 1 ? t('iv.tapAgain') : t('iv.tapStart')) : '',
      speaking: t('iv.speaking'), listening: t('iv.listening'), check: t('iv.listening'), wait: t('voice.takeTime'),
      hearing: t('ob.tell.hearing'), thinking: '', done: t('iv.done')
    }[k] ?? '';
  };

  async function say(text) {
    c.msgs.push({ who: 'ai', text });
    c.phase = 'speaking'; paint();
    if (state.settings.spoken !== 'off' && c.talking) {
      await tts.speak(text, { key: getKey('google'), model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang, canSpeak: () => c.alive && !mic.isRecording() });
      for (let n = 0; c.alive && tts.isSpeaking() && n < 400; n++) await sleep(100);
    }
    if (!c.alive) return;
    c.phase = c.finished ? 'done' : 'idle'; paint();
    if (c.talking && !c.finished) listen();
  }

  async function listen() {
    if (!c.alive || c.listener || c.phase === 'thinking') return;
    tts.stop();
    c.phase = 'listening'; setStatus();
    haptic('tap');
    const l = c.listener = listenSmart({
      stt: { key: getKey('groq'), model: sttModelId(state.settings), language: state.settings.voiceLang },
      onLevel: v => { if (orb) orb.style.transform = `scale(${(1 + v * 0.22).toFixed(3)})`; },
      onState: k => { if (c.listener === l) { c.phase = k === 'check' ? 'listening' : k; setStatus(k); } }
    });
    let text = '';
    try { text = await l.done; } catch (e) { if (e?.code === 'denied' || e?.code === 'nomic') { c.talking = false; status.textContent = t('voice.micDenied'); } }
    if (c.listener === l) c.listener = null;
    if (!c.alive) return;
    if (!text.trim()) { c.phase = 'idle'; return setStatus(); }
    answer(text);
  }

  async function answer(text) {
    c.msgs.push({ who: 'me', text: text.trim() });
    c.phase = 'thinking'; paint();
    c.turns++;
    let raw;
    try {
      raw = await withFallback(coachModels(state.settings), model => aiPlan({ key: getKey('google'), model, system: interviewSystem(lang), prompt: interviewPrompt(a, c.msgs), schema: INTERVIEW_SCHEMA }));
    } catch {
      if (!c.alive) return;
      c.phase = 'idle'; paint();
      status.textContent = t('ob.tell.failed');
      return;
    }
    if (!c.alive) return;
    for (const k of mergeHeard(a, raw)) c.heard.add(k);
    for (const k of raw?.answered || []) a.asked[k] = true;
    haptic('tap');
    onChange(c.heard);
    c.finished = !!raw?.done || c.turns >= MAX_TURNS;
    const reply = String(raw?.reply || '').trim() || t('iv.fallbackDone');
    if (c.finished) onDone();
    await say(reply);
  }

  root.addEventListener('click', e => {
    if (!e.target.closest('[data-iv=orb]')) return;
    unlockAudio();
    if (c.listener) { haptic('tap'); return c.listener.stop(); }
    if (c.phase === 'speaking') { tts.stop(); }
    if (c.phase === 'thinking' || c.finished) return;
    c.talking = true;
    // the first tap also reads the opening question aloud, then listens
    if (c.msgs.length === 1 && !c.spokeFirst) { c.spokeFirst = true; c.msgs.pop(); return say(firstQuestion(lang)); }
    listen();
  });
  root.querySelector('.ivtype').addEventListener('submit', e => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v || c.phase === 'thinking' || c.finished) return;
    input.value = '';
    c.listener?.cancel();
    tts.stop();
    answer(v);
  });

  c.msgs.push({ who: 'ai', text: firstQuestion(lang) });
  paint();

  return {
    destroy() { c.alive = false; c.listener?.cancel(); tts.stop(); },
    pause() { c.talking = false; c.listener?.cancel(); tts.stop(); if (c.phase !== 'thinking') { c.phase = c.finished ? 'done' : 'idle'; setStatus(); } },
    get heard() { return c.heard; }
  };
}
