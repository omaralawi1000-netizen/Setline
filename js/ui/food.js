// Food: today's calories and macros against targets, everything eaten by meal, water, the week.
// Numbers, rings and bars glide from what they showed before; new meals arrive with a glow;
// removed ones fold away.
import * as store from '../store.js';
import { state } from '../store.js';
import { dateKey, bodyTrend } from '../body.js';
import { autoTargets, targetsFor, dayTotals, bySlot, weekOf, SLOTS, GLASS_ML, slotOf, TARGET_LIMITS, sanitizeQuick, adaptiveMaintenance, goalCalories, syncTargets } from '../nutrition.js';
import { foodOrderOf } from '../settings.js';
import { addProteinQuick } from './body.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { openMealSheet, favRowHTML, toggleStar } from './meal.js';
import { openScanner, scanIcon } from './scan.js';
import { openFoodSearch } from './foodsearch.js';
import { talkNow } from './voice.js';
import { mealKey, makeTemplate, templateTotals, usualMeals } from '../meals.js';
import { openFoodCustomize } from './customize.js';

const view = { date: null };
const prev = new Map();     // what the ring, bars and numbers showed last time, by date
const known = new Map();    // meal ids already on screen, by date (new ones arrive with a glow)
const R = 54, C = 2 * Math.PI * R;

const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const nf = () => new Intl.NumberFormat(state.lang === 'da' ? 'da-DK' : 'en-GB');

export function foodTargets() {
  const tr = bodyTrend(state.bodyweight);
  const auto = autoTargets({ profile: state.settings.profile, bodyweightKg: tr?.latest.kg, proteinPerKg: state.settings.proteinPerKg });
  return targetsFor(auto, state.settings.foodTargets);
}

const dayLabel = date => {
  const { t, lang } = state;
  const today = dateKey();
  if (date === today) return t('food.today');
  const y = new Date(Date.now() - 86_400_000);
  if (date === dateKey(y.getTime())) return t('food.yesterday');
  return new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(date + 'T12:00'));
};
const shiftDate = (date, d) => { const x = new Date(date + 'T12:00'); x.setDate(x.getDate() + d); return dateKey(x.getTime()); };

// Foods logged together sit under one line with the meal's total; each keeps its own row and calories.
function groupedRows(list, row) {
  const { t } = state;
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const m = list[i], g = m.group;
    if (g && list[i - 1]?.group !== g) {
      const all = list.filter(x => x.group === g);
      if (all.length > 1) {
        const k = all.reduce((a, x) => a + x.kcal, 0), p = all.reduce((a, x) => a + x.protein, 0);
        const at = new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(m.t || Date.now());
        out += `<li class="fgroup"><span>${esc(t('food.together', { n: all.length, time: at }))}</span><b>${nf().format(k)} kcal · ${p} g</b></li>`;
      }
    }
    out += row(m).replace('<li class="frow', `<li class="frow${g && list.filter(x => x.group === g).length > 1 ? ' ingroup' : ''}`);
  }
  return out;
}

function mealRowHTML(m, fresh, i) {
  const { t } = state;
  return `<li class="frow${fresh ? ' fresh' : ''}" data-meal="${esc(m.id)}" style="--i:${i}">
    <button class="fmain" data-f="meal" data-id="${esc(m.id)}">
      ${m.thumb ? `<img class="fthumb" src="${esc(m.thumb)}" alt="">` : `<span class="fthumb ic">${m.source === 'barcode' ? scanIcon : I.meal}</span>`}
      <span class="l"><strong>${esc(m.name)}</strong><small class="fml"><i class="p">P</i> ${m.protein} g <i class="c">C</i> ${m.carbs || 0} g <i class="f">F</i> ${m.fat || 0} g</small></span>
      <b class="fk">${nf().format(m.kcal)}<small>kcal</small></b>
    </button></li>`;
}

const BOOKMARK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V5.5a1 1 0 0 1 1-1z"/></svg>';
const STACK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3.5 8.5 12 13l8.5-4.5z"/><path d="M3.5 12.5 12 17l8.5-4.5M3.5 16 12 20.5 20.5 16"/></svg>';

