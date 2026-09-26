// Coach tab: chat thread, composer, streamed answers, spoken when complete.
import * as store from '../store.js';
import { state } from '../store.js';
import { streamChat, AiError, withFallback, aiPlan, pickTextModels, nextQuotaReset } from '../ai.js';
import { listModels, pickTtsModel } from '../tts.js';
import { splitMemories, hideMemoryTail as hideMem, addMemories } from '../coach.js';
import { splitChanges, hideChangeTail, applyChanges } from '../planedit.js';
// the reply without its hidden lines (memories and plan changes), also while it streams in
const hideMemoryTail = text => hideChangeTail(hideMem(text));
import { weekStart } from '../stats.js';
import { dateKey } from '../body.js';
import { weight } from '../format.js';
import { buildContext, chatContents, systemPrompt, formatAnswer, speakable, isPlanRequest, PLAN_SCHEMA, planSchema, planSystem, validatePlan, planToRoutines, isRoutineImport, IMPORT_SCHEMA, importSystem, validateImport, isNoise } from '../coach.js';
import { getKey } from '../keys.js';
import { coachModels, ttsModelId, ttsAlt, sttModelId } from '../settings.js';
import * as tts from '../tts.js';
import { isRecording } from '../voice.js';
import { haptic } from '../haptics.js';
import { $, esc } from './dom.js';
import { listenSmart } from './listen.js';
import { unlockAudio } from '../audio.js';
import { actOnText } from './voice.js';
import { I } from './icons.js';
import { openSheet, closeTop } from './sheet.js';
import { toast } from './toast.js';

let nav = { openSettings: () => {} };
let inflight = null; // {ctl, id}
const shown = new Set(); // chat message ids already rendered

const errorText = (code, t) => ({
  offline: t('coach.offline'), network: t('coach.offline'), badkey: t('coach.badKey'), busy: t('coach.busy'), quota: t('coach.quota', { time: new Date(nextQuotaReset()).toLocaleTimeString(state.lang === 'da' ? 'da-DK' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) }), empty: t('coach.noAnswer'), timeout: t('coach.timeout'), nomodel: t('coach.noModel'), nokey: t('coach.noKey')
}[code] || t('coach.failed', { code }));

// Thinking: the orb breathes, a glow runs round the bubble and the steps say what it's looking at.
function thinkingHTML(m) {
  const { t } = state;
  const steps = [t('coach.step1'), t('coach.step2'), t('coach.step3'), t('coach.step4')];
  return `<span class="think"><span class="orb"><i class="core"><b></b><b></b><b></b></i></span><span class="tsteps">${steps.map((x, i) => `<span class="tl" style="--i:${i}">${esc(x)}</span>`).join('')}</span></span>`;
}

function bubble(m) {
  const { t } = state;
  if (m.role === 'user') return `<li class="msg me" data-id="${m.id}"><div class="bub">${esc(m.text)}</div></li>`;
  if (m.error) {
    return `<li class="msg ai is-err" data-id="${m.id}"><div class="bub"><p>${esc(errorText(m.error, t))}</p>
      ${m.error === 'badkey' || m.error === 'nokey' || m.error === 'nomodel' ? `<button class="chip" data-coach="settings">${t('voice.openSettings')}</button>` : `<button class="chip" data-coach="retry" data-q="${esc(m.q || '')}">${t('coach.retry')}</button>`}</div></li>`;
  }
  if (m.plan) return `<li class="msg ai plan" data-id="${m.id}"><div class="bub">${planCard(m)}</div></li>`;
  if (!m.text && !m.streaming) return `<li class="msg ai stopped" data-id="${m.id}"><div class="bub"><p>${esc(t('coach.stopped'))}</p>${m.q ? `<button class="chip" data-coach="retry" data-q="${esc(m.q)}">${t('coach.retry')}</button>` : ''}</div></li>`;
  const dhead = m.debrief ? `<p class="wkhead">${I.workout}<span>${esc(t('debrief.head', { name: m.dname || t('debrief.session') }))}</span></p>` : '';
  const head = m.weekly ? `<p class="wkhead">${I.chart}<span>${esc(t('weekly.head', { date: new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(m.weekly + 'T12:00')) }))}</span></p>` : '';
  const kept = m.remembered?.length ? `<p class="memnote">${I.check}<span>${esc(t('memory.kept', { what: m.remembered.join(' · ') }))}</span></p>` : '';
  // what the Coach changed in the plan, with Undo
  const changed = m.changed?.length ? `<div class="chgnote${m.undone ? ' undone' : ''}"><span class="chgic">${I.check}</span><span class="chgtxt">${m.changed.map(c => `<b>${esc(c)}</b>`).join('')}</span>${m.undone ? `<span class="chgu">${esc(t('change.undone'))}</span>` : undoable.has(m.id) ? `<button class="chip sm" data-coach="undo-change" data-id="${esc(m.id)}">${t('common.undo')}</button>` : ''}</div>` : '';
  return `<li class="msg ai${m.streaming ? ' is-streaming' : ''}${m.streaming && !m.text ? ' is-thinking' : ''}${m.weekly || m.debrief ? ' weekly' : ''}" data-id="${m.id}"><div class="bub">${head}${dhead}${m.text ? formatAnswer(hideMemoryTail(m.text)) : thinkingHTML(m)}${kept}${changed}</div></li>`;
}

