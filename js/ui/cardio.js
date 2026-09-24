// Cardio UI: live session, finish and log sheets, type picker, session detail.
import * as store from '../store.js';
import { state } from '../store.js';
import { CARDIO_TYPES, cardioName, cardioType, cardioElapsed, validateCardio, makeCardioSession, paceText, cardioMinutes, ZONES } from '../cardio.js';
import { weekStart } from '../stats.js';
import { parseNumber } from '../units.js';
import { clock, dayLong, time, num } from '../format.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';

let nav = { go: () => {}, showDetail: () => {} };
export const setCardioNav = n => { nav = n; };

const C = 2 * Math.PI * 88; // ring circumference

// Small line icons per cardio type.
const ICONS = {
  run: '<circle cx="15" cy="4.6" r="1.9"/><path d="M9.5 20.5l2.6-5.2 3.2 2.4v3.3M7 12.2l2.8-3.5 3.9 1.1 2.1 3.2 2.7.8M12.1 15.3l-1.2-4.4"/>',
  walk: '<circle cx="13" cy="4.6" r="1.9"/><path d="M10.5 21l1.8-6.2 2.7 2.5V21M9 12.8l1.9-4.3 3.1 1.3 1.6 3.4M12.3 14.8l-1.4-6.3"/>',
  hike: '<path d="M3 19 9 9l4 6 3-4 5 8z"/><path d="M8 11.5 10 13"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5M12 16l-2-7M18 16l-3-7h2"/>',
  spin: '<circle cx="8" cy="15" r="4"/><path d="M8 15l6-7h3M12 21h8M14 8l2 13"/>',
  row: '<path d="M3 17h18M6 17l6-8 4 3M12 9l1-3"/><circle cx="13.5" cy="4.5" r="1.3"/>',
  swim: '<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2-1.5 4.5-1.5S19 17 21 17M3 20.5c2 0 2-1.5 4.5-1.5S10 20.5 12 20.5s2-1.5 4.5-1.5S19 20.5 21 20.5M8 13l3-4 4 2"/><circle cx="16.5" cy="7.5" r="1.4"/>',
  elliptical: '<ellipse cx="12" cy="15" rx="8" ry="3.5"/><path d="M12 11.5V4M9 5.5h6"/>',
  stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  hiit: '<path d="M13 3 6 13h5l-1 8 7-10h-5z"/>',
  other: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>'
};
export const cardioIcon = id => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ICONS.other}</svg>`;

const kmTxt = km => `${num(km, state.lang, 2)} km`;
const durTxt = sec => clock(sec).replace(/^00:/, '0:');

// Most used types first, then the everyday ones.
export function favouriteTypes(n = 4) {
  const count = {};
  for (const c of state.cardio) count[c.type] = (count[c.type] || 0) + 1;
  const base = ['run', 'bike', 'walk', 'row', 'spin', 'swim'];
  return [...new Set([...Object.keys(count).sort((a, b) => count[b] - count[a]), ...base])].slice(0, n);
}

// ---------- start ----------

export function startCardioSession(type) {
  const { t } = state;
  if (state.active) { toast({ title: esc(t('voice.cardioAfter')), sub: t('voice.cardioAfterSub'), error: true }); return; }
  if (!state.activeCardio) { store.beginCardio(type); haptic('success'); }
  nav.go('workout');
}

export function pickTypeSheet({ onPick, title }) {
  const { t, lang } = state;
  openSheet((el) => {
    el.insertAdjacentHTML('beforeend', `<div class="shead"><h2>${esc(title || t('cardio.pick'))}</h2></div>
      <div class="ctypes">${CARDIO_TYPES.map(c => `<button class="ctype" data-type="${c.id}">${cardioIcon(c.id)}<span>${esc(lang === 'da' ? c.da : c.en)}</span></button>`).join('')}</div>`);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      haptic('tap');
      closeTop().then(() => onPick(b.dataset.type));
    });
  }, { label: title || t('cardio.pick') });
}

// ---------- live session (rendered into the Workout tab) ----------

export function renderLiveCardio(root) {
  const { t, lang } = state;
  const a = state.activeCardio;
  const sec = cardioElapsed(a);
  const paused = !!a.pausedAt;
  const week = cardioMinutes(state.cardio, weekStart(Date.now()), weekStart(Date.now()) + 7 * 86_400_000);
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="go" data-to="today" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${esc(cardioName(a.type, lang))}</strong><span id="cstate">${t(paused ? 'cardio.paused' : 'cardio.running')}</span></div>
      <button class="pillbtn" data-cardio="finish">${t('cardio.finish')}</button>
    </header>
    <div class="clive glass${paused ? ' paused' : ''}" id="clive">
      <div class="cring">
        <svg viewBox="0 0 200 200" aria-hidden="true"><circle class="bg" cx="100" cy="100" r="88"/><circle class="fg" id="carc" cx="100" cy="100" r="88" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - (sec % 60) / 60)}"/></svg>
        <div class="cread"><span class="cicon">${cardioIcon(a.type)}</span><b id="cclock">${durTxt(sec)}</b><span>${t('cardio.elapsed')}</span></div>
      </div>
      <button class="cpause" data-cardio="pause" aria-label="${t(paused ? 'cardio.resume' : 'cardio.pause')}">${paused ? I.play : '<svg class="i" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>'}<span>${t(paused ? 'cardio.resume' : 'cardio.pause')}</span></button>
    </div>
    <p class="chint">${t('cardio.zoneHint')}</p>
    <div class="card solid cweek"><span class="label">${t('label.cardio')}</span>
      <div class="cbar"><i style="transform:scaleX(${Math.min(1, week.minutes / state.settings.cardioGoal)})"></i></div>
      <span class="cweek-t">${esc(t('cardio.minutesWeek', { min: week.minutes, goal: state.settings.cardioGoal }))}</span></div>`;
}

