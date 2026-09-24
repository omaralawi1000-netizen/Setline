// Body screen: bodyweight trend, measurements, and progress photos (on this phone only) with a
// before/after slider.
import * as store from '../store.js';
import { state } from '../store.js';
import { bodyTrend, dateKey } from '../body.js';
import { SITES, POSES, measureSummary, photoDays, comparePair, validCm, monthlyPair, changeBetween } from '../measures.js';
import { getKey } from '../keys.js';
import { toDisplay } from '../units.js';
import { parseNumber } from '../units.js';
import { weight, day } from '../format.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { lineChart } from './charts.js';

let site = 'waist';
const urls = new Map(); // photo id → object URL for the full image

const cm = (v, lang) => new Intl.NumberFormat(lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 1 }).format(v);
const u = () => state.t(`unit.${state.settings.unit}`);

// This month, side by side: the latest photo and the one from about a month before, with what the
// scale and the tape say changed in between. Numbers only go to the Coach; photos stay here.
export function monthly() {
  const pair = monthlyPair(state.photos);
  if (!pair) return null;
  return { ...pair, change: changeBetween(state.bodyweight, state.measures, pair.before.date, pair.after.date) };
}
const signed = (v, f) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${f(Math.abs(v))}`;
function monthHTML(m) {
  const { t, lang } = state;
  const unit = state.settings.unit;
  const stats = [
    m.change.kg ? `<div><b class="${m.change.kg.change < 0 ? 'down' : m.change.kg.change > 0 ? 'up' : ''}">${signed(toDisplay(m.change.kg.change, unit), v => weight(v, 'kg', lang))}</b><span>${t('body.weight')}, ${u()}</span></div>` : '',
    m.change.waist ? `<div><b class="${m.change.waist.change < 0 ? 'down' : m.change.waist.change > 0 ? 'up' : ''}">${signed(m.change.waist.change, v => cm(v, lang))}</b><span>${t('site.waist')}, cm</span></div>` : '',
    `<div><b>${m.days}</b><span>${t('month.days')}</span></div>`
  ].join('');
  return `<div class="mcard solid" data-part="month"><div class="chead"><span class="label">${t('month.title')}</span><span class="cval">${t('pose.' + m.after.pose)}</span></div>
    <button class="mpair" data-bx="month" aria-label="${t('bodyx.compare')}">
      <figure><img src="${esc(m.before.thumb)}" alt=""><figcaption>${esc(day(m.before.t, lang))}</figcaption></figure>
      <figure><img src="${esc(m.after.thumb)}" alt=""><figcaption>${esc(day(m.after.t, lang))}</figcaption></figure></button>
    <div class="mstats">${stats}</div>
    ${getKey('google') ? `<button class="btn2 soft" data-month="coach">${I.chat}<span>${t('month.ask')}</span></button>` : ''}
    ${m.change.waist ? '' : `<p class="bnote">${t('month.noWaist')}</p>`}</div>`;
}

export function renderBody(root) {
  const { t, lang } = state;
  const bw = bodyTrend(state.bodyweight);
  const sum = measureSummary(state.measures);
  const cur = sum.find(s => s.site === site);
  const days = photoDays(state.photos);
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${t('bodyx.title')}</strong></div><span class="spacer"></span>
    </header>
    <h1 class="h1">${t('bodyx.title')}</h1>

    <div class="chartcard solid">
      <div class="chead"><span class="label">${t('body.weight')}</span>${bw ? `<span class="cval"><b>${esc(weight(bw.latest.kg, state.settings.unit, lang))}</b> ${u()}</span>` : ''}</div>
      ${bw && state.bodyweight.length >= 2 ? lineChart(state.bodyweight.slice(-60).map(e => ({ t: Date.parse(e.date), v: e.kg })), { h: 120, fmt: v => weight(v, state.settings.unit, lang) }) : `<p class="bnote">${t('body.noWeight')}</p>`}
      <button class="btn2 solid" data-body="weight">${I.plus}<span>${t('body.logTitle')}</span></button>
    </div>

    <div class="section"><span class="label">${t('bodyx.measures')}</span><button class="textbtn" data-bx="measure">${t('bodyx.log')}</button></div>
    <div class="msites">${sum.map((s, i) => `<button class="msite solid${s.site === site ? ' on' : ''}" data-bx="site" data-site="${s.site}" style="--i:${i}">
      <span class="label">${t('site.' + s.site)}</span>
      <b>${s.latest != null ? `${cm(s.latest, lang)}<small> cm</small>` : '–'}</b>
      ${s.change ? `<span class="delta ${s.change < 0 ? 'down' : 'up'}">${s.change > 0 ? '+' : '−'}${cm(Math.abs(s.change), lang)}</span>` : '<span class="delta">&nbsp;</span>'}
    </button>`).join('')}</div>
    ${cur?.series?.length >= 2 ? `<div class="chartcard solid"><div class="chead"><span class="label">${t('site.' + site)}</span></div>${lineChart(cur.series, { h: 110, fmt: v => `${cm(v, lang)}` })}</div>` : ''}

    ${(m => (m ? monthHTML(m) : ''))(monthly())}
    <div class="section"><span class="label">${t('bodyx.photos')}</span>${days.length > 1 || state.photos.length > 1 ? `<button class="textbtn" data-bx="compare">${t('bodyx.compare')}</button>` : ''}</div>
    <div class="row2 one"><button class="log" data-bx="add">${I.camera}<span>${t('bodyx.add')}</span></button></div>
    ${days.length ? days.map(d => `<div class="phday"><span class="pdate">${esc(day(Date.parse(d.date), lang))}</span>
      <div class="pgrid">${d.photos.map((p, i) => `<button class="pthumb" data-bx="view" data-id="${esc(p.id)}" style="--i:${i}"><img src="${esc(p.thumb)}" alt="" loading="lazy"><span>${t('pose.' + p.pose)}</span></button>`).join('')}</div></div>`).join('')
      : `<div class="empty solid"><div class="emptyglyph">${I.camera}</div><h2>${t('bodyx.noPhotos')}</h2><p>${t('bodyx.noPhotosSub')}</p></div>`}
    <p class="snote center">${t('bodyx.private')}</p>`;
}