function planCard(m) {
  const { t, lang } = state;
  const p = m.plan;
  return `<div class="pcard"><div class="phead"><strong>${esc(p.name)}</strong><span class="tag sm soft">${t('plan.days', { n: p.days.length })}</span></div>
    ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
    ${p.days.map(d => `<div class="pday"><b>${esc(d.name)}</b><ul>${d.exercises.map(e => `<li><span>${esc(p.customs?.find(c => c.id === e.exerciseId)?.en || state.catalog.name(e.exerciseId, lang))}</span><span class="psr">${e.sets} × ${e.repsGuessed ? '?' : e.reps}${e.kg ? ` · ${weight(e.kg, state.settings.unit, lang)} ${t('unit.' + state.settings.unit)}` : ''}</span></li>`).join('')}</ul></div>`).join('')}
    ${m.saved ? `<p class="psaved">${I.check}${t(m.saved === 'replace' ? 'plan.replaced' : 'plan.saved')}</p>`
      : `<div class="pacts"><button class="log" data-coach="saveplan" data-mode="replace" data-id="${m.id}">${I.check}<span>${t('plan.replace')}</span></button>
        <button class="btn2 solid" data-coach="saveplan" data-mode="add" data-id="${m.id}">${I.plus}<span>${t('plan.add')}</span></button></div>`}</div>`;
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
    // messages already on screen don't slide in again when the thread re-renders
    body = `<ol class="thread" id="thread">${chat.map(m => { const h = bubble(m); const seen = shown.has(m.id); shown.add(m.id); return seen ? h.replace('<li class="msg', '<li class="msg seen') : h; }).join('')}</ol>`;
  }
  root.innerHTML = `<div class="tabtop"></div>
    <button class="iconbtn cclose" data-coach="close" aria-label="${t('common.close')}">${I.back.replace('d="M14.5 6 8.5 12l6 6"', 'd="M6 9.5l6 6 6-6"')}</button>
    <header class="coachhead"><div><h1 class="h1">${t('coach.title')}</h1><p class="sub">${t('coach.sub')}</p></div>
      ${chat.length ? `<button class="iconbtn" data-coach="clear" aria-label="${t('coach.clear')}">${I.trash}</button>` : ''}</header>
    ${body}`;
  const composer = $('#composer');
  composer.querySelector('input').placeholder = t('coach.ph');
  composer.querySelector('.csend').setAttribute('aria-label', t('coach.send'));
  composer.querySelector('.csend').innerHTML = inflight ? I.stop : I.fwd;
  requestAnimationFrame(() => (followers.get(root)?.raf ? follow(root) : scrollDown(root, false)));
}

