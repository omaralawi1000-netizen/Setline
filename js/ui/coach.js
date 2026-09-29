// Coach tab: chat thread, composer, streamed answers, spoken when complete.
import * as store from '../store.js';
import { state } from '../store.js';
import { streamChat, AiError, withFallback, aiPlan, pickTextModels, nextQuotaReset } from '../ai.js';
import { listModels, pickTtsModel } from '../tts.js';
import { splitMemories, hideMemoryTail as hideMem, addMemories, asksBack } from '../coach.js';
import { splitChanges, hideChangeTail, applyChanges } from '../planedit.js';
import { splitAppChanges, planAppChanges, PAGES, splitActions, hideActionTail, isAffirm } from '../appedit.js';
// the reply without its hidden lines (memories and plan changes), also while it streams in
const hideMemoryTail = text => hideActionTail(hideChangeTail(hideMem(text)));
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
import { actOnText, onConfirmWord } from './voice.js';
import { I } from './icons.js';
import { openSheet, closeTop } from './sheet.js';
import { toast } from './toast.js';
import { pinHTML } from './pins.js';
import { openQuickReport, FLAG } from './report.js';
import { token } from './fx.js';
import { onFrame, nextFrame } from './frame.js';
import { perfNote } from './perf.js';

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
  return `<span class="think"><span class="tsteps">${steps.map((x, i) => `<span class="tl" style="--i:${i}">${esc(x)}</span>`).join('')}</span></span>`;
}

function bubble(m, partsOnly = false) {
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
  const note = (lines, undone, key) => `<div class="chgnote${undone ? ' undone' : ''}"><span class="chgic">${I.check}</span><span class="chgtxt">${lines.map(c => `<b>${esc(c)}</b>`).join('')}</span>${undone ? `<span class="chgu">${esc(t('change.undone'))}</span>` : undoable.has(key) ? `<button class="chip sm" data-coach="undo-change" data-id="${esc(m.id)}" data-key="${esc(key)}">${t('common.undo')}</button>` : ''}</div>`;
  const changed = m.changed?.length ? note(m.changed, m.undone, m.id) : '';
  // offers taken ("Do it" chips tapped), each with its own Undo, then the offers still open
  const acted = (m.acted || []).map(a => (a.failed ? `<p class="chgfail">${esc(a.done[0])}</p>` : note(a.done, a.undone, a.key))).join('');
  const offers = m.actions?.length && !m.streaming ? `<div class="dochips">${m.actions.map((a, i) => `<button class="dochip" data-coach="act" data-id="${esc(m.id)}" data-i="${i}" style="--i:${i}"><span class="dox">${I.check}</span><span>${esc(a.label)}</span></button>`).join('')}</div>` : '';
  // didn't get you, or got it wrong: the flag reports it in one tap
  const flag = !m.streaming && m.text ? `<button class="mflag" data-coach="report" data-id="${esc(m.id)}" aria-label="${esc(t('qr.wrong'))}">${FLAG}</button>` : '';
  if (partsOnly) return { cls: `msg ai${m.streaming ? ' is-streaming' : ''}${m.streaming && !m.text ? ' is-thinking' : ''}${m.weekly || m.debrief ? ' weekly' : ''}`, head: head + dhead, extras: kept + changed + acted, after: offers + flag };
  return `<li class="msg ai${m.streaming ? ' is-streaming' : ''}${m.streaming && !m.text ? ' is-thinking' : ''}${m.weekly || m.debrief ? ' weekly' : ''}" data-id="${m.id}"><div class="bub">${head}${dhead}${m.text ? formatAnswer(hideMemoryTail(m.text)) : thinkingHTML(m)}${kept}${changed}${acted}</div>${offers}${flag}</li>`;
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
  const kind = !key && !chat.length ? 'nokey' : !chat.length ? 'empty' : 'thread';
  const head = `<div class="tabtop"></div>
    <button class="iconbtn cclose" data-coach="close" aria-label="${t('common.close')}">${I.back.replace('d="M14.5 6 8.5 12l6 6"', 'd="M6 9.5l6 6 6-6"')}</button>
    <header class="coachhead"><div><h1 class="h1">${t('coach.title')}</h1><p class="sub">${t('coach.sub')}</p></div>
      ${chat.length ? `<button class="iconbtn" data-coach="clear" aria-label="${t('coach.clear')}">${I.trash}</button>` : ''}</header>
    ${key ? pinHTML('coach') : ''}`;
  let ol = root.querySelector(':scope > #thread');
  if (kind !== 'thread') {
    const body = kind === 'nokey'
      ? `<div class="empty solid"><div class="emptyglyph">${I.chat}</div><h2>${t('coach.noKey')}</h2><p>${t('coach.noKeySub')}</p>
        <button class="log" data-coach="settings"><span>${t('voice.openSettings')}</span></button></div>`
      : `<div class="coachhero glass"><span class="orb" aria-hidden="true"><i class="core"><b></b><b></b><b></b></i></span>
        <h2>${t('coach.empty')}</h2><p>${t('coach.emptySub')}</p>
        <div class="exq">${['coach.ex1', 'coach.ex2', 'coach.ex3'].map(k => `<button class="chip" data-coach="ask" data-q="${esc(t(k))}">${esc(t(k))}</button>`).join('')}</div></div>`;
    if (root._html !== head + body) { root.innerHTML = head + body; root._html = head + body; root._head = null; }
  } else {
    // the header and pin are small and redrawn only when they change; the conversation itself is
    // kept: messages already there stay the same nodes, new ones are added, changed ones patched
    if (root._head !== head || !ol) {
      for (const n of [...root.childNodes]) if (n !== ol) n.remove();
      root.insertAdjacentHTML('afterbegin', head);
      root._head = head;
      root._html = null;
      if (!ol) { ol = document.createElement('ol'); ol.className = 'thread'; ol.id = 'thread'; root.append(ol); }
    }
    const atEnd = nearEnd(root);
    const grew = syncThread(ol);
    // new messages keep the view at the bottom (in the same frame, before anything is painted) if
    // you were there, or if it's your own new question
    if (grew && (atEnd || grew.mine)) root.scrollTop = root.scrollHeight;
  }
  const composer = $('#composer');
  if (!composer.dataset.talk) composer.querySelector('input').placeholder = t('coach.ph'); // talking: the box shows what's happening
  composer.querySelector('.csend').setAttribute('aria-label', t('coach.send'));
  const send = composer.querySelector('.csend'), icon = inflight ? 'stop' : 'fwd';
  if (send.dataset.icon !== icon) { send.innerHTML = inflight ? I.stop : I.fwd; send.dataset.icon = icon; }
  syncThinking();
  // a message just sent from the box stays hidden until it flies up from there (sendFly)
  const hold = pendingSend || sending;
  if (hold) { const mine = [...root.querySelectorAll('.msg.me')].pop(); if (mine && mine.textContent.trim() === hold.text) mine.classList.add('sending', 'seen'); }
  if (pendingSend) nextFrame(() => { if (pendingSend) sendFly(root); });
}