// Called by the app clock: the clock text and a ring that sweeps once a minute.
export function tickCardio(root) {
  const a = state.activeCardio;
  if (!a) return;
  const sec = cardioElapsed(a);
  const c = root.querySelector('#cclock');
  if (c) c.textContent = durTxt(sec);
  const arc = root.querySelector('#carc');
  if (arc && !a.pausedAt) arc.style.strokeDashoffset = C * (1 - (sec % 60 || (sec ? 60 : 0)) / 60);
}

// ---------- finish ----------

function zoneChips(selected) {
  const { t } = state;
  return `<div class="zones" role="group">${ZONES.map(z => `<button class="zone z${z}" data-zone="${z}" aria-pressed="${z === selected}"><b>${z}</b><span>${t('cardio.zoneName.' + z)}</span></button>`).join('')}</div>`;
}

function readKm(input) {
  const v = parseNumber(input?.value ?? '');
  return input?.value.trim() ? v : null;
}

export function finishSheet() {
  const { t, lang } = state;
  const a = state.activeCardio;
  if (!a) return;
  const hasDistance = cardioType(a.type).metric != null;
  let zone = null;
  openSheet((el, api) => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody">
      <h2>${t('cardio.finishTitle')}</h2><p class="lead">${esc(cardioName(a.type, lang))} · ${durTxt(cardioElapsed(a))}</p>
      ${hasDistance ? `<div class="field"><label for="ckm">${t('cardio.distanceOpt')}</label><input id="ckm" inputmode="decimal" placeholder="0,0" autocomplete="off"></div>` : ''}
      <div class="field"><label>${t('cardio.effort')}</label>${zoneChips(null)}</div>
      <div class="err" id="cerr"></div>
      <div class="acts"><button class="log" data-k="save">${I.check}<span>${t('cardio.save')}</span></button>
        <button class="btn2 solid" data-k="keep">${t('finish.keepGoing')}</button>
        <button class="linkbtn" data-k="discard">${t('cardio.discard')}</button></div></div>`);
    el.addEventListener('click', async e => {
      const z = e.target.closest('[data-zone]');
      if (z) { zone = Number(z.dataset.zone) === zone ? null : Number(z.dataset.zone); for (const b of el.querySelectorAll('[data-zone]')) b.setAttribute('aria-pressed', String(Number(b.dataset.zone) === zone)); haptic('tap'); return; }
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === 'keep') return closeTop();
      if (k === 'discard') {
        return api.replace(x => {
          x.insertAdjacentHTML('beforeend', `<h2>${t('cardio.discardTitle')}</h2><p class="lead">${t('discard.body')}</p>
            <div class="acts"><button class="btn2 solid danger" data-d="yes">${I.trash}<span>${t('discard.confirm')}</span></button><button class="btn2 solid" data-d="no">${t('finish.keepGoing')}</button></div>`);
          x.querySelector('[data-d=no]').onclick = () => closeTop();
          x.querySelector('[data-d=yes]').onclick = async () => { await closeTop(); await store.discardCardio(); toast({ title: esc(t('toast.discarded')) }); nav.go('today'); };
        });
      }
      if (k === 'save') {
        const km = hasDistance ? readKm(el.querySelector('#ckm')) : null;
        if (hasDistance && el.querySelector('#ckm').value.trim() && km == null) { el.querySelector('#cerr').textContent = t('cardio.invalid.distance'); haptic('error'); return; }
        const check = validateCardio({ type: a.type, durationSec: cardioElapsed(a), distanceKm: km, zone });
        if (!check.ok) { el.querySelector('#cerr').textContent = t('cardio.invalid.' + check.error); haptic('error'); return; }
        e.target.closest('button').disabled = true;
        await closeTop();
        const session = await store.endCardio({ distanceKm: km, zone });
        haptic('success');
        toast({ title: esc(t('cardio.saved')), sub: session.records?.length ? session.records.map(r => t('cardio.record.' + r)).join(' · ') : '' });
        nav.showDetail(session.id, { fromFinish: true, kind: 'cardio' });
      }
    });
  }, { label: t('cardio.finishTitle') });
}

// ---------- log a past session ----------

export function logSheet(type = null) {
  if (!type) return pickTypeSheet({ onPick: logSheet, title: state.t('cardio.logPast') });
  const { t, lang } = state;
  const hasDistance = cardioType(type).metric != null;
  let minutes = 30, zone = null, day = 0;
  openSheet((el) => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody">
      <div class="shead"><h2>${esc(cardioName(type, lang))}</h2><span class="ctypeicon">${cardioIcon(type)}</span></div>
      <div class="field"><label>${t('cardio.duration')}</label>
        <div class="bigstep"><button class="step" data-m="-5" aria-label="−5">−</button><input id="cmin" inputmode="numeric" value="${minutes}" aria-label="${t('cardio.minutes')}"><span>min</span><button class="step" data-m="5" aria-label="+5">+</button></div></div>
      ${hasDistance ? `<div class="field"><label for="ckm">${t('cardio.distanceOpt')}</label><input id="ckm" inputmode="decimal" placeholder="0,0" autocomplete="off"></div>` : ''}
      <div class="field"><label>${t('cardio.effort')}</label>${zoneChips(null)}</div>
      <div class="field"><label>${t('cardio.when')}</label><div class="opts"><button class="chip" data-day="0" aria-pressed="true">${t('cardio.today')}</button><button class="chip" data-day="1" aria-pressed="false">${t('cardio.yesterday')}</button></div></div>
      <div class="err" id="cerr"></div>
      <div class="acts"><button class="log" data-k="save">${I.check}<span>${t('cardio.save')}</span></button></div></div>`);
    const minIn = el.querySelector('#cmin');
    el.addEventListener('click', async e => {
      const m = e.target.closest('[data-m]');
      if (m) { minutes = Math.max(1, Math.min(720, (parseNumber(minIn.value) || minutes) + Number(m.dataset.m))); minIn.value = minutes; haptic('tap'); return; }
      const z = e.target.closest('[data-zone]');
      if (z) { zone = Number(z.dataset.zone) === zone ? null : Number(z.dataset.zone); for (const b of el.querySelectorAll('[data-zone]')) b.setAttribute('aria-pressed', String(Number(b.dataset.zone) === zone)); haptic('tap'); return; }
      const d = e.target.closest('[data-day]');
      if (d) { day = Number(d.dataset.day); for (const b of el.querySelectorAll('[data-day]')) b.setAttribute('aria-pressed', String(b === d)); haptic('tap'); return; }
      if (e.target.closest('[data-k=save]')) {
        minutes = parseNumber(minIn.value) ?? minutes;
        const km = hasDistance ? readKm(el.querySelector('#ckm')) : null;
        const durationSec = Math.round(minutes * 60);
        const check = validateCardio({ type, durationSec, distanceKm: km, zone });
        if (!check.ok || (hasDistance && el.querySelector('#ckm').value.trim() && km == null)) { el.querySelector('#cerr').textContent = t('cardio.invalid.' + (check.error || 'distance')); haptic('error'); return; }
        const end = day ? (() => { const x = new Date(); x.setDate(x.getDate() - 1); x.setHours(18, 0, 0, 0); return x.getTime(); })() : Date.now();
        const session = makeCardioSession({ type, startedAt: end - durationSec * 1000, durationSec, distanceKm: km, zone });
        e.target.closest('button').disabled = true;
        await closeTop();
        const saved = await store.addCardio(session);
        haptic('success');
        toast({ title: `${esc(cardioName(type, lang))} <span class="v">${esc(durTxt(durationSec))}</span>`, sub: saved.records?.length ? saved.records.map(r => t('cardio.record.' + r)).join(' · ') : t('cardio.saved'), action: t('common.undo'), onAction: () => store.deleteCardio(saved.id) });
      }
    });
  }, { label: t('cardio.logPast') });
}