// Yesterday's meals for the slots you haven't eaten yet today: one tap and they're in.
function repeatHTML(slots) {
  const { t } = state;
  const y = state.nutrition.find(e => e.date === shiftDate(dateKey(), -1));
  if (!y?.meals?.length) return '';
  const ys = bySlot(y);
  const hour = new Date().getHours();
  const due = SLOTS.filter(s => ys[s].length && !slots[s].length && (s === 'snack' || SLOTS.indexOf(s) <= (hour < 11 ? 0 : hour < 16 ? 1 : 2) + 1));
  if (!due.length) return '';
  return `<div class="frepeat">${due.slice(0, 2).map((s, i) => {
    const k = ys[s].reduce((a, m) => a + m.kcal, 0);
    return `<button class="frep solid" data-f="repeat" data-slot="${s}" style="--i:${i}"><span class="fri">${I.undo}</span>
      <span class="l"><strong>${esc(t('tpl.repeat', { slot: t('food.slot.' + s).toLowerCase() }))}</strong><small>${esc(ys[s].map(m => m.name).join(', '))}</small></span><b>${nf().format(k)}<small>kcal</small></b></button>`;
  }).join('')}</div>`;
}

// Saved meals first in the favourites row, then your usuals: the same foods together that you keep
// eating (found from the last 30 days, not saved by hand), one tap each.
function templatesHTML() {
  const { t } = state;
  const list = state.settings.mealTemplates || [];
  const same = (x, u) => x.items.length === u.items.length && x.items.every(i => u.items.some(j => j.name.toLowerCase() === i.name.toLowerCase()));
  const usual = usualMeals(state.nutrition).filter(u => !list.some(x => same(x, u)));
  if (!list.length && !usual.length) return '';
  return `<div class="section"><span class="label">${t(list.length ? 'tpl.title' : 'tpl.usuals')}</span></div><div class="favrow tplrow">${list.map((x, i) => {
    const tt = templateTotals(x);
    return `<button class="favchip tpl solid" data-f="tpl" data-id="${esc(x.id)}" style="--i:${i}"><span class="fi">${STACK}</span><span class="fn">${esc(x.name)}</span><b>${nf().format(tt.kcal)} kcal</b></button>`;
  }).join('')}${usual.map((u, i) => `<button class="favchip tpl usual solid" data-f="usual" data-key="${esc(u.key)}" style="--i:${list.length + i}" title="${esc(u.items.map(x => x.name).join(', '))}"><span class="fi">${I.undo}</span><span class="fn">${esc(t('tpl.usual', { slot: t('food.slot.' + u.slot).toLowerCase() }))}<small>${esc(u.items.map(x => x.name.split(/[,(]/)[0].trim()).join(', '))}</small></span><b>${nf().format(u.kcal)} kcal</b></button>`).join('')}</div>`;
}

async function logMany(meals, title, slot) {
  const { t } = state;
  const logged = await store.logMeals(meals.map(m => ({ name: m.name, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, source: m.source, ...(slot ? { slot } : {}) })));
  const k = logged.reduce((a, m) => a + m.kcal, 0), p = logged.reduce((a, m) => a + m.protein, 0);
  haptic('success');
  toast({ title: `${esc(title)} <span class="v">${nf().format(k)} kcal</span>`, sub: `${p} g ${t('food.protein').toLowerCase()}`, action: t('common.undo'), ms: 5000, onAction: () => store.deleteMeals(logged.map(m => m.id)) });
}

export function renderFood(root) {
  const { t } = state;
  const today = dateKey();
  const date = view.date && view.date <= today ? view.date : today;
  view.date = date;
  const entry = state.nutrition.find(e => e.date === date);
  const tot = dayTotals(entry);
  const tg = foodTargets();
  const left = tg.kcal - tot.kcal;
  const was = prev.get(date) || { kcal: 0, protein: 0, carbs: 0, fat: 0, left: tg.kcal, water: 0 };
  const seen = known.get(date) || null;
  const pct = v => Math.max(0, Math.min(1, v));
  const macro = (k, cls) => `<div class="fmac ${cls}"><div class="fmh"><span>${t('food.' + k)}</span><b><span data-fcount="${k}" data-from="${Math.round(was[k])}" data-to="${Math.round(tot[k])}">${nf().format(Math.round(was[k]))}</span><small> / ${tg[k]} g</small></b></div>
      <i class="fbar"><i data-fbar="${k}" style="transform:scaleX(${pct(was[k] / tg[k]).toFixed(4)})" data-to="${pct(tot[k] / tg[k]).toFixed(4)}"></i></i></div>`;
  const slots = bySlot(entry);
  const anyMeals = SLOTS.some(s => slots[s].length);
  let idx = 0;
  const glasses = Math.round(tg.water / GLASS_ML), full = Math.round(tot.water / GLASS_ML);
  const week = weekOf(state.nutrition, today);
  const maxK = Math.max(tg.kcal * 1.25, ...week.map(d => d.kcal));
  const isToday = date === today;
  const hide = new Set(state.settings.foodHide || []), on = k => !hide.has(k);
  const cal = on('calories');
  // the ring: calories, or protein when calories are switched off
  const ringWas = cal ? was.kcal / tg.kcal : was.protein / tg.protein, ringNow = cal ? tot.kcal / tg.kcal : tot.protein / tg.protein;
  const ringLeft = cal ? left : tg.protein - tot.protein, ringOver = ringLeft < 0;

  // the sections under the ring, in your order (Food → Customize)
  const qa = sanitizeQuick(state.settings.quickAdd);
  const part = {
    favourites: () => (on('favourites') && isToday ? templatesHTML() + favRowHTML(10) : ''),
    quickProtein: () => (on('quickProtein') && isToday ? `<div class="fqp"><span>${t(qa.kind === 'kcal' ? 'food.quickKcal' : 'food.quickProtein')}</span>${qa.values.map(v => `<button class="chip" data-f="quick" data-kind="${qa.kind}" data-v="${v}">+${v}${qa.kind === 'kcal' ? '' : ' g'}</button>`).join('')}</div>` : ''),
    water: () => (on('water') ? `<div class="fwrow solid"><span class="fwi">${I.drop}</span>
      <span class="l"><strong>${t('food.water')}<small>${(tot.water / 1000).toLocaleString(state.lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 2 })} / ${(tg.water / 1000).toLocaleString(state.lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 1 })} L</small></strong>
      <i class="fwbar"><i style="transform:scaleX(${Math.min(1, tot.water / tg.water).toFixed(3)})"></i></i></span>
      <button class="step" data-f="water" data-n="${Math.max(0, full - 1)}" aria-label="−${GLASS_ML} ml" ${full ? '' : 'disabled'}>−</button><button class="step plus" data-f="water" data-n="${full + 1}" aria-label="+${GLASS_ML} ml">+</button></div>` : ''),
    meals: () => (isToday ? repeatHTML(slots) : '') + (anyMeals ? SLOTS.filter(s => slots[s].length).map(s => {
      const k = slots[s].reduce((a, m) => a + m.kcal, 0);
      const saved = (state.settings.mealTemplates || []).some(x => x.slot === s && x.items.length === slots[s].length && x.items.every((it, j) => it.name === slots[s][j].name));
      return `<div class="section fslot"><span class="label">${t('food.slot.' + s)}</span><span class="fsk">${nf().format(k)} kcal${slots[s].length > 1 && !saved ? `<button class="fsave" data-f="savetpl" data-slot="${s}" aria-label="${esc(t('tpl.save'))}">${BOOKMARK}</button>` : ''}</span></div>
        <ul class="flist solid">${groupedRows(slots[s], m => mealRowHTML(m, seen && !seen.has(m.id), idx++))}</ul>`;
    }).join('') : isToday && repeatHTML(slots) ? '' : `<div class="fempty"><span class="fei">${I.meal}</span><strong>${t(isToday ? 'food.emptyToday' : 'food.emptyDay')}</strong><small>${t('food.emptySub')}</small></div>`) + (tot.quickProtein > 0 ? `<p class="fquick">${esc(t('food.quick', { g: tot.quickProtein }))}</p>` : ''),
    week: () => (on('week') ? `    <div class="section"><span class="label">${t('food.week')}</span><span class="fwl">${esc(t('food.avg', { k: nf().format(Math.round(week.filter(d => d.kcal).reduce((a, d) => a + d.kcal, 0) / Math.max(1, week.filter(d => d.kcal).length))) }))}</span></div>
    <div class="fweek solid">
      <i class="ftarget" style="bottom:${(tg.kcal / maxK * 100).toFixed(1)}%"></i>
      ${week.map((d, i) => `<button class="fwd${d.date === date ? ' on' : ''}" data-f="goto" data-date="${d.date}" style="--i:${i}">
        <i class="fwb${d.kcal > tg.kcal * 1.08 ? ' hi' : ''}" style="--h:${(d.kcal / maxK).toFixed(3)}"></i>
        ${d.protein ? `<i class="fwp" style="--p:${Math.min(1, d.protein / tg.protein).toFixed(3)}"></i>` : ''}
        <span>${esc(new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'narrow' }).format(new Date(d.date + 'T12:00')))}</span></button>`).join('')}
    </div>` : '')
  };
  root.innerHTML = `<div class="tabtop"></div>
    <div class="fdayrow"><h1 class="h1 tabh">${t('food.title')}</h1>
      <div class="fday"><button class="iconbtn sm" data-f="day" data-d="-1" aria-label="${t('food.prevDay')}">${I.back}</button><span>${esc(dayLabel(date))}</span>
      <button class="iconbtn sm" data-f="day" data-d="1" aria-label="${t('food.nextDay')}" ${isToday ? 'disabled' : ''}>${I.fwd}</button></div></div>

    <button class="fhero solid${cal ? '' : ' pring-mode'}" data-f="targets" aria-label="${esc(t('food.targets'))}">
      <div class="fring"><svg viewBox="0 0 128 128" aria-hidden="true"><circle class="bg" cx="64" cy="64" r="${R}"/>
        <circle class="fg${ringOver ? ' over' : ''}" cx="64" cy="64" r="${R}" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - pct(ringWas))).toFixed(1)}" data-to="${(C * (1 - pct(ringNow))).toFixed(1)}"/></svg>
        <div class="fcenter"><b data-fcount="left" data-from="${Math.round(Math.abs(cal ? was.left : tg.protein - was.protein))}" data-to="${Math.round(Math.abs(ringLeft))}">${nf().format(Math.round(Math.abs(cal ? was.left : tg.protein - was.protein)))}</b><span>${t(cal ? (left < 0 ? 'food.over' : 'food.left') : (ringLeft < 0 ? 'food.gOver' : 'food.gLeft'))}</span></div></div>
      <div class="fmacs">
        ${cal ? `<div class="featen"><span>${t('food.eaten')}</span><b><span data-fcount="kcal" data-from="${Math.round(was.kcal)}" data-to="${Math.round(tot.kcal)}">${nf().format(Math.round(was.kcal))}</span><small> / ${nf().format(tg.kcal)} kcal</small></b></div>` : `<div class="featen"><span>${t('food.protein')}</span><b>${nf().format(Math.round(tot.protein))}<small> / ${tg.protein} g</small></b></div>`}
        ${cal ? macro('protein', 'p') : ''}${on('carbs') ? macro('carbs', 'c') : ''}${on('fat') ? macro('fat', 'f') : ''}
      </div>
    </button>

    ${isToday ? `<div class="fadd">
      <button class="ftile" data-f="scan" style="--i:0">${scanIcon}<span>${t('food.scan')}</span></button>
      <button class="ftile" data-f="snap" style="--i:1">${I.camera}<span>${t('food.snap')}</span></button>
      <button class="ftile" data-f="say" style="--i:2">${I.mic}<span>${t('food.say')}</span></button>
      <button class="ftile" data-f="search" style="--i:3">${I.search}<span>${t('food.search')}</span></button>
    </div>` : `<button class="btn2 solid fback" data-f="today">${t('food.backToday')}</button>`}
    ${foodOrderOf(state.settings).map(k => part[k]()).join('')}
    <p class="fnote">${t(state.settings.foodTargets ? 'food.targetsCustom' : 'food.targetsAuto')}</p>
    <button class="custom" data-f="custom">${I.settings}<span>${t('cust.open')}</span></button>`;

  // glide from the old values to the new ones
  prev.set(date, { kcal: tot.kcal, protein: tot.protein, carbs: tot.carbs, fat: tot.fat, left, water: tot.water });
  known.set(date, new Set((entry?.meals || []).map(m => m.id)));
  const go = () => {
    root.querySelector('.fring .fg')?.style.setProperty('stroke-dashoffset', root.querySelector('.fring .fg').dataset.to);
    for (const b of root.querySelectorAll('[data-fbar]')) b.style.transform = `scaleX(${b.dataset.to})`;
    for (const n of root.querySelectorAll('[data-fcount]')) countBetween(n, Number(n.dataset.from), Number(n.dataset.to));
  };
  if (reduced()) go();
  else requestAnimationFrame(() => requestAnimationFrame(go));
}