// what a message looks like, apart from the words a streaming reply is still typing
const sigOf = m => m.streaming
  ? `S|${m.role}|${!!m.text}|${m.weekly || ''}|${m.debrief || ''}`
  : JSON.stringify([m.role, m.text, m.error, m.q, !!m.plan, m.saved, m.remembered, m.changed, m.undone, m.acted, m.actions?.map(a => a.label), m.weekly, m.debrief, m.dname,
    undoable.has(m.id), (m.acted || []).map(a => undoable.has(a.key))]);
function makeLi(m) {
  const tpl = document.createElement('template');
  const seen = shown.has(m.id);
  shown.add(m.id);
  tpl.innerHTML = seen ? bubble(m).replace('<li class="msg', '<li class="msg seen') : bubble(m);
  const li = tpl.content.firstElementChild;
  li._sig = sigOf(m);
  li._text = m.streaming ? null : m.text;
  return li;
}
const plainOf = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim(); };
// A reply that finished streaming becomes the final message in place: the same node, the words it
// typed kept as they are (only unwrapped from their fade-in spans, which doesn't move a single
// line), then its notes, offers and flag added. Nothing is drawn twice.
function finalize(li, m) {
  const p = bubble(m, true);
  if (typeof p !== 'object') return null;
  const bub = li.querySelector(':scope > .bub');
  if (!bub) return null;
  for (const w of bub.querySelectorAll('span')) if (w._wd) w.replaceWith(document.createTextNode(w.textContent));
  bub.normalize();
  for (const x of bub.querySelectorAll(':scope > .memnote, :scope > .chgnote, :scope > .chgfail')) x.remove();
  const want = plainOf(p.head + formatAnswer(hideMemoryTail(m.text)));
  if (bub.textContent.replace(/\s+/g, ' ').trim() !== want) bub.innerHTML = p.head + formatAnswer(hideMemoryTail(m.text)); // (only if the words really differ)
  if (p.extras) bub.insertAdjacentHTML('beforeend', p.extras);
  for (const x of li.querySelectorAll(':scope > .dochips, :scope > .mflag')) x.remove();
  if (p.after) { bub.insertAdjacentHTML('afterend', p.after); li.querySelector(':scope > .dochips')?.classList.add('fresh'); }
  li.className = p.cls + ' seen';
  li._sig = sigOf(m);
  li._text = m.text;
  return li;
}
// Bring the list in line with the chat: returns {mine} if messages were added (mine: your own).
function syncThread(ol) {
  const have = new Map();
  for (const li of ol.children) if (li.dataset.id) have.set(li.dataset.id, li);
  let prev = null, grew = null;
  for (const m of state.chat) {
    let li = have.get(m.id);
    have.delete(m.id);
    if (li && li._sig !== sigOf(m)) {
      const inPlace = m.role !== 'user' && !m.streaming && !m.error && !m.plan && m.text &&
        (li.classList.contains('is-streaming') || li._text === m.text) && !li.classList.contains('is-thinking');
      const done = inPlace && finalize(li, m);
      if (!done) { const fresh = makeLi(m); li.replaceWith(fresh); li = fresh; }
    }
    // your spoken question: the bubble that appeared with dots when you stopped talking becomes it
    if (!li && m.role === 'user') {
      const p = ol.querySelector(':scope > .msg.me.pending');
      if (p) { p.dataset.id = m.id; p.classList.remove('pending'); p.querySelector('.bub').textContent = m.text; p._sig = sigOf(m); p._text = m.text; shown.add(m.id); li = p; grew = { mine: true }; }
    }
    if (!li) { li = makeLi(m); grew = { mine: grew?.mine || m.role === 'user' }; }
    const next = prev ? prev.nextElementSibling : ol.firstElementChild;
    if (li !== next) ol.insertBefore(li, next);
    prev = li;
  }
  for (const li of have.values()) li.remove();
  const pend = ol.querySelector(':scope > .msg.me.pending');
  if (pend && pend !== ol.lastElementChild) ol.append(pend); // (always last, where your words will be)
  return grew;
}