// Streamed words don't appear in lumps: each word blurs in, lit by the accent, and settles.
// The text on screen glides after what has arrived, faster the further behind it is.
const WORD_MS = 650;
function wordsHTML(bub, text, births, now) {
  bub.innerHTML = formatAnswer(hideMemoryTail(text));
  const walker = document.createTreeWalker(bub, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let i = 0;
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of n.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.append(part); continue; }
      births[i] ??= now;
      const age = now - births[i];
      const w = document.createElement('span');
      w.textContent = part;
      if (age < WORD_MS) { w.className = 'w'; w.style.animationDelay = `${-age}ms`; }
      frag.append(w);
      i++;
    }
    n.replaceWith(frag);
  }
}
function typewriter(root, id) {
  let words = [], shown = 0, raf = 0, last = 0, waiters = [];
  const births = [];
  const done = () => (shown >= words.length);
  const step = now => {
    if (!done() && now - last > 66) { // new words every ~4 frames: each word fades in on its own clock, so this stays smooth and the thread isn't rebuilt every frame
      last = now;
      shown = Math.min(words.length, shown + Math.max(2, Math.ceil((words.length - shown) / 6)));
      const bub = root.querySelector(`[data-id="${id}"] .bub`);
      if (bub) {
        bub.closest('.msg')?.classList.remove('is-thinking');
        wordsHTML(bub, words.slice(0, shown).join(''), births, now);
      }
      follow(root);
    }
    if (done()) {
      // let the last words finish settling before anything re-renders the bubble
      raf = 0;
      setTimeout(() => { if (done()) waiters.splice(0).forEach(r => r()); }, WORD_MS);
      return;
    }
    raf = requestAnimationFrame(step);
  };
  return {
    set(t) { words = t.match(/\S+\s*/g) || []; if (!raf) raf = requestAnimationFrame(step); },
    drain: () => (done() && !raf ? new Promise(r => setTimeout(r, WORD_MS)) : Promise.race([new Promise(r => waiters.push(r)), new Promise(r => setTimeout(r, 4000))]))
  };
}

// A reply has landed: one sweep of light passes over it and the box's light lets go.
function landed(root, id) {
  if (stillMotion()) return;
  const composer = $('#composer');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const bub = root.querySelector(`[data-id="${id}"] .bub`);
    if (bub && !bub.querySelector('.sheen')) {
      const sh = document.createElement('span');
      sh.className = 'sheen'; sh.setAttribute('aria-hidden', 'true'); sh.innerHTML = '<i></i>';
      bub.append(sh);
      sh.firstChild.addEventListener('animationend', () => sh.remove(), { once: true });
      setTimeout(() => sh.remove(), 2500);
    }
    composer?.classList.remove('landed'); void composer?.offsetWidth;
    composer?.classList.add('landed');
    clearTimeout(composer?._landed);
    if (composer) composer._landed = setTimeout(() => composer.classList.remove('landed'), 1100);
  }));
}

// While the Coach speaks, the light round the box moves with its voice: faster and brighter on the
// loud parts, calm in the pauses. The level comes from the clip itself (tts.speechLevel).
function voiceLight(composer) {
  let raf = 0, lv = 0;
  const rings = () => [...composer.querySelectorAll('.cglow i, .chalo i')].flatMap(el => el.getAnimations());
  const stop = () => {
    cancelAnimationFrame(raf); raf = 0; lv = 0;
    composer.classList.remove('speaking'); composer.style.removeProperty('--sv');
    for (const a of rings()) a.updatePlaybackRate?.(1);
  };
  const frame = now => {
    const raw = tts.speechLevel();
    const target = raw == null ? 0.35 + 0.25 * Math.abs(Math.sin(now / 190)) : raw; // the phone's voice: a gentle beat
    lv += (target - lv) * (target > lv ? 0.35 : 0.12); // rises quickly, settles slowly
    composer.style.setProperty('--sv', lv.toFixed(3));
    for (const a of rings()) a.updatePlaybackRate?.(1.3 + lv * 2.4);
    raf = requestAnimationFrame(frame);
  };
  tts.onSpeaking(on => {
    if (!on) return stop();
    if (raf || stillMotion() || !document.getElementById('app')?.classList.contains('coaching')) return;
    composer.classList.add('speaking');
    raf = requestAnimationFrame(frame);
  });
}

function scrollDown(root, smooth = true) {
  if (smooth) return follow(root);
  root.scrollTop = root.scrollHeight;
}