// ---------- detail ----------

export function renderCardioDetail(root, id) {
  const { t, lang } = state;
  const c = state.cardio.find(x => x.id === id);
  if (!c) { root.innerHTML = `<header class="top"><button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button><span class="spacer"></span></header>`; return; }
  const m = cardioType(c.type).metric;
  const pace = paceText(c, lang);
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${esc(cardioName(c.type, lang))}</strong><span>${esc(dayLong(c.startedAt, lang).split(' ').slice(0, 3).join(' '))}</span></div>
      <span class="spacer"></span>
    </header>
    <div class="cdhead"><span class="ctypeicon big">${cardioIcon(c.type)}</span><div><h1 class="h1">${esc(cardioName(c.type, lang))}</h1>
      <p class="detail-date">${esc(dayLong(c.startedAt, lang))} · ${esc(time(c.startedAt, lang))}</p></div></div>
    <div class="summary glass">
      <div><b>${esc(durTxt(c.durationSec))}</b><span>${t('cardio.duration')}</span></div>
      <div><b>${c.distanceKm ? esc(num(c.distanceKm, lang, 2)) : '–'}</b><span>km</span></div>
      <div><b>${pace ? esc(pace.split(' ')[0]) : '–'}</b><span>${m === 'speed' ? (lang === 'da' ? 'km/t' : 'km/h') : pace ? esc(pace.split(' ').slice(1).join(' ')) : t('cardio.pace')}</span></div>
    </div>
    ${c.zone ? `<div class="card solid czone"><span class="zone z${c.zone} on"><b>${c.zone}</b></span><span><strong>${t('cardio.zone', { n: c.zone })} · ${t('cardio.zoneName.' + c.zone)}</strong></span></div>` : ''}
    ${c.records?.length ? `<div class="prs solid"><span class="tag">${t('history.newPrs')}</span><ul>${c.records.map(r => `<li><span><b>${t('cardio.record.' + r)}</b></span><span class="v">${esc(r === 'distance' ? kmTxt(c.distanceKm) : r === 'duration' ? durTxt(c.durationSec) : pace)}</span></li>`).join('')}</ul></div>` : ''}
    <div class="row2" style="grid-template-columns:1fr"><button class="btn2 solid danger" data-cardio="delete" data-id="${esc(c.id)}">${I.trash}<span>${t('cardio.delete')}</span></button></div>`;
}

export function initCardio() {
  document.getElementById('app').addEventListener('click', e => {
    const b = e.target.closest('[data-cardio]');
    if (!b) return;
    const k = b.dataset.cardio;
    const { t } = state;
    if (k === 'start') startCardioSession(b.dataset.type);
    else if (k === 'more') pickTypeSheet({ onPick: startCardioSession });
    else if (k === 'log') logSheet();
    else if (k === 'pause') { store.toggleCardioPause(); haptic('tap'); }
    else if (k === 'finish') finishSheet();
    else if (k === 'delete') {
      openSheet(el => {
        el.insertAdjacentHTML('beforeend', `<h2>${t('cardio.deleteTitle')}</h2><p class="lead">${t('discard.body')}</p>
          <div class="acts"><button class="btn2 solid danger" data-d="yes">${I.trash}<span>${t('common.delete')}</span></button><button class="btn2 solid" data-d="no">${t('common.cancel')}</button></div>`);
        el.querySelector('[data-d=no]').onclick = () => closeTop();
        el.querySelector('[data-d=yes]').onclick = async () => { await closeTop(); await store.deleteCardio(b.dataset.id); toast({ title: esc(t('cardio.deleted')) }); history.back(); };
      });
    }
  });
}