// iOS-style send: the words you typed lift out of the message box as a bubble and glide up into the
// conversation, landing with a little give. Measured from where the text sat in the box.
let pendingSend = null, sending = null;
function sendStart(input, text, root) {
  const r = input.getBoundingClientRect(), cs = getComputedStyle(input);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return { text: text.trim(), x: r.left + parseFloat(cs.paddingLeft || 0), y: r.top + r.height / 2, w: Math.min(r.width, ctx.measureText(text).width), at: performance.now(), scroll: root?.scrollTop ?? 0 };
}
// The words stay exactly where you typed them and lift off as a bubble. Its landing place is measured
// again on every frame, so the keyboard going down, the thread redrawing or scrolling mid-flight can't
// make it land beside its spot and jump: it always settles exactly onto the real message, which then
// takes over in the same frame. It rises a touch ahead of sliding across, so it travels on a soft curve.
function sendFly(root) {
  const p = pendingSend;
  pendingSend = null;
  const spot = () => { const m = [...root.querySelectorAll('.msg.me.sending')].pop(); return m && { m, b: m.querySelector('.bub') }; };
  const first = spot(), app = document.getElementById('app');
  const reveal = () => { sending = null; for (const m of root.querySelectorAll('.msg.me.sending')) m.classList.remove('sending'); };
  if (!first?.b || !app || stillMotion() || performance.now() - p.at > 800) return reveal();
  sending = p;
  const A = app.getBoundingClientRect(), m0 = first.m.getBoundingClientRect(), b0 = first.b.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(first.b).paddingLeft || 0);
  const ghost = document.createElement('div');
  ghost.className = 'msg me seen sendghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${m0.width}px`;
  ghost.append(first.b.cloneNode(true));
  app.append(ghost);
  // where the message row would sit for its text to be exactly where the typed text was (fixed on screen)
  const sx = m0.left - A.left + (p.x - (b0.left + pad)), sy = m0.top - A.top + (p.y - (b0.top + b0.height / 2));
  // a one-line message starts at the text's own width and opens out as it rises
  const s0 = Math.max(0.86, Math.min(1, (p.w + pad * 2) / b0.width));
  const ease = w => t => 1 - (1 + w * t) * Math.exp(-w * t); // a spring that settles without bouncing
  const ey = ease(9), ex = ease(7), es = ease(8);
  const dur = token('--m-slow') * 1.25, t0 = performance.now();
  let last = { x: sx, y: sy }, raf = null, over = false;
  const done = () => {
    if (over) return;
    over = true;
    raf?.();
    reveal();
    ghost.remove();
  };
  const frame = now => {
    const t = Math.min(1, (now - t0) / dur), s = spot();
    if (s?.m) { const r = s.m.getBoundingClientRect(); last = { x: r.left - A.left, y: r.top - A.top }; }
    const x = sx + (last.x - sx) * (t < 1 ? ex(t) : 1), y = sy + (last.y - sy) * (t < 1 ? ey(t) : 1);
    const k = s0 + (1 - s0) * (t < 1 ? es(t) : 1);
    ghost.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    ghost.firstChild.style.transform = `scale(${k.toFixed(4)})`;
    if (t >= 1 || !s) return done();
    raf ||= onFrame(frame);
  };
  frame(t0);
  // …and the conversation above makes room for it by gliding up, instead of jumping
  // (only the messages on screen move: lifting the whole thread, however long, onto its own layer made
  // the phone draw it afresh, and it showed nothing at all for a moment)
  const moved = root.scrollTop - (p.scroll || 0);
  if (moved > 2) {
    const view = root.getBoundingClientRect();
    for (const m of root.querySelectorAll('#thread > .msg:not(.sending)')) {
      const r = m.getBoundingClientRect();
      if (r.bottom < view.top - moved || r.top > view.bottom) continue;
      m.animate([{ transform: `translateY(${moved}px)` }, { transform: 'none' }], { duration: dur, easing: token('--e-out') });
    }
  }
  $('#composer .csend')?.animate([{ scale: 1 }, { scale: 0.86, offset: 0.3 }, { scale: 1 }], { duration: token('--m-base'), easing: token('--e-spring') });
  setTimeout(done, dur + 400); // (no frames while the page is hidden)
}

