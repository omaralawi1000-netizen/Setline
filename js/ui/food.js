// Food: today's calories and macros against targets, everything eaten by meal, water, the week.
// Numbers, rings and bars glide from what they showed before; new meals arrive with a glow;
// removed ones fold away.
import * as store from '../store.js';
import { state } from '../store.js';
import { dateKey, bodyTrend } from '../body.js';
import { autoTargets, targetsFor, dayTotals, bySlot, weekOf, SLOTS, GLASS_ML, slotOf, TARGET_LIMITS } from '../nutrition.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { openMealSheet, favRowHTML, toggleStar } from './meal.js';
import { openScanner, scanIcon } from './scan.js';
import { talkNow } from './voice.js';
import { mealKey } from '../meals.js';

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

function mealRowHTML(m, fresh, i) {
  const { t } = state;
  return `<li class="frow${fresh ? ' fresh' : ''}" data-meal="${esc(m.id)}" style="--i:${i}">
    <button class="fmain" data-f="meal" data-id="${esc(m.id)}">
      ${m.thumb ? `<img class="fthumb" src="${esc(m.thumb)}" alt="">` : `<span class="fthumb ic">${m.source === 'barcode' ? scanIcon : I.meal}</span>`}
      <span class="l"><strong>${esc(m.name)}</strong><small class="fml"><i class="p">P</i> ${m.protein} g <i class="c">C</i> ${m.carbs || 0} g <i class="f">F</i> ${m.fat || 0} g</small></span>
      <b class="fk">${nf().format(m.kcal)}<small>kcal</small></b>
    </button></li>`;
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

  root.innerHTML = `<div class="tabtop"></div>
    <div class="fdayrow"><h1 class="h1 tabh">${t('food.title')}</h1>
      <div class="fday"><button class="iconbtn sm" data-f="day" data-d="-1" aria-label="${t('food.prevDay')}">${I.back}</button><span>${esc(dayLabel(date))}</span>
      <button class="iconbtn sm" data-f="day" data-d="1" aria-label="${t('food.nextDay')}" ${isToday ? 'disabled' : ''}>${I.fwd}</button></div></div>

    <button class="fhero solid" data-f="targets" aria-label="${esc(t('food.targets'))}">
      <div class="fring"><svg viewBox="0 0 128 128" aria-hidden="true"><circle class="bg" cx="64" cy="64" r="${R}"/>
        <circle class="fg${left < 0 ? ' over' : ''}" cx="64" cy="64" r="${R}" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - pct(was.kcal / tg.kcal))).toFixed(1)}" data-to="${(C * (1 - pct(tot.kcal / tg.kcal))).toFixed(1)}"/></svg>
        <div class="fcenter"><b data-fcount="left" data-from="${Math.round(Math.abs(was.left))}" data-to="${Math.round(Math.abs(left))}">${nf().format(Math.round(Math.abs(was.left)))}</b><span>${t(left < 0 ? 'food.over' : 'food.left')}</span></div></div>
      <div class="fmacs">
        <div class="featen"><span>${t('food.eaten')}</span><b><span data-fcount="kcal" data-from="${Math.round(was.kcal)}" data-to="${Math.round(tot.kcal)}">${nf().format(Math.round(was.kcal))}</span><small> / ${nf().format(tg.kcal)} kcal</small></b></div>
        ${macro('protein', 'p')}${macro('carbs', 'c')}${macro('fat', 'f')}
      </div>
    </button>

    ${isToday ? `<div class="fadd">
      <button class="ftile" data-f="scan" style="--i:0">${scanIcon}<span>${t('food.scan')}</span></button>
      <button class="ftile" data-f="snap" style="--i:1">${I.camera}<span>${t('food.snap')}</span></button>
      <button class="ftile" data-f="say" style="--i:2">${I.mic}<span>${t('food.say')}</span></button>
      <button class="ftile" data-f="type" style="--i:3">${I.pen}<span>${t('food.type')}</span></button>
    </div>
    ${favRowHTML(10)}
    <div class="fqp"><span>${t('food.quickProtein')}</span>${[20, 30, 40].map(g => `<button class="chip" data-body="protein" data-g="${g}">+${g} g</button>`).join('')}</div>` : `<button class="btn2 solid fback" data-f="today">${t('food.backToday')}</button>`}

    <div class="section"><span class="label">${t('food.water')}</span><span class="fwl">${(tot.water / 1000).toLocaleString(state.lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 2 })} / ${(tg.water / 1000).toLocaleString(state.lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 1 })} L</span></div>
    <div class="fwater" style="--n:${Math.min(12, glasses)}">${Array.from({ length: glasses }, (_, i) => `<button class="glass-w${i < full ? ' on' : ''}" data-f="water" data-n="${i + 1}" aria-label="${esc(t('food.glasses', { n: i + 1 }))}" style="--i:${i}"><i></i></button>`).join('')}</div>

    ${anyMeals ? SLOTS.filter(s => slots[s].length).map(s => {
      const k = slots[s].reduce((a, m) => a + m.kcal, 0);
      return `<div class="section fslot"><span class="label">${t('food.slot.' + s)}</span><span class="fsk">${nf().format(k)} kcal</span></div>
        <ul class="flist solid">${slots[s].map(m => mealRowHTML(m, seen && !seen.has(m.id), idx++)).join('')}</ul>`;
    }).join('') : `<div class="fempty"><span class="fei">${I.meal}</span><strong>${t(isToday ? 'food.emptyToday' : 'food.emptyDay')}</strong><small>${t('food.emptySub')}</small></div>`}
    ${tot.quickProtein > 0 ? `<p class="fquick">${esc(t('food.quick', { g: tot.quickProtein }))}</p>` : ''}

    <div class="section"><span class="label">${t('food.week')}</span><span class="fwl">${esc(t('food.avg', { k: nf().format(Math.round(week.filter(d => d.kcal).reduce((a, d) => a + d.kcal, 0) / Math.max(1, week.filter(d => d.kcal).length))) }))}</span></div>
    <div class="fweek solid">
      <i class="ftarget" style="bottom:${(tg.kcal / maxK * 100).toFixed(1)}%"></i>
      ${week.map((d, i) => `<button class="fwd${d.date === date ? ' on' : ''}" data-f="goto" data-date="${d.date}" style="--i:${i}">
        <i class="fwb${d.kcal > tg.kcal * 1.08 ? ' hi' : ''}" style="--h:${(d.kcal / maxK).toFixed(3)}"></i>
        ${d.protein ? `<i class="fwp" style="--p:${Math.min(1, d.protein / tg.protein).toFixed(3)}"></i>` : ''}
        <span>${esc(new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'narrow' }).format(new Date(d.date + 'T12:00')))}</span></button>`).join('')}
    </div>
    <p class="fnote">${t(state.settings.foodTargets ? 'food.targetsCustom' : 'food.targetsAuto')}</p>`;

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
  openSheet(el => {
    const paint = () => {
      el.innerHTML = `<div class="sbody"><h2>${t('food.targets')}</h2><p class="lead">${t('food.targetsLead')}</p>
        <div class="slist solid">${Object.keys(STEP).map(k => `<div class="srow"><span class="l"><strong>${t('food.t.' + k)}</strong><small>${esc(t('food.autoIs', { v: `${nf().format(auto[k])} ${k === 'kcal' ? 'kcal' : k === 'water' ? 'ml' : 'g'}` }))}</small></span>
          <div class="stepper"><button class="step" data-ft="-" data-k="${k}">−</button><b>${nf().format(f[k])}</b><button class="step" data-ft="+" data-k="${k}">+</button></div></div>`).join('')}</div>
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
        const [lo, hi] = TARGET_LIMITS[k];
        f[k] = Math.min(hi, Math.max(lo, f[k] + (v === '+' ? 1 : -1) * STEP[k]));
        return paint();
      }
      if (v === 'auto') store.setSettings({ foodTargets: null });
      else store.setSettings({ foodTargets: f });
      await closeTop();
    });
  }, { label: t('food.targets') });
}

// ---------- wiring ----------

export function openFoodDay(date = dateKey()) { view.date = date; }

export function initFood(root) {
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-f]');
    if (!b || b.disabled) return;
    const k = b.dataset.f;
    haptic('tap');
    if (k === 'day') { view.date = shiftDate(view.date, Number(b.dataset.d)); slide(root, Number(b.dataset.d)); return renderFood(root); }
    if (k === 'goto') { const d = Number(new Date(b.dataset.date) > new Date(view.date)) || -1; view.date = b.dataset.date; slide(root, d); return renderFood(root); }
    if (k === 'today') { view.date = dateKey(); slide(root, 1); return renderFood(root); }
    if (k === 'targets') return targetsSheet();
    if (k === 'meal') return mealSheet(b.dataset.id);
    if (k === 'scan') return openScanner();
    if (k === 'snap') return openMealSheet();
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