function countBetween(el, from, to, ms = 900) {
  if (from === to || reduced()) { el.textContent = nf().format(to); return; }
  const t0 = performance.now(), ease = k => 1 - Math.pow(1 - k, 3);
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = nf().format(Math.round(from + (to - from) * ease(k)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- sheets ----------

function mealSheet(id) {
  const { t } = state;
  const date = view.date;
  const m = state.nutrition.find(e => e.date === date)?.meals?.find(x => x.id === id);
  if (!m) return;
  const starred = (state.settings.favMeals || []).some(x => mealKey(x) === mealKey(m.name));
  openSheet(el => {
    const paint = () => {
      const slot = slotOf(state.nutrition.find(e => e.date === date)?.meals?.find(x => x.id === id) || m);
      el.innerHTML = `<div class="sbody fsheet">
        ${m.thumb ? `<img class="fphoto" src="${esc(m.thumb)}" alt="">` : ''}
        <h2>${esc(m.name)}</h2>
        <div class="fbig"><div><b>${nf().format(m.kcal)}</b><span>kcal</span></div><div class="p"><b>${m.protein}</b><span>${t('food.protein')}</span></div><div class="c"><b>${m.carbs || 0}</b><span>${t('food.carbs')}</span></div><div class="f"><b>${m.fat || 0}</b><span>${t('food.fat')}</span></div></div>
        <div class="field"><label>${t('food.meal')}</label><div class="opts">${SLOTS.map(s => `<button class="chip" data-fs="slot" data-v="${s}" aria-pressed="${s === slot}">${t('food.slot.' + s)}</button>`).join('')}</div></div>
        <button class="btn2 solid wide fedit" data-fs="edit">${I.pen}<span>${t('food.edit')}</span></button>
        <div class="acts row3">
          <button class="btn2 solid" data-fs="again">${I.plus}<span>${t('food.again')}</span></button>
          <button class="btn2 solid${starred ? ' on' : ''}" data-fs="star">${I.flame}<span>${t(starred ? 'food.starred' : 'food.star')}</span></button>
          <button class="btn2 solid danger" data-fs="del">${I.trash}<span>${t('food.delete')}</span></button>
        </div></div>`;
    };
    paint();
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-fs]');
      if (!b) return;
      const k = b.dataset.fs;
      haptic('tap');
      if (k === 'slot') { await store.moveMeal(id, b.dataset.v, date); paint(); return; }
      if (k === 'edit') { await closeTop(); editSheet(id, date); return; }
      if (k === 'star') { toggleStar(m.name); await closeTop(); return; }
      if (k === 'again') {
        await closeTop();
        await store.logMeal({ name: m.name, protein: m.protein, kcal: m.kcal, carbs: m.carbs, fat: m.fat, source: m.source, thumb: m.thumb });
        haptic('success');
        return;
      }
      if (k === 'del') { await closeTop(); removeWithFold(id, date, m); }
    });
  }, { label: m.name });
}