// Streamed words don't appear in lumps: they flow in at a steady pace, each fading in.
// The text on screen glides after what has arrived, faster the further behind it is.
const WORD_MS = 460; // the same as --m-slow: a word is left alone only once its fade-in has finished
// At most about ten words are still blurring in at once: when the reply flows fast, each word's
// blur-in is shortened to fit (the words themselves arrive at the same pace).
let wordMs = WORD_MS;
// Words are wrapped so each can blur in on its own clock (a negative delay says how far along it is).
function wordify(el, births, start, now) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let i = start;
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of n.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.append(part); continue; }
      births[i] ??= now;
      const d = ((births.d ||= [])[i] ??= wordMs); // (each word keeps the length it started with)
      const age = now - births[i];
      const w = document.createElement('span');
      w.textContent = part;
      w._wd = true;
      if (age < d) { w.className = 'w'; w.style.animationDelay = `${-age}ms`; if (d !== WORD_MS) w.style.animationDuration = `${d}ms`; }
      frag.append(w);
      i++;
    }
    n.replaceWith(frag);
  }
  return i - start;
}
// One line of the answer as its block (a paragraph, or a list item that joins the list above it).
function lineBlock(line) {
  const t = document.createElement('template');
  t.innerHTML = formatAnswer(line);
  return t.content.firstElementChild;
}
function place(bub, el) {
  if (el.tagName === 'UL' && bub.lastElementChild?.tagName === 'UL') { const li = el.firstElementChild; bub.lastElementChild.append(li); return li; }
  bub.append(el);
  return el;
}
// Brings what's on screen (a) up to date with a freshly drawn line (b) without touching what's already
// there: words already showing (and still fading in) are kept as they are, only new words are added.
// Where the two differ in shape (a word turned bold, a line became a list), the rest is redrawn.
function merge(a, b) {
  const an = [...a.childNodes], bn = [...b.childNodes];
  let i = 0;
  for (; i < bn.length; i++) {
    const x = an[i], y = bn[i];
    if (!x) break;
    if (x.nodeType === 3 && y.nodeType === 3) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    if (x.nodeType === 1 && y.nodeType === 1 && x.tagName === y.tagName && !!x._wd === !!y._wd) {
      if (x._wd) { if (x.textContent !== y.textContent) x.replaceWith(y); } // a word that was cut off mid-way grew
      else merge(x, y);
      continue;
    }
    break;
  }
  for (const n of an.slice(i)) n.remove();
  if (i < bn.length) a.append(...bn.slice(i));
}
// Streaming, cheaply and without restarts: lines that are finished are left alone, and the line still
// being written only gains its new words (it used to be redrawn on every step, restarting the fade of
// every word still settling).
function wordsHTML(bub, text, births, now, st) {
  if (bub._st !== st) { for (const c of [...bub.childNodes]) if (!c.classList?.contains('wkhead')) c.remove(); bub._st = st; Object.assign(st, { n: 0, w: 0, live: null, liveUl: null }); }
  const lines = hideMemoryTail(text).split('\n'), tail = lines.pop();
  const drop = () => { st.live?.remove(); if (st.liveUl && !st.liveUl.children.length) st.liveUl.remove(); st.live = st.liveUl = null; };
  // the line on screen takes the new drawing of itself, if it has the same shape
  const keep = el => {
    const src = el.tagName === 'UL' && st.live?.tagName === 'LI' ? el.firstElementChild : el;
    if (!st.live?.isConnected || st.live.tagName !== src.tagName) return false;
    merge(st.live, src);
    return true;
  };
  while (st.n < lines.length) {
    const el = lines[st.n].trim() && lineBlock(lines[st.n]);
    if (el) st.w += wordify(el, births, st.w, now);
    if (!(el && keep(el))) { drop(); if (el) place(bub, el); }
    st.live = st.liveUl = null; // finished: left alone from now on
    st.n++;
  }
  const el = tail.trim() && lineBlock(tail);
  if (!el) return drop();
  wordify(el, births, st.w, now);
  if (keep(el)) return;
  drop();
  const newUl = el.tagName === 'UL' && bub.lastElementChild?.tagName !== 'UL';
  st.live = place(bub, el);
  if (newUl) st.liveUl = el;
}
// Whether the thread sits at (or within 80 px of) its end: measured once, then kept up to date by its
// scroll events (which come when it's laid out anyway), so a frame that adds words never has to lay
// the page out before writing to it. Only then does the answer keep the thread scrolled to its end.
function nearEnd(root) {
  if (!root._end) {
    const at = () => root.scrollHeight - root.clientHeight - root.scrollTop < 80;
    root._end = { v: at() };
    root.addEventListener('scroll', () => { root._end.v = at(); }, { passive: true });
  }
  return root._end.v;
}
// the answer has started: a spoken conversation stops thinking and speaks (set by the talk loop)
let answering = null;
function typewriter(root, id) {
  let words = [], shown = 0, raf = 0, last = 0, rate = 16, acc = 0, waiters = [];
  const births = [], st = {};
  const done = () => (shown >= words.length);
  const step = now => {
    // one word at a time at a steady pace (words a second) that eases up or down with how much has
    // arrived and is still to show, so a big chunk from the model never lands as a burst and a pause
    // in the stream doesn't stop it dead
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    const pending = words.length - shown;
    const target = Math.max(14, Math.min(70, pending / 0.9));
    rate += (target - rate) * Math.min(1, dt / 300);
    wordMs = Math.round(Math.max(200, Math.min(WORD_MS, 10000 / Math.max(1, rate))));
    acc = Math.min(acc + (rate * dt) / 1000, pending);
    const n = Math.floor(acc);
    if (n > 0) {
      acc -= n;
      shown += n;
      const bub = root.querySelector(`[data-id="${id}"] .bub`);
      const stick = nearEnd(root); // (known from its scroll events: nothing is measured before the write)
      if (bub) {
        const msg = bub.closest('.msg');
        // the answer starts: the box's orb gives one pulse and the first line rises out of it
        if (msg?.classList.contains('is-thinking')) { msg.classList.add('arrive'); pulseOrb(); answering?.(); perfNote(`first words ${Math.round(performance.now() - askedAt)} ms after asking`); }
        msg?.classList.remove('is-thinking');
        syncThinking();
        wordsHTML(bub, words.slice(0, shown).join(''), births, now, st);
      }
      if (stick) root.scrollTop = root.scrollHeight; // same frame as the words
    }
    if (done()) {
      // let the last words finish settling before anything re-renders the bubble
      raf?.();
      raf = 0;
      last = 0;
      setTimeout(() => { if (done()) waiters.splice(0).forEach(r => r()); }, WORD_MS);
    }
  };
  return {
    set(t) { words = t.match(/\S+\s*/g) || []; if (!raf) raf = onFrame(step); },
    // (a safety net in case frames stop, sized to what's still to show at the fastest pace)
    drain: () => (done() && !raf ? new Promise(r => setTimeout(r, WORD_MS)) : Promise.race([new Promise(r => waiters.push(r)), new Promise(r => setTimeout(r, 3000 + ((words.length - shown) / 40) * 1000))]))
  };
}