// While a reply comes in, the thread glides after it: every frame it closes part of the gap to the
// bottom (one continuous motion, instead of a new smooth-scroll starting every few words). Touching
// or scrolling the thread yourself lets go; it picks up again once you're back near the bottom or ask
// something new.
const followers = new WeakMap();
const stillMotion = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
function follow(root, fresh = false) {
  let f = followers.get(root);
  if (!f) {
    f = { raf: 0, t: 0, held: false };
    const hold = () => { f.held = true; cancelAnimationFrame(f.raf); f.raf = 0; };
    root.addEventListener('touchstart', hold, { passive: true });
    root.addEventListener('wheel', hold, { passive: true });
    followers.set(root, f);
  }
  const gap = () => root.scrollHeight - root.clientHeight - root.scrollTop;
  if (fresh) f.held = false;
  else if (f.held) { if (gap() > 90) return; f.held = false; }
  if (stillMotion()) { root.scrollTop = root.scrollHeight; return; }
  if (f.raf) return;
  f.t = 0;
  const step = now => {
    const dt = f.t ? Math.min(50, now - f.t) : 16;
    f.t = now;
    const g = gap();
    if (g < 1 || f.held) { f.raf = 0; return; }
    const was = root.scrollTop;
    root.scrollTop = was + Math.max(g * (1 - Math.exp(-dt / 150)), Math.min(g, 1));
    if (root.scrollTop === was) root.scrollTop = root.scrollHeight; // the last sub-pixel
    f.raf = requestAnimationFrame(step);
  };
  f.raf = requestAnimationFrame(step);
}

// Pick coach/command models once, from the key's model list.
// Pick coach, command and voice models once from the key's model list (and again after an update adds fields).
let picking = null;
tts.whenModelMissing(() => store.setSettings({ ttsModel: '', ttsLite: '' })); // listed again next time
export function ensureModels() {
  const s = state.settings;
  if (!getKey('google') || ((s.coachOverride || (s.coachModel && s.coachAlt && s.proChecked)) && (s.ttsOverride || s.ttsLite))) return Promise.resolve();
  picking ||= (async () => {
    try {
      const r = await listModels(getKey('google'));
      if (r.status !== 'ok') return;
      const text = pickTextModels(r.models);
      store.setSettings({
        cmdModel: text.command || '', coachModel: text.coach || '', cmdAlt: text.commandAlt || '', coachAlt: text.coachAlt || '', coachPro: text.pro || '', proChecked: true,
        ttsModel: pickTtsModel(r.models, null, 'natural') || '', ttsLite: pickTtsModel(r.models, null, 'fast') || ''
      });
    } catch { /* fall back to defaults */ } finally { picking = null; }
  })();
  return picking;
}

// Everything the Coach gets to see.
export const coachSnap = () => ({
  active: state.active, history: state.history, routines: state.routines, prs: state.prs, bodyweight: state.bodyweight,
  cardio: state.cardio, activeCardio: state.activeCardio, nutrition: state.nutrition, daily: state.daily, measures: state.measures,
  photoCount: state.photos?.length || 0, goals: goalLines(), catalog: state.catalog, settings: state.settings
});
let goalLines = () => [];
export const setGoalLines = fn => { goalLines = fn; };

// The Coach's plan changes: applied to the routines and the day plan at once; the state before is
// kept (for this session) so Undo puts it back.
const undoable = new Map();
async function applyCoachChanges(id, changes) {
  if (!changes?.length) return [];
  const before = { routines: state.routines, dayPlan: state.settings.dayPlan || {} };
  const r = applyChanges(before, changes, { catalog: state.catalog, lang: state.lang, t: state.t });
  if (!r.done.length) return [];
  if (JSON.stringify(r.routines) !== JSON.stringify(before.routines)) await store.replaceRoutines(r.routines);
  store.setSettings({ dayPlan: r.dayPlan });
  undoable.set(id, before);
  return r.done;
}
async function undoChange(id) {
  const before = undoable.get(id);
  if (!before) return;
  undoable.delete(id);
  haptic('tap');
  if (JSON.stringify(before.routines) !== JSON.stringify(state.routines)) await store.replaceRoutines(before.routines);
  store.setSettings({ dayPlan: before.dayPlan });
  store.updateChat(id, { undone: true }, { persist: true });
}