// the row folds away, then the meal goes (with undo)
// Fix an estimate: the numbers one by one, or the whole portion at once.
function editSheet(id, date) {
  const { t } = state;
  const m = state.nutrition.find(e => e.date === date)?.meals?.find(x => x.id === id);
  if (!m) return;
  const base = { kcal: m.kcal, protein: m.protein, carbs: m.carbs || 0, fat: m.fat || 0 };
  const f = { ...base, name: m.name, portion: 1 };
  const STEP = { kcal: 10, protein: 1, carbs: 1, fat: 1 };
  openSheet(el => {
    const paint = () => {
      el.innerHTML = `<div class="sbody"><h2>${t('food.edit')}</h2>
        <div class="field"><label>${t('food.name')}</label><input class="rname" data-fe="name" value="${esc(f.name)}" maxlength="60" autocomplete="off"></div>
        <div class="field"><label>${t('food.portion')}</label><div class="opts">${[0.5, 0.75, 1, 1.25, 1.5, 2].map(p => `<button class="chip" data-fe="portion" data-v="${p}" aria-pressed="${p === f.portion}">${p === 1 ? t('food.asLogged') : `× ${String(p).replace('.', state.lang === 'da' ? ',' : '.')}`}</button>`).join('')}</div></div>
        <div class="slist solid">${Object.keys(STEP).map(k => `<div class="srow"><span class="l"><strong>${t(k === 'kcal' ? 'food.t.kcal' : 'food.' + k)}</strong></span>
          <div class="stepper"><button class="step" data-fe="step" data-k="${k}" data-d="-1">−</button><b>${nf().format(f[k])}${k === 'kcal' ? '' : ' g'}</b><button class="step" data-fe="step" data-k="${k}" data-d="1">+</button></div></div>`).join('')}</div>
        <div class="acts"><button class="log" data-fe="save">${I.check}<span>${t('food.saveEdit')}</span></button></div></div>`;
    };
    paint();
    el.addEventListener('input', e => { if (e.target.dataset.fe === 'name') f.name = e.target.value; });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-fe]');
      if (!b || b.dataset.fe === 'name') return;
      haptic('tap');
      if (b.dataset.fe === 'portion') {
        f.portion = Number(b.dataset.v);
        for (const k of Object.keys(STEP)) f[k] = Math.round(base[k] * f.portion);
      } else if (b.dataset.fe === 'step') {
        const k = b.dataset.k, hold = k === 'kcal' ? 10 : 1;
        f[k] = Math.max(0, f[k] + Number(b.dataset.d) * (e.detail > 1 ? hold * 5 : STEP[k]));
      } else if (b.dataset.fe === 'save') {
        await store.updateMeal(id, { name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }, date);
        await closeTop();
        haptic('success');
        return toast({ title: esc(t('food.saved')), sub: `${f.kcal} kcal · ${f.protein} g`, action: t('common.undo'), onAction: () => store.updateMeal(id, { ...base, name: m.name }, date) });
      }
      paint();
    });
  }, { label: t('food.edit') });
}