// The Coach is thinking (a reply on its way with no words yet, or the orb's conversation waiting):
// one class on the app drives the thinking look. (It used to be worked out by :has() selectors on the
// whole app, which made every change anywhere restyle everything.)
function syncThinking() {
  const app = document.getElementById('app');
  const on = !!document.querySelector('#s-coach .msg.ai.is-thinking') || document.getElementById('composer')?.dataset.talk === 'thinking';
  if (app && app.classList.contains('thinking') !== on) app.classList.toggle('thinking', on);
  thinkWords(on);
}

// While it thinks, the message box says what it's doing: "Thinking", then "Reading your log…",
// "Putting it together…". Each phrase blurs in letter by letter along a soft colour gradient and
// blurs away for the next.
let thinkTimer = 0, thinkN = 0;
function thinkWords(on) {
  const box = document.getElementById('composer');
  if (!box) return;
  let el = box.querySelector('.thinkline');
  if (!on) {
    clearInterval(thinkTimer); thinkTimer = 0;
    if (el && !el.classList.contains('gone')) { el.classList.add('gone'); setTimeout(() => { if (el.classList.contains('gone')) el.remove(); }, 400); }
    return;
  }
  if (thinkTimer) return;
  if (!el || el.classList.contains('gone')) { el?.remove(); el = document.createElement('span'); el.className = 'thinkline'; el.setAttribute('aria-live', 'polite'); box.querySelector('input')?.after(el); }
  const { t } = state;
  const phrases = [t('coach.thinking'), t('coach.step1'), t('coach.step2'), t('coach.step4')];
  thinkN = 0;
  const show = () => {
    const n = thinkN < phrases.length ? thinkN : 1 + ((thinkN - 1) % (phrases.length - 1)); // then round the steps again
    const text = phrases[n];
    thinkN++;
    const old = el.querySelector('.tp:not(.out)');
    if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 420); }
    const p = document.createElement('span');
    p.className = 'tp';
    const chars = [...text];
    p.innerHTML = chars.map((c, i) => `<span class="tc" style="--i:${i};--k:${Math.round((i / Math.max(1, chars.length - 1)) * 100)}%">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    p.setAttribute('aria-label', text);
    el.append(p);
  };
  show();
  thinkTimer = setInterval(show, 1900);
}

function pulseOrb() {
  const btn = $('#composer .corb');
  if (!btn || stillMotion()) return;
  btn.classList.remove('answer');
  nextFrame(() => { btn.classList.add('answer'); setTimeout(() => btn.classList.remove('answer'), 900); }); // (no forced layout)
}

// Following along: while a reply is read out, the sentence being spoken stays bright and the rest of
// the reply rests a little dimmer. Sentences are marked once the reply has settled on screen.
let speakId = null;
function markSentences(bub) {
  if (bub.dataset.sents) return;
  const skip = '.chgnote,.memnote,.wkhead,.chgfail,button';
  const walker = document.createTreeWalker(bub, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest(skip) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let k = 0;
  for (const n of nodes) {
    const frag = document.createDocumentFragment();
    for (const part of n.nodeValue.split(/(?<=[.!?…])(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { frag.append(part); k++; continue; }
      const sp = document.createElement('span');
      sp.className = 'sn'; sp.dataset.s = k; sp.textContent = part;
      frag.append(sp);
    }
    if (/[.!?…]\s*$/.test(n.nodeValue)) k++;
    n.replaceWith(frag);
  }
  // where each sentence ends, as a share of all the text: position → sentence
  const len = [];
  for (const sp of bub.querySelectorAll('.sn')) len[sp.dataset.s] = (len[sp.dataset.s] || 0) + sp.textContent.length;
  const total = len.reduce((a, x) => a + (x || 0), 0) || 1;
  let acc = 0;
  bub._ends = len.map(x => (acc += x || 0) / total);
  bub.dataset.sents = String(len.length);
}
function followAlong(pos) {
  const bub = speakId && document.querySelector(`#s-coach [data-id="${speakId}"]:not(.is-streaming) .bub`);
  if (!bub) return;
  markSentences(bub);
  if (!bub._ends?.length || bub._ends.length < 2) return; // one sentence: nothing to follow
  const k = pos == null ? -1 : Math.max(0, bub._ends.findIndex(e => pos <= e + 0.01));
  if (bub._k === k) return;
  bub._k = k;
  bub.classList.toggle('reading', k >= 0);
  for (const sp of bub.querySelectorAll('.sn')) sp.classList.toggle('now', +sp.dataset.s === k);
}
function endFollow() {
  for (const bub of document.querySelectorAll('#s-coach .bub.reading')) { bub.classList.remove('reading'); bub._k = undefined; }
}

// While the Coach speaks, the message-box orb moves with its voice: its light swells on the loud
// parts and settles in the pauses. The level comes from the clip itself (tts.speechLevel).
function voiceLight(composer) {
  let raf = 0, lv = 0;
  let quiet = 0;
  const stop = () => {
    raf?.(); raf = 0; lv = 0;
    composer.classList.remove('speaking'); composer.style.removeProperty('--sv');
    // between two pieces of one reply the voice stops for a moment: only let go after a real pause
    clearTimeout(quiet);
    quiet = setTimeout(() => { if (!raf) endFollow(); }, 700);
  };
  const frame = now => {
    const raw = tts.speechLevel();
    const target = raw == null ? 0.35 + 0.25 * Math.abs(Math.sin(now / 190)) : raw; // the phone's voice: a gentle beat
    lv += (target - lv) * (target > lv ? 0.35 : 0.12); // rises quickly, settles slowly
    composer.style.setProperty('--sv', lv.toFixed(3));
    followAlong(tts.speechPos());
  };
  tts.onSpeaking(on => {
    if (!on) return stop();
    clearTimeout(quiet);
    if (raf || !document.getElementById('app')?.classList.contains('coaching')) return;
    composer.classList.add('speaking');
    raf = onFrame(frame);
  });
}