// Ask the coach. Used by the composer, the example chips, and voice questions.
export async function ask(question, { root = $('#s-coach'), voice = false } = {}) {
  question = String(question || '').trim();
  if (!question) return;
  // "I had 2 eggs", "bench 80 for 8", "set my calories to 2400": done straight away (with Undo), not discussed
  const did = actOnText(question);
  if (did) {
    store.addChat('user', question);
    store.addChat('model', state.t(did === 'LogMeal' ? 'coach.didFood' : 'coach.did'), { persist: true });
    return;
  }
  inflight?.ctl.abort();
  const lang = /[æøå]|\b(hvad|hvordan|jeg|min|mit|skal|træning)\b/i.test(question) ? 'da' : state.lang;
  const history = state.chat.filter(m => !m.error);
  store.addChat('user', question);
  const reply = store.addChat('model', '', { streaming: true, q: question });
  requestAnimationFrame(() => follow(root, true)); // a new question: the thread follows again
  const key = getKey('google');
  if (!key) { store.updateChat(reply.id, { streaming: false, error: 'nokey' }, { persist: true }); return; }
  const ctl = new AbortController();
  inflight = { ctl, id: reply.id };
  syncButton();
  await ensureModels();
  // "the plan from my brief", "set up my split": copy the routine you already wrote, don't design a new one
  const brief = state.settings.coachBrief || '';
  const fromBrief = brief && isRoutineImport(brief) && /\b(brief|beskrivelse|my (?:routine|split|program|plan|days)|mine rutiner|mit program|min plan)\b/i.test(question) && !/\b(new|ny|nyt|different|anden|andet)\b/i.test(question);
  if (fromBrief) return buildPlan(`${brief}\n\n(The user asks: ${question})`, reply, { key, lang, ctl, root, copy: true });
  if (isRoutineImport(question)) return buildPlan(question, reply, { key, lang, ctl, root, copy: true });
  if (isPlanRequest(question)) return buildPlan(question, reply, { key, lang, ctl, root });
  const context = buildContext(coachSnap());
  try {
    const typer = typewriter(root, reply.id);
    const slow = 0;
    const text = await withFallback(coachModels(state.settings), model => streamChat({
      key, model, system: systemPrompt(lang), contents: chatContents(history, context, question), signal: ctl.signal,
      onText: full => { clearTimeout(slow); store.updateChat(reply.id, { text: full }, { quiet: true }); typer.set(full); }
    }), { rounds: 3, wait: 2500, alsoRetry: ['timeout'] }).finally(() => clearTimeout(slow)); // busy servers get a patient second and third go
    // the voice starts as soon as the answer is in, while the words are still appearing on screen
    const { text: saidMem, facts: all } = splitMemories(text);
    const { text: saidClean, changes } = splitChanges(saidMem);
    const said = saidClean;
    const talk = said && (voice || state.settings.spoken !== 'off')
      ? tts.speak(speakable(said), { key, model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang, canSpeak: () => !isRecording() })
      : null;
    await typer.drain();
    // "REMEMBER: …" lines become memories and leave the reply
    const before = state.settings.memories || [], mem = addMemories(before, all);
    const facts = mem.slice(before.length).map(m => m.text); // only what's new
    if (facts.length) store.setSettings({ memories: mem });
    // "CHANGE: {…}" lines change the plan (a day, a routine), with Undo
    const changed = await applyCoachChanges(reply.id, changes);
    store.updateChat(reply.id, { text: saidClean, streaming: false, ...(facts.length ? { remembered: facts } : {}), ...(changed.length ? { changed } : {}) }, { persist: true });
    landed(root, reply.id);
    if (changed.length) haptic('success');
    haptic('tap');
    if (talk && voice) await talk;
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'failed';
    if (code === 'aborted') store.updateChat(reply.id, { streaming: false }, { persist: true });
    else store.updateChat(reply.id, { streaming: false, error: code === 'failed' && e.status ? String(e.status) : code }, { persist: true });
  } finally {
    if (inflight?.id === reply.id) inflight = null;
    syncButton();
  }
}