function removeWithFold(id, date, m) {
  const row = document.querySelector(`#s-food [data-meal="${CSS.escape(id)}"]`);
  const done = async () => {
    await store.deleteMeal(id, date);
    toast({ title: esc(state.t('food.deleted', { name: m.name })), action: state.t('common.undo'), onAction: () => store.restoreMeal(m, date) });
  };
  if (!row || reduced()) return done();
  row.style.height = row.offsetHeight + 'px';
  void row.offsetHeight;
  row.classList.add('folding');
  row.style.height = '0px';
  setTimeout(done, 380);
}

function targetsSheet() {
  const { t } = state;
  const auto = autoTargets({ profile: state.settings.profile, bodyweightKg: bodyTrend(state.bodyweight)?.latest.kg, proteinPerKg: state.settings.proteinPerKg });
  const f = { ...foodTargets() };
  const STEP = { kcal: 50, protein: 5, carbs: 10, fat: 5, water: 250 };
  // what your own intake and scale say, once there's enough of both
  const real = adaptiveMaintenance(state.nutrition, state.bodyweight, dateKey());
  const realGoal = real ? goalCalories(real.maintenance, state.settings.profile?.goal) : null;
  openSheet(el => {
    const paint = changed => {
      const split = ['protein', 'carbs', 'fat'].map(m => Math.round((f[m] * (m === 'fat' ? 9 : 4)) / Math.max(1, f.kcal) * 100));
      el.innerHTML = `<div class="sbody"><h2>${t('food.targets')}</h2><p class="lead">${t('food.targetsLead')}</p>
        ${real ? `<div class="freal solid"><strong>${esc(t('food.realTitle', { k: nf().format(real.maintenance) }))}</strong>
          <span>${esc(t('food.realSub', { days: real.days, intake: nf().format(real.intake), sign: real.kgPerWeek > 0 ? '+' : real.kgPerWeek < 0 ? '−' : '±', kg: Math.abs(real.kgPerWeek).toLocaleString(state.lang === 'da' ? 'da-DK' : 'en-GB') }))}</span>
          <button class="btn2 solid" data-ft="real">${esc(t('food.useReal', { k: nf().format(realGoal) }))}</button></div>`
        : `<p class="snote">${t('food.realLater')}</p>`}
        <div class="slist solid">${Object.keys(STEP).map(k => `<div class="srow"><span class="l"><strong>${t('food.t.' + k)}</strong><small>${esc(t('food.autoIs', { v: `${nf().format(auto[k])} ${k === 'kcal' ? 'kcal' : k === 'water' ? 'ml' : 'g'}` }))}</small></span>
          <div class="stepper"><button class="step" data-ft="-" data-k="${k}">−</button><b class="${changed && k !== changed && k !== 'water' ? 'synced' : ''}">${nf().format(f[k])}</b><button class="step" data-ft="+" data-k="${k}">+</button></div></div>`).join('')}</div>
        <div class="fsplit"><i class="p" style="flex:${split[0]}"></i><i class="c" style="flex:${split[1]}"></i><i class="f" style="flex:${split[2]}"></i></div>
        <p class="snote center">${esc(t('food.split', { p: split[0], c: split[1], f: split[2] }))}</p>
        <div class="acts"><button class="log" data-ft="save">${I.check}<span>${t('food.saveTargets')}</span></button>
          <button class="btn2 solid" data-ft="auto">${t('food.useAuto')}</button></div></div>`;
    };
    paint();
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-ft]');
      if (!b) return;
      haptic('tap');
      const k = b.dataset.k, v = b.dataset.ft;
      if (v === '+' || v === '-') {
        Object.assign(f, syncTargets(f, k, f[k] + (v === '+' ? 1 : -1) * STEP[k])); // calories and macros move together
        return paint(k);
      }
      if (v === 'real') { Object.assign(f, syncTargets(f, 'kcal', realGoal)); return paint('kcal'); }
      if (v === 'auto') store.setSettings({ foodTargets: null });
      else store.setSettings({ foodTargets: f });
      await closeTop();
    });
  }, { label: t('food.targets') });
}