// The thread keeps to the end of a reply only while you're within about 80 px of it (scrollTop, set
// in the same frame as the words; never a smooth scroll that fights your finger).
function scrollDown(root) { if (nearEnd(root)) root.scrollTop = root.scrollHeight; }
const stillMotion = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;

// Your own bubble, the moment you stop talking: dots shimmer in it until the words are back from
// speech-to-text, then they fill in (the same node becomes the message: see syncThread).
let heardAt = 0, askedAt = 0;
function pendingMine(root, on) {
  const ol = root.querySelector(':scope > #thread');
  const cur = ol?.querySelector(':scope > .msg.me.pending');
  if (!on) { cur?.remove(); return; }
  if (!ol || cur) return;
  heardAt = performance.now();
  const li = document.createElement('li');
  li.className = 'msg me pending';
  li.innerHTML = '<div class="bub"><span class="pdots" aria-label="…"><i></i><i></i><i></i></span></div>';
  ol.append(li);
  scrollDown(root);
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
  if (!changes?.length) return { done: [] };
  const { app, plan } = splitAppChanges(changes);
  const before = { routines: state.routines, dayPlan: state.settings.dayPlan || {}, settings: {} };
  const done = [];
  if (plan.length) {
    const r = applyChanges(before, plan, { catalog: state.catalog, lang: state.lang, t: state.t });
    if (r.done.length) {
      if (JSON.stringify(r.routines) !== JSON.stringify(before.routines)) await store.replaceRoutines(r.routines);
      store.setSettings({ dayPlan: r.dayPlan });
      done.push(...r.done);
    }
  }
  // settings (with Undo), things said in words (the app's own commands, each with its own Undo card),
  // and a page to open once the reply is read
  const a = planAppChanges(app, state.settings, state.t);
  if (Object.keys(a.settings).length) { store.setSettings(a.settings); before.settings = a.before; done.push(...a.done); }
  if (done.length) undoable.set(id, before);
  a.dos.forEach((text, i) => setTimeout(() => { if (actOnText(text)) haptic('tap'); }, 600 + i * 1900));
  done.push(...a.dos.map(text => state.t('change.did', { text })));
  return { done, open: a.open };
}
async function undoChange(id, key = id) {
  const before = undoable.get(key);
  if (!before) return;
  undoable.delete(key);
  haptic('tap');
  if (JSON.stringify(before.routines) !== JSON.stringify(state.routines)) await store.replaceRoutines(before.routines);
  store.setSettings({ dayPlan: before.dayPlan, ...before.settings });
  if (key === id) return store.updateChat(id, { undone: true }, { persist: true });
  const m = state.chat.find(x => x.id === id);
  store.updateChat(id, { acted: (m?.acted || []).map(a => (a.key === key ? { ...a, undone: true } : a)) }, { persist: true });
}

// A "Do it" chip: the offer is applied at once (with Undo) and turns into a note of what changed.
let acting = false;
async function runAction(id, i = 0) {
  const m = state.chat.find(x => x.id === id), a = m?.actions?.[i];
  if (!a || acting) return false;
  acting = true;
  try {
    const key = `${id}:${Date.now().toString(36)}`;
    const { done, open } = await applyCoachChanges(key, a.changes);
    const fresh = state.chat.find(x => x.id === id) || m;
    const note = done.length ? { key, label: a.label, done } : { key, label: a.label, done: [state.t('change.failed', { label: a.label })], failed: true };
    store.updateChat(id, { actions: (fresh.actions || []).filter((_, j) => j !== i), acted: [...(fresh.acted || []), note] }, { persist: true });
    haptic(done.length ? 'success' : 'error');
    if (open) setTimeout(() => openPage(open), 700);
    return true;
  } finally { acting = false; }
}
// The newest reply's first offer, if it's still the last thing in the conversation
function topAction() {
  // the newest offer that nothing you've said since has moved past
  for (let i = state.chat.length - 1; i >= 0; i--) {
    const m = state.chat[i];
    if (m.role === 'user') return null;
    if (m.actions?.length) return Date.now() - (m.at || 0) < 15 * 60_000 ? m.id : null;
  }
  return null;
}
export function runTopAction() {
  const id = topAction();
  if (!id) return false;
  runAction(id, 0);
  return true;
}
function openPage(page) {
  if (!page || !PAGES[page]) return;
  if (PAGES[page] === 'tab') nav.go?.(page); else nav.open?.(page);
}