// ---------- measurements ----------

function measureSheet() {
  const { t, lang } = state;
  const last = Object.fromEntries(measureSummary(state.measures).map(s => [s.site, s.latest]));
  const today = state.measures.find(m => m.date === dateKey()) || {};
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody"><h2>${t('bodyx.measures')}</h2><p class="lead">${t('bodyx.measureSub')}</p>
      <div class="mform">${SITES.map(s => `<label class="mfield"><span>${t('site.' + s)}</span><input inputmode="decimal" data-site="${s}" value="${today[s] != null ? cm(today[s], lang) : ''}" placeholder="${last[s] != null ? cm(last[s], lang) : '–'}" autocomplete="off"><em>cm</em></label>`).join('')}</div>
      <div class="err" id="merr"></div>
      <div class="acts"><button class="log" data-k="save">${I.check}<span>${t('common.save')}</span></button></div></div>`);
    el.querySelector('[data-k=save]').onclick = async () => {
      const patch = {};
      for (const inp of el.querySelectorAll('[data-site]')) {
        if (!inp.value.trim()) continue;
        const v = parseNumber(inp.value);
        if (!validCm(v)) { el.querySelector('#merr').textContent = t('bodyx.invalid', { site: t('site.' + inp.dataset.site) }); haptic('error'); return; }
        patch[inp.dataset.site] = v;
      }
      if (!Object.keys(patch).length) return closeTop();
      await closeTop();
      await store.saveMeasures(patch);
      haptic('success');
      toast({ title: esc(t('bodyx.saved')) });
    };
  }, { label: t('bodyx.measures') });
}

// ---------- photos ----------

async function loadImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
function canvasOf(src, max) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function addSheet() {
  const { t } = state;
  let pose = 'front';
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody"><h2>${t('bodyx.add')}</h2><p class="lead">${t('bodyx.addSub')}</p>
      <div class="field"><label>${t('bodyx.pose')}</label><div class="opts">${POSES.map(p => `<button class="chip" data-pose="${p}" aria-pressed="${p === pose}">${t('pose.' + p)}</button>`).join('')}</div></div>
      <div class="mpick">
        <label class="mbig glass">${I.camera}<span>${t('meal.photo')}</span><input type="file" accept="image/*" capture="user" hidden data-file></label>
        <label class="mbig solid">${I.image}<span>${t('meal.gallery')}</span><input type="file" accept="image/*" hidden data-file></label>
      </div></div>`);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-pose]');
      if (!b) return;
      pose = b.dataset.pose;
      for (const x of el.querySelectorAll('[data-pose]')) x.setAttribute('aria-pressed', String(x === b));
      haptic('tap');
    });
    el.addEventListener('change', async e => {
      const f = e.target.closest('[data-file]')?.files?.[0];
      if (!f) return;
      try {
        const bmp = await loadImage(f);
        const blob = await new Promise(res => canvasOf(bmp, 1440).toBlob(res, 'image/jpeg', 0.86));
        const thumb = canvasOf(bmp, 320).toDataURL('image/jpeg', 0.75);
        bmp.close?.();
        await closeTop();
        await store.addPhoto({ id: 'p-' + crypto.randomUUID(), date: dateKey(), pose, t: Date.now(), thumb, blob });
        haptic('success');
        toast({ title: esc(t('bodyx.photoSaved')) });
      } catch { haptic('error'); toast({ title: esc(t('meal.failed')), error: true }); }
    });
  }, { label: t('bodyx.add') });
}