// "make me a 4-day upper/lower, 60 minutes, dumbbells only" → an editable plan card
async function buildPlan(question, reply, { key, lang, ctl, root, copy = false }) {
  const { t } = state;
  const context = buildContext(coachSnap());
  try {
    if (copy) { // your own routine: copied, not designed
      const raw = await withFallback(coachModels(state.settings), model => aiPlan({ key, model, system: importSystem(lang, state.catalog), schema: IMPORT_SCHEMA, signal: ctl.signal, prompt: question }));
      const plan = validateImport(raw, state.catalog);
      if (!plan) store.updateChat(reply.id, { streaming: false, text: t('plan.invalid') }, { persist: true });
      else { store.updateChat(reply.id, { streaming: false, text: plan.summary || plan.name, plan }, { persist: true }); haptic('success'); }
      return;
    }
    const prompt = `Training data:\n${context}\n\nRequest: ${question}`;
    const once = schema => withFallback(coachModels(state.settings), model => aiPlan({ key, model, system: planSystem(lang, state.catalog), schema, signal: ctl.signal, prompt }));
    let plan = null;
    // first with the exercise names locked to the catalog; if the model rejects that schema or the
    // plan comes back unusable, one more try with the plain schema
    try { plan = validatePlan(await once(planSchema(state.catalog)), state.catalog); } catch (e) { if (!(e instanceof AiError) || !['invalid', 'failed', 'empty'].includes(e.code)) throw e; }
    if (!plan) plan = validatePlan(await once(PLAN_SCHEMA), state.catalog);
    if (!plan) store.updateChat(reply.id, { streaming: false, text: t('plan.invalid') }, { persist: true });
    else {
      store.updateChat(reply.id, { streaming: false, text: plan.summary || plan.name, plan }, { persist: true });
      landed(root, reply.id);
      haptic('success');
      if (plan.summary && state.settings.spoken !== 'off') tts.speak(speakable(plan.summary), { key, model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang, canSpeak: () => !isRecording() });
    }
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'failed';
    store.updateChat(reply.id, { streaming: false, ...(code === 'aborted' ? {} : { error: code === 'failed' && e.status ? String(e.status) : code === 'invalid' ? 'failed' : code }) }, { persist: true });
  } finally {
    if (inflight?.id === reply.id) inflight = null;
    syncButton();
    requestAnimationFrame(() => scrollDown(root));
  }
}

async function savePlan(id, mode = 'replace') {
  const { t } = state;
  const m = state.chat.find(x => x.id === id);
  if (!m?.plan || m.saved) return;
  for (const c of m.plan.customs || []) if (!state.catalog.get(c.id)) await store.addCustomExercise(c); // exercises your routine has that the catalog doesn't
  const fresh = planToRoutines(m.plan);
  const oldGoal = state.settings.weeklyGoal;
  let undo;
  if (mode === 'replace') {
    const old = await store.replaceRoutines(fresh);
    undo = () => store.replaceRoutines(old);
  } else {
    await store.saveRoutines(fresh);
    undo = async () => { for (const r of fresh) await store.deleteRoutine(r.id); };
  }
  if (m.plan.perWeek && oldGoal !== m.plan.perWeek) store.setSettings({ weeklyGoal: m.plan.perWeek });
  store.updateChat(id, { saved: mode }, { persist: true });
  haptic('success');
  toast({ title: esc(t(mode === 'replace' ? 'plan.replaced' : 'plan.saved')), sub: m.plan.name, action: t('common.undo'), ms: 6000, onAction: async () => {
    await undo();
    store.setSettings({ weeklyGoal: oldGoal });
    store.updateChat(id, { saved: false }, { persist: true });
    haptic('tap');
  } });
}

function syncButton() {
  const b = $('#composer .csend');
  if (b) { b.innerHTML = inflight ? I.stop : I.fwd; b.classList.toggle('stop', !!inflight); }
}