// ---------- wiring ----------

export function openFoodDay(date = dateKey()) { view.date = date; }

export function initFood(root) {
  // long-press a saved meal to remove it
  root.addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-f=tpl]');
    if (!b) return;
    e.preventDefault();
    const x = (state.settings.mealTemplates || []).find(m => m.id === b.dataset.id);
    if (!x) return;
    haptic('tap');
    openSheet(el => {
      el.insertAdjacentHTML('beforeend', `<h2>${esc(x.name)}</h2><p class="lead">${esc(x.items.map(i => i.name).join(', '))}</p>
        <div class="acts"><button class="btn2 solid danger" data-k="del">${I.trash}<span>${state.t('tpl.remove')}</span></button><button class="btn2 solid" data-k="no">${state.t('common.cancel')}</button></div>`);
      el.querySelector('[data-k=no]').onclick = () => closeTop();
      el.querySelector('[data-k=del]').onclick = async () => { await closeTop(); store.setSettings({ mealTemplates: (state.settings.mealTemplates || []).filter(m => m.id !== x.id) }); };
    }, { label: x.name });
  });
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-f]');
    if (!b || b.disabled) return;
    const k = b.dataset.f;
    const t = state.t;
    haptic('tap');
    if (k === 'day') { view.date = shiftDate(view.date, Number(b.dataset.d)); slide(root, Number(b.dataset.d)); return renderFood(root); }
    if (k === 'goto') { const d = Number(new Date(b.dataset.date) > new Date(view.date)) || -1; view.date = b.dataset.date; slide(root, d); return renderFood(root); }
    if (k === 'today') { view.date = dateKey(); slide(root, 1); return renderFood(root); }
    if (k === 'quick') {
      const v = Number(b.dataset.v);
      if (b.dataset.kind === 'protein') return addProteinQuick(v);
      const meal = await store.logMeal({ name: state.t('food.quickName'), kcal: v, protein: 0, carbs: 0, fat: 0, source: 'text' });
      haptic('success');
      return toast({ title: `${esc(state.t('food.quickName'))} <span class="v">+${v} kcal</span>`, action: state.t('common.undo'), onAction: () => store.deleteMeal(meal.id), ms: 3000 });
    }
    if (k === 'repeat') {
      const y = state.nutrition.find(e => e.date === shiftDate(dateKey(), -1));
      const list = bySlot(y)[b.dataset.slot] || [];
      if (list.length) await logMany(list, t('food.slot.' + b.dataset.slot), b.dataset.slot);
      return;
    }
    if (k === 'usual') {
      const u = usualMeals(state.nutrition).find(x => x.key === b.dataset.key);
      if (u) { b.classList.add('logged'); await logMany(u.items, t('tpl.usual', { slot: t('food.slot.' + u.slot).toLowerCase() }), u.slot); }
      return;
    }
    if (k === 'tpl') {
      const x = (state.settings.mealTemplates || []).find(m => m.id === b.dataset.id);
      if (x) { b.classList.add('logged'); await logMany(x.items, x.name, x.slot || slotOf({ t: Date.now() })); }
      return;
    }
    if (k === 'savetpl') {
      const s = b.dataset.slot, list = bySlot(state.nutrition.find(e => e.date === view.date))[s] || [];
      const tpl = makeTemplate(`${t('food.slot.' + s)}: ${list.map(m => m.name.split(/[,(]/)[0].trim()).join(', ')}`.slice(0, 40), list, s);
      if (!tpl) return;
      store.setSettings({ mealTemplates: [tpl, ...(state.settings.mealTemplates || [])].slice(0, 24) });
      haptic('success');
      toast({ title: esc(t('tpl.saved')), sub: esc(tpl.name), action: t('common.undo'), onAction: () => store.setSettings({ mealTemplates: (state.settings.mealTemplates || []).filter(m => m.id !== tpl.id) }) });
      return;
    }
    if (k === 'targets') return targetsSheet();
    if (k === 'custom') return openFoodCustomize({ targets: targetsSheet });
    if (k === 'meal') return mealSheet(b.dataset.id);
    if (k === 'scan') return openScanner();
    if (k === 'snap') return openMealSheet();
    if (k === 'search') { openFoodSearch(); return; }
    if (k === 'type') { openMealSheet(); setTimeout(() => document.querySelector('.sheet.show .mdesc input')?.focus(), 420); return; }
    if (k === 'say') return talkNow();
    if (k === 'water') {
      const n = Number(b.dataset.n), cur = Math.round(dayTotals(state.nutrition.find(x => x.date === view.date)).water / GLASS_ML);
      const next = n === cur ? n - 1 : n; // tapping the last full glass empties it
      await store.logWater((next - cur) * GLASS_ML, view.date);
      if (next > cur) haptic('success');
    }
  });
}

// the day's content slides in from the side it came from
function slide(root, dir) {
  if (reduced()) return;
  root.classList.remove('fslide-l', 'fslide-r');
  void root.offsetWidth;
  root.classList.add(dir > 0 ? 'fslide-r' : 'fslide-l');
}
