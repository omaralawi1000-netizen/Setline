// Coach tab: chat thread, composer, streamed answers, spoken when complete.
import * as store from '../store.js';
import { state } from '../store.js';
import { streamChat, listModelsText, AiError, withFallback } from '../ai.js';
import { buildContext, chatContents, systemPrompt, formatAnswer, speakable } from '../coach.js';
import { getKey } from '../keys.js';
import { coachModels, ttsModelId } from '../settings.js';
import * as tts from '../tts.js';
import { isRecording } from '../voice.js';
import { haptic } from '../haptics.js';
import { $, esc } from './dom.js';
import { I } from './icons.js';
import { openSheet, closeTop } from './sheet.js';

let nav = { openSettings: () => {} };
let inflight = null; // {ctl, id}

const errorText = (code, t) => ({
  offline: t('coach.offline'), network: t('coach.offline'), badkey: t('coach.badKey'), busy: t('coach.busy'), nomodel: t('coach.noModel'), nokey: t('coach.noKey')
}[code] || t('coach.failed', { code }));

function bubble(m) {
  const { t } = state;
  if (m.role === 'user') return `<li class="msg me" data-id="${m.id}"><div class="bub">${esc(m.text)}</div></li>`;
  if (m.error) {
    return `<li class="msg ai err" data-id="${m.id}"><div class="bub"><p>${esc(errorText(m.error, t))}</p>
      ${m.error === 'badkey' || m.error === 'nokey' || m.error === 'nomodel' ? `<button class="chip" data-coach="settings">${t('voice.openSettings')}</button>` : `<button class="chip" data-coach="retry" data-q="${esc(m.q || '')}">${t('coach.retry')}</button>`}</div></li>`;
  }
  return `<li class="msg ai${m.streaming ? ' live' : ''}" data-id="${m.id}"><div class="bub">${m.text ? formatAnswer(m.text) : '<span class="dots"><i></i><i></i><i></i></span>'}</div></li>`;
}

export function renderCoach(root) {
  const { t } = state;
  const key = getKey('google');
  const chat = state.chat;
  let body;
  if (!key && !chat.length) {
    body = `<div class="empty solid"><div class="emptyglyph">${I.chat}</div><h2>${t('coach.noKey')}</h2><p>${t('coach.noKeySub')}</p>
      <button class="log" data-coach="settings"><span>${t('voice.openSettings')}</span></button></div>`;
  } else if (!chat.length) {
    body = `<div class="coachhero glass"><span class="orb" aria-hidden="true"><i class="core"><b></b><b></b><b></b></i></span>
      <h2>${t('coach.empty')}</h2><p>${t('coach.emptySub')}</p>
      <div class="exq">${['coach.ex1', 'coach.ex2', 'coach.ex3'].map(k => `<button class="chip" data-coach="ask" data-q="${esc(t(k))}">${esc(t(k))}</button>`).join('')}</div></div>`;
  } else {
    body = `<ol class="thread" id="thread">${chat.map(bubble).join('')}</ol>`;
  }
  root.innerHTML = `<div class="tabtop"></div>
    <header class="coachhead"><div><h1 class="h1">${t('coach.title')}</h1><p class="sub">${t('coach.sub')}</p></div>
      ${chat.length ? `<button class="iconbtn" data-coach="clear" aria-label="${t('coach.clear')}">${I.trash}</button>` : ''}</header>
    ${body}`;
  const composer = $('#composer');
  composer.querySelector('input').placeholder = t('coach.ph');
  composer.querySelector('button').setAttribute('aria-label', t('coach.send'));
  composer.querySelector('button').innerHTML = inflight ? I.stop : I.fwd;
  requestAnimationFrame(() => scrollDown(root, false));
}