export function initCoach(n) {
  nav = n;
  const root = $('#s-coach');
  const composer = $('#composer');
  composer.innerHTML = `<span class="chalo" aria-hidden="true"><i></i></span><span class="cglow" aria-hidden="true"><i></i></span><button type="button" class="corb" data-dictate aria-label="${esc(state.t('coach.dictate'))}"><span class="orb"><i class="core"><b></b><b></b><b></b></i></span></button><input enterkeyhint="send" autocomplete="off" maxlength="5000"><button type="submit" class="csend">${I.fwd}</button>`;
  // The composer's orb: talk to your coach. What you say is sent when you pause, the answer is
  // spoken, then it listens again, so it's a conversation. Tap while it listens to send at once;
  // tap while it thinks or speaks (or say nothing) to end it.
  const input = composer.querySelector('input'), orbBtn = composer.querySelector('.corb');
  voiceLight(composer);
  const talk = { on: false, l: null, misses: 0 };
  const setTalk = phase => {
    composer.dataset.talk = phase || '';
    composer.classList.toggle('talking', !!phase);
    input.placeholder = phase ? state.t('coach.talk.' + phase) : state.t('coach.ph');
    input.disabled = !!phase;
  };
  const stopTalk = () => { talk.on = false; talk.l?.cancel(); talk.l = null; tts.stop(); setTalk(null); orbBtn.style.removeProperty('--lv'); };
  const listenTurn = async () => {
    if (!talk.on) return;
    setTalk('listening');
    const l = talk.l = listenSmart({
      stt: { key: getKey('groq'), model: sttModelId(state.settings), language: state.settings.voiceLang },
      onLevel: v => orbBtn.style.setProperty('--lv', v.toFixed(3)),
      onState: k => { if (talk.l === l && (k === 'hearing' || k === 'check')) setTalk('hearing'); }
    });
    let text = '';
    try { text = (await l.done).trim(); } catch { toast({ title: esc(state.t('voice.micDenied')), error: true }); return stopTalk(); }
    if (talk.l !== l) return;
    talk.l = null;
    orbBtn.style.removeProperty('--lv');
    if (!talk.on) return;
    if (!text) return stopTalk(); // nothing said: the conversation rests
    if (isNoise(text)) { // a stray noise ("L", "Jd"): never sent; keep listening, and rest after a few
      if (++talk.misses >= 3) return stopTalk();
      return listenTurn();
    }
    talk.misses = 0;
    setTalk('thinking');
    await ask(text, { root, voice: true });
    if (!talk.on) return;
    // the answer is spoken, then it rests: tap the orb to talk again (it never opens the mic by itself)
    talk.on = false;
    setTalk(null);
  };
  orbBtn.addEventListener('click', () => {
    if (talk.on) { haptic('tap'); if (talk.l && composer.dataset.talk !== 'thinking') talk.l.stop(); else stopTalk(); return; }
    if (!getKey('groq')) { toast({ title: esc(state.t('voice.noKey')), error: true }); return; }
    haptic('tap');
    unlockAudio();
    input.blur();
    talk.on = true;
    talk.misses = 0;
    const typed = input.value.trim();
    if (typed) { input.value = ''; setTalk('thinking'); ask(typed, { root, voice: true }).then(() => { talk.on = false; setTalk(null); }); return; }
    listenTurn();
  });
  document.getElementById('app').addEventListener('screenchange', () => { if (talk.on && !document.getElementById('app').classList.contains('coaching')) stopTalk(); });
  composer.addEventListener('submit', e => {
    e.preventDefault();
    if (inflight) { inflight.ctl.abort(); return; }
    const input = composer.querySelector('input');
    const q = input.value;
    if (!q.trim()) return;
    input.value = '';
    input.blur(); // the keyboard goes down so the answer has the screen
    haptic('tap');
    ask(q, { root });
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-coach]');
    if (!b) return;
    const k = b.dataset.coach;
    if (k === 'ask' || k === 'retry') { haptic('tap'); ask(b.dataset.q, { root }); }
    if (k === 'undo-change') { undoChange(b.dataset.id); return; }
    else if (k === 'saveplan') { b.closest('.pacts')?.querySelectorAll('button').forEach(x => { x.disabled = true; }); savePlan(b.dataset.id, b.dataset.mode); }
    else if (k === 'settings') nav.openSettings();
    else if (k === 'close') { haptic('tap'); nav.closeCoach?.(); }
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

// ---------- the weekly check-in: on the first open of a new week the Coach looks back and plans ahead ----------

let weeklyBusy = false;
export const thisMonday = (now = Date.now()) => dateKey(weekStart(now));
export async function weeklyCheckin({ force = false } = {}) {
  const s = state.settings, key = getKey('google'), monday = thisMonday();
  if (weeklyBusy || !key || (!force && (!s.weeklyCheckin || s.weeklyFor === monday))) return;
  const start = weekStart(Date.now());
  const lastWeek = state.history.filter(w => w.startedAt >= start - 7 * 86_400_000 && w.startedAt < start);
  if (!force && !lastWeek.length && !state.nutrition.some(n => n.date >= dateKey(start - 7 * 86_400_000) && n.date < monday)) return; // nothing to look back on
  weeklyBusy = true;
  try {
    await ensureModels();
    const lang = state.lang;
    const context = buildContext(coachSnap());
    const ask = [
      'WEEKLY CHECK-IN (the app asked for this, not the user). Write the Monday check-in for the week that starts today.',
      'First look back at last week (Monday to Sunday before today): sessions against the weekly goal, lifts that moved or stalled (with numbers), new records, food against the targets (average calories and protein) if logged, bodyweight change, sleep and readiness, goals.',
      'Then the plan for this week: which days and routines, two or three concrete targets (e.g. "bench 82.5 × 8"), and the one thing to fix. Use their MEMORIES and PROFILE.',
      'Warm and direct, like their coach. At most 140 words, short lines, no tables, no headings except "Last week" and "This week".'
    ].join(' ');
    const text = await withFallback(coachModels(state.settings, { background: true }), model => streamChat({ key, model, system: systemPrompt(lang), contents: chatContents([], context, ask) }), { rounds: 2, alsoRetry: ['timeout'] });
    const { text: said } = splitMemories(text);
    if (said) {
      store.addChat('model', said, { weekly: monday });
      store.setSettings({ weeklyFor: monday });
    }
  } catch { /* try again on the next open */ } finally { weeklyBusy = false; }
}
// After every workout the Coach looks at it straight away: what moved, what dropped, and exact
// targets for next time this routine comes round. Quietly, in the background; a card and a toast say when it's there.
let debriefBusy = false;
export async function sessionDebrief(w, { onReady = () => {} } = {}) {
  const key = getKey('google');
  if (!w || debriefBusy || !key || !state.settings.debrief || !(w.exercises || []).some(e => e.sets.some(x => x.done && x.type !== 'warmup'))) return;
  if (state.chat.some(m => m.debrief === w.id)) return;
  debriefBusy = true;
  try {
    await ensureModels();
    const lang = state.lang, name = id => state.catalog.name(id, 'en');
    const lines = w.exercises.map(e => `- ${name(e.exerciseId)}: ${e.sets.filter(x => x.done && x.type !== 'warmup').map(x => `${x.kg}x${x.reps}`).join(', ') || 'skipped'}`);
    const ask = [
      'SESSION DEBRIEF (the app asked for this, not the user). They just finished this workout' + (w.name ? ` ("${w.name}")` : '') + ':',
      lines.join('\n'),
      'Compare every lift with the last time they did it (in the training data). In at most 90 words: what moved (with numbers), anything that dropped and the likely reason (sleep, food, other sport or fatigue from the brief), then a line starting "Next time:" with two or three exact targets for this routine\'s next session (kg × reps). Warm, direct, no headings, no tables.'
    ].join('\n');
    const text = await withFallback(coachModels(state.settings, { background: true }), model => streamChat({ key, model, system: systemPrompt(lang), contents: chatContents([], buildContext(coachSnap()), ask) }), { rounds: 2, alsoRetry: ['timeout'] });
    const { text: said } = splitMemories(text);
    if (said) { store.addChat('model', said, { debrief: w.id, dname: w.name || '' }); store.setSettings({ debriefUnseen: w.id }); onReady(); }
  } catch { /* the session is saved either way */ } finally { debriefBusy = false; }
}
export const markDebriefSeen = () => { if (state.settings.debriefUnseen) store.setSettings({ debriefUnseen: '' }); };

export const markWeeklySeen = () => { const m = thisMonday(); if (state.settings.weeklyFor === m && state.settings.weeklySeen !== m) store.setSettings({ weeklySeen: m }); };