// Ask the coach. Used by the composer, the example chips, and voice questions.
export async function ask(question, { root = $('#s-coach'), voice = false } = {}) {
  question = String(question || '').trim();
  if (!question) return;
  // "yes" / "do it" with an offer on screen: that's the answer to it
  const offer = isAffirm(question) && topAction();
  if (offer) { runAction(offer, 0); store.addChat('user', question); return; }
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
  askedAt = performance.now();
  const reply = store.addChat('model', '', { streaming: true, q: question });
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
    // the voice for the first sentence is made while the rest is still being written
    const willTalk = voice || state.settings.spoken !== 'off';
    const ttsOpts = { key, model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang, canSpeak: () => !isRecording() };
    let first = null;
    const text = await withFallback(coachModels(state.settings), model => streamChat({
      key, model, system: systemPrompt(lang), contents: chatContents(history, context, question), signal: ctl.signal,
      onText: full => {
        clearTimeout(slow); store.updateChat(reply.id, { text: full }, { quiet: true }); typer.set(full);
        if (willTalk && !first) { const f = tts.firstSentence(speakable(hideMemoryTail(full))); if (f && f.length < speakable(hideMemoryTail(full)).length - 2) { first = f; tts.prefetch(first, ttsOpts); } }
      }
    }), { rounds: 3, wait: 2500, alsoRetry: ['timeout'] }).finally(() => clearTimeout(slow)); // busy servers get a patient second and third go
    // the voice starts as soon as the answer is in, while the words are still appearing on screen
    const { text: saidMem, facts: all } = splitMemories(text);
    const { text: saidPlain, changes } = splitChanges(saidMem);
    const { text: saidClean, actions } = splitActions(saidPlain);
    const said = saidClean;
    const talk = said && willTalk ? tts.speak(speakable(said), { ...ttsOpts, first }) : null;
    if (talk) { speakId = reply.id; talk.finally(() => { if (speakId === reply.id) speakId = null; }); }
    await typer.drain();
    // "REMEMBER: …" lines become memories and leave the reply
    const before = state.settings.memories || [], mem = addMemories(before, all);
    const facts = mem.slice(before.length).map(m => m.text); // only what's new
    if (facts.length) store.setSettings({ memories: mem });
    // "CHANGE: {…}" lines change the plan (a day, a routine), with Undo
    const { done: changed, open } = await applyCoachChanges(reply.id, changes);
    store.updateChat(reply.id, { text: saidClean, streaming: false, ...(facts.length ? { remembered: facts } : {}), ...(changed.length ? { changed } : {}), ...(actions.length ? { actions } : {}) }, { persist: true });
    if (changed.length) haptic('success');
    if (open) setTimeout(() => openPage(open), talk ? 900 : 1400); // after the reply has been seen
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
        haptic('success');
      if (plan.summary && state.settings.spoken !== 'off') tts.speak(speakable(plan.summary), { key, model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang, canSpeak: () => !isRecording() });
    }
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'failed';
    store.updateChat(reply.id, { streaming: false, ...(code === 'aborted' ? {} : { error: code === 'failed' && e.status ? String(e.status) : code === 'invalid' ? 'failed' : code }) }, { persist: true });
  } finally {
    if (inflight?.id === reply.id) inflight = null;
    syncButton();
    nextFrame(() => scrollDown(root));
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
  composer.innerHTML = `<span class="cglow" aria-hidden="true"><i></i></span><span class="chit" aria-hidden="true"></span><button type="button" class="corb" data-dictate aria-label="${esc(state.t('coach.dictate'))}"><span class="orb"><i class="core"><b></b><b></b><b></b></i></span></button><input enterkeyhint="send" autocomplete="off" maxlength="5000"><button type="submit" class="csend">${I.fwd}</button>`;
  // The composer's orb: talk to your coach. What you say is sent when you pause, the answer is
  // spoken, then it listens again, so it's a conversation. Tap while it listens to send at once;
  // tap while it thinks or speaks (or say nothing) to end it.
  const input = composer.querySelector('input'), orbBtn = composer.querySelector('.corb');
  voiceLight(composer);
  onConfirmWord(runTopAction); // "yes" / "do it" said to the orb anywhere takes the Coach's latest offer
  const talk = { on: false, l: null, misses: 0 };
  const setTalk = phase => {
    composer.dataset.talk = phase || '';
    syncThinking();
    composer.classList.toggle('talking', !!phase);
    input.placeholder = phase ? state.t('coach.talk.' + phase) : state.t('coach.ph');
    input.disabled = !!phase;
  };
  answering = () => { if (talk.on && composer.dataset.talk === 'thinking') setTalk('speaking'); };
  const stopTalk = () => { talk.on = false; talk.l?.cancel(); talk.l = null; tts.stop(); setTalk(null); orbBtn.style.removeProperty('--lv'); };
  const listenTurn = async () => {
    if (!talk.on) return;
    setTalk('listening');
    const l = talk.l = listenSmart({
      stt: { key: getKey('groq'), model: sttModelId(state.settings), language: state.settings.voiceLang },
      onLevel: v => orbBtn.style.setProperty('--lv', v.toFixed(3)),
      onState: k => { if (talk.l === l && (k === 'hearing' || k === 'check')) { setTalk('hearing'); if (k === 'hearing') pendingMine(root, true); } }
    });
    let text = '';
    try { text = (await l.done).trim(); } catch { toast({ title: esc(state.t('voice.micDenied')), error: true }); return stopTalk(); }
    if (talk.l !== l) return;
    talk.l = null;
    orbBtn.style.removeProperty('--lv');
    if (!talk.on || !text || isNoise(text)) pendingMine(root, false);
    else perfNote(`heard in ${Math.round(performance.now() - (heardAt || performance.now()))} ms`);
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
    // the answer has been spoken. If it asked you something ("Should we start the workout?"), the orb
    // listens for your answer straight away; otherwise it rests (tap the orb to talk again)
    const last = [...state.chat].reverse().find(m => m.role !== 'user');
    if (last && !last.error && asksBack(last.text)) return listenTurn();
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
  // typing: the Coach's offers step aside
  const typing = () => document.getElementById('app').classList.toggle('typing', !!input.value.trim());
  input.addEventListener('input', typing);
  composer.addEventListener('submit', () => requestAnimationFrame(typing));
  composer.addEventListener('submit', e => {
    e.preventDefault();
    if (inflight) { inflight.ctl.abort(); return; }
    const input = composer.querySelector('input');
    const q = input.value;
    if (!q.trim()) return;
    pendingSend = sendStart(input, q, root);
    input.value = '';
    input.blur(); // the keyboard goes down so the answer has the screen
    haptic('tap');
    ask(q, { root });
  });
  // a word that has settled drops its animation (it's already at rest), so a long line doesn't keep
  // dozens of them alive
  root.addEventListener('animationend', e => { if (e.animationName === 'wordrise' && e.target._wd) e.target.style.animation = 'none'; });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-coach]');
    if (!b) return;
    const k = b.dataset.coach;
    if (k === 'ask' || k === 'retry') { haptic('tap'); ask(b.dataset.q, { root }); }
    if (k === 'undo-change') { undoChange(b.dataset.id, b.dataset.key || b.dataset.id); return; }
    if (k === 'report') {
      const i = state.chat.findIndex(x => x.id === b.dataset.id), m = state.chat[i];
      const q = [...state.chat.slice(0, i)].reverse().find(x => x.role === 'user');
      haptic('tap');
      openQuickReport({ source: 'coach', heard: q?.text || '', reply: m?.text || '' });
      return;
    }
    if (k === 'act') { b.disabled = true; b.classList.add('going'); runAction(b.dataset.id, Number(b.dataset.i) || 0); return; }
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
      'Look at the WEIGHT TREND line: if they want to lose fat and the trend is not dropping 0.5–1% a week (or gaining faster than planned), say so and offer a new calorie target. Look at HARD DAYS: if a heavy leg day sits the day before or after wrestling (or another hard sport day), point it out.',
      'Change nothing yourself: offer each change (a calorie target, moving a session) as an ACTION line, at most two, so they can tap yes.',
      'Warm and direct, like their coach. At most 140 words, short lines, no tables, no headings except "Last week" and "This week".'
    ].join(' ');
    const text = await withFallback(coachModels(state.settings, { background: true }), model => streamChat({ key, model, system: systemPrompt(lang), contents: chatContents([], context, ask) }), { rounds: 2, alsoRetry: ['timeout'] });
    const { text: said0 } = splitMemories(text);
    const { text: said, actions } = splitActions(splitChanges(said0).text); // offers only
    if (said) {
      store.addChat('model', said, { weekly: monday, ...(actions.length ? { actions } : {}) });
      store.setSettings({ weeklyFor: monday });
    }
  } catch { /* try again on the next open */ } finally { weeklyBusy = false; }
}
// After every workout the Coach looks at it straight away: what moved, what dropped, and exact
// targets for next time this routine comes round. Quietly, in the background; a card and a toast say when it's there.
let debriefBusy = false;
export async function sessionDebrief(w, { onReady = () => {}, review = null } = {}) {
  const key = getKey('google');
  if (!w || debriefBusy || !key || !state.settings.debrief || !(w.exercises || []).some(e => e.sets.some(x => x.done && x.type !== 'warmup'))) return;
  if (state.chat.some(m => m.debrief === w.id)) return;
  debriefBusy = true;
  try {
    await ensureModels();
    const lang = state.lang, name = id => state.catalog.name(id, 'en');
    const lift = id => review?.lifts.find(l => l.exerciseId === id);
    const lines = w.exercises.map(e => {
      const l = lift(e.exerciseId), tg = l?.target ? ` | planned ${l.target.sets}x${l.target.kg ?? '?'}kg x${l.target.reps} → ${l.status.toUpperCase()}` : '';
      const nx = l?.next ? ` | app's next target ${l.next.kg}kg x${l.next.reps} (${l.next.reason})` : '';
      return `- ${name(e.exerciseId)}: ${e.sets.filter(x => x.done && x.type !== 'warmup').map(x => `${x.kg}x${x.reps}`).join(', ') || 'skipped'}${tg}${nx}`;
    });
    const concern = review?.concern === 'missed' ? `They MISSED the plan on ${review.missed} of ${review.planned} lifts. Say so plainly and kindly, name the likely reason from the data (sleep, food, readiness, wrestling or other sport the day before, too big a jump), and what to do next time.`
      : review?.concern === 'deload' ? 'A lift has stalled three sessions running: the app will take it about 10% lighter next time to build back up. Explain that in one line.' : '';
    const ask = [
      'SESSION DEBRIEF (the app asked for this, not the user). They just finished this workout' + (w.name ? ` ("${w.name}")` : '') + ':',
      lines.join('\n'),
      concern,
      'Compare every lift with the last time they did it (in the training data). In at most 90 words: what moved (with numbers), anything that dropped and the likely reason (sleep, food, other sport or fatigue from the brief), then a line starting "Next time:" with two or three exact targets for this routine\'s next session (kg × reps; use the app\'s next targets unless the data says otherwise). Warm, direct, no headings, no tables.',
      'Change nothing yourself. If a change would help (a lighter jump, an extra rest day, moving a session), offer it with at most two ACTION lines so they can say yes.'
    ].filter(Boolean).join('\n');
    const text = await withFallback(coachModels(state.settings, { background: true }), model => streamChat({ key, model, system: systemPrompt(lang), contents: chatContents([], buildContext(coachSnap()), ask) }), { rounds: 2, alsoRetry: ['timeout'] });
    const { text: said0 } = splitMemories(text);
    const { text: said, actions } = splitActions(splitChanges(said0).text); // it only offers; nothing is changed from here
    if (said) { store.addChat('model', said, { debrief: w.id, dname: w.name || '', ...(actions.length ? { actions } : {}) }); store.setSettings({ debriefUnseen: w.id }); onReady(); }
  } catch { /* the session is saved either way */ } finally { debriefBusy = false; }
}
export const markDebriefSeen = () => { if (state.settings.debriefUnseen) store.setSettings({ debriefUnseen: '' }); };

export const markWeeklySeen = () => { const m = thisMonday(); if (state.settings.weeklyFor === m && state.settings.weeklySeen !== m) store.setSettings({ weeklySeen: m }); };