function scrollDown(root, smooth = true) {
  root.scrollTo({ top: root.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

// Pick coach/command models once, from the key's model list.
export async function ensureModels() {
  const s = state.settings;
  if (s.coachOverride || (s.coachModel && s.coachAlt)) return;
  try {
    const r = await listModelsText(getKey('google'));
    if (r) store.setSettings(r);
  } catch { /* fall back to defaults */ }
}

// Ask the coach. Used by the composer, the example chips, and voice questions.
export async function ask(question, { root = $('#s-coach') } = {}) {
  question = String(question || '').trim();
  if (!question) return;
  inflight?.ctl.abort();
  const lang = /[æøå]|\b(hvad|hvordan|jeg|min|mit|skal|træning)\b/i.test(question) ? 'da' : state.lang;
  const history = state.chat.filter(m => !m.error);
  store.addChat('user', question);
  const reply = store.addChat('model', '', { streaming: true, q: question });
  const key = getKey('google');
  if (!key) { store.updateChat(reply.id, { streaming: false, error: 'nokey' }, { persist: true }); return; }
  const ctl = new AbortController();
  inflight = { ctl, id: reply.id };
  syncButton();
  await ensureModels();
  const context = buildContext({
    active: state.active, history: state.history, routines: state.routines, prs: state.prs, bodyweight: state.bodyweight,
    catalog: state.catalog, settings: state.settings
  });
  try {
    let last = 0;
    const text = await withFallback(coachModels(state.settings), model => streamChat({
      key, model, system: systemPrompt(lang), contents: chatContents(history, context, question), signal: ctl.signal,
      onText: full => {
        store.updateChat(reply.id, { text: full }, { quiet: true });
        const li = root.querySelector(`[data-id="${reply.id}"] .bub`);
        if (li) li.innerHTML = formatAnswer(full);
        const now = performance.now();
        if (now - last > 120) { last = now; scrollDown(root); }
      }
    }));
    store.updateChat(reply.id, { text, streaming: false }, { persist: true });
    haptic('tap');
    if (text && state.settings.spoken !== 'off') {
      tts.speak(speakable(text), { key, model: ttsModelId(state.settings), voice: state.settings.voice, lang, canSpeak: () => !isRecording() });
    }
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'failed';
    if (code === 'aborted') store.updateChat(reply.id, { streaming: false }, { persist: true });
    else store.updateChat(reply.id, { streaming: false, error: code === 'failed' && e.status ? String(e.status) : code }, { persist: true });
  } finally {
    if (inflight?.id === reply.id) inflight = null;
    syncButton();
  }
}

function syncButton() {
  const b = $('#composer button');
  if (b) { b.innerHTML = inflight ? I.stop : I.fwd; b.classList.toggle('stop', !!inflight); }
}

export function initCoach(n) {
  nav = n;
  const root = $('#s-coach');
  const composer = $('#composer');
  composer.innerHTML = `<input enterkeyhint="send" autocomplete="off" maxlength="600"><button type="submit">${I.fwd}</button>`;
  composer.addEventListener('submit', e => {
    e.preventDefault();
    if (inflight) { inflight.ctl.abort(); return; }
    const input = composer.querySelector('input');
    const q = input.value;
    input.value = '';
    haptic('tap');
    ask(q, { root });
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-coach]');
    if (!b) return;
    const k = b.dataset.coach;
    if (k === 'ask' || k === 'retry') { haptic('tap'); ask(b.dataset.q, { root }); }
    else if (k === 'settings') nav.openSettings();
    else if (k === 'clear') {
      const { t } = state;
      openSheet(el => {
        el.insertAdjacentHTML('beforeend', `<h2>${t('coach.clearTitle')}</h2><p class="lead">${t('coach.clearBody')}</p>
          <div class="acts"><button class="btn2 solid danger" data-k="yes">${I.trash}<span>${t('coach.clear')}</span></button><button class="btn2 solid" data-k="no">${t('common.cancel')}</button></div>`);
        el.querySelector('[data-k=no]').onclick = () => closeTop();
        el.querySelector('[data-k=yes]').onclick = async () => { inflight?.ctl.abort(); await closeTop(); await store.clearChat(); };
      });
    }
  });
}