const fullUrl = p => { if (!p.blob) return p.thumb; if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob)); return urls.get(p.id); };

function viewSheet(id) {
  const { t, lang } = state;
  const p = state.photos.find(x => x.id === id);
  if (!p) return;
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody"><div class="pview"><img src="${esc(fullUrl(p))}" alt=""></div>
      <p class="lead center">${esc(day(p.t, lang))} · ${t('pose.' + p.pose)}</p>
      <div class="acts"><button class="btn2 solid danger" data-k="del">${I.trash}<span>${t('common.delete')}</span></button></div></div>`);
    el.querySelector('[data-k=del]').onclick = async () => {
      await closeTop();
      await store.deletePhoto(id);
      if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
      haptic('tap');
      toast({ title: esc(t('bodyx.photoDeleted')) });
    };
  }, { label: t('bodyx.photos') });
}

// Before/after: the newer photo sits on top and is revealed by dragging the handle.
function compareSheet(given = null) {
  const { t, lang } = state;
  const pair = given || comparePair(state.photos);
  if (!pair) return;
  let [a, b] = pair;
  const sorted = [...state.photos].sort((x, y) => x.t - y.t);
  openSheet(el => {
    const paint = () => {
      el.querySelector('.cmp').innerHTML = `<img class="ca" src="${esc(fullUrl(a))}" alt=""><img class="cb" src="${esc(fullUrl(b))}" alt="">
        <span class="ctag l">${esc(day(a.t, lang))}</span><span class="ctag r">${esc(day(b.t, lang))}</span><span class="chandle"><i></i></span>`;
      set(0.5);
    };
    el.insertAdjacentHTML('beforeend', `<div class="sbody"><h2>${t('bodyx.compare')}</h2>
      <div class="cmp" style="--x:.5"></div>
      <div class="field"><label>${t('bodyx.before')}</label><div class="cpick">${sorted.map(p => `<button class="cpt" data-side="a" data-id="${esc(p.id)}" aria-pressed="${p.id === a.id}"><img src="${esc(p.thumb)}" alt=""></button>`).join('')}</div></div>
      <div class="field"><label>${t('bodyx.after')}</label><div class="cpick">${sorted.map(p => `<button class="cpt" data-side="b" data-id="${esc(p.id)}" aria-pressed="${p.id === b.id}"><img src="${esc(p.thumb)}" alt=""></button>`).join('')}</div></div></div>`);
    const box = el.querySelector('.cmp');
    const set = x => { box.style.setProperty('--x', Math.max(0, Math.min(1, x)).toFixed(4)); };
    paint();
    let drag = false;
    const move = e => { const r = box.getBoundingClientRect(); set((e.clientX - r.left) / r.width); };
    box.addEventListener('pointerdown', e => { drag = true; box.setPointerCapture(e.pointerId); move(e); });
    box.addEventListener('pointermove', e => { if (drag) move(e); });
    box.addEventListener('pointerup', () => { drag = false; haptic('tap'); });
    box.addEventListener('pointercancel', () => { drag = false; });
    el.addEventListener('click', e => {
      const c = e.target.closest('[data-side]');
      if (!c) return;
      const p = state.photos.find(x => x.id === c.dataset.id);
      if (c.dataset.side === 'a') a = p; else b = p;
      for (const x of el.querySelectorAll(`[data-side=${c.dataset.side}]`)) x.setAttribute('aria-pressed', String(x === c));
      haptic('tap');
      paint();
    });
  }, { label: t('bodyx.compare') });
}

export function initBodyScreen(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-bx]');
    if (!b) return;
    const k = b.dataset.bx;
    if (k === 'site') { site = b.dataset.site; haptic('tap'); renderBody(root); }
    else if (k === 'measure') measureSheet();
    else if (k === 'add') addSheet();
    else if (k === 'view') viewSheet(b.dataset.id);
    else if (k === 'compare') compareSheet();
    else if (k === 'month') { const m = monthly(); if (m) { haptic('tap'); compareSheet([m.before, m.after]); } }
  });
}
