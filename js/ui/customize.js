// Customize: the colour theme and which cards Today shows. Changes apply live behind the sheet.
import * as store from '../store.js';
import { state } from '../store.js';
import { ACCENTS, TODAY_PARTS, FOOD_PARTS, foodOrderOf, todayOrderOf } from '../settings.js';
import { sanitizeQuick, QUICK_DEFAULTS } from '../nutrition.js';
import { I } from './icons.js';
import { haptic } from '../haptics.js';
import { openSheet, closeTop } from './sheet.js';

// a segmented choice and an on/off row, bound to a setting
const seg = (key, vals, label) => `<div class="seg">${vals.map(v => `<button data-cu="set" data-k="${key}" data-v="${v}" aria-pressed="${state.settings[key] === v}">${label(v)}</button>`).join('')}</div>`;
const tog = (key, title, sub) => `<div class="srow"><span class="l"><strong>${state.t(title)}</strong><small>${state.t(sub)}</small></span><button class="toggle" role="switch" aria-checked="${!!state.settings[key]}" aria-label="${state.t(title)}" data-cu="flip" data-k="${key}"></button></div>`;

export function openCustomize() {
  const { t } = state;
  openSheet(el => {
    const paint = () => {
      const s = state.settings, hide = new Set(s.todayHide || []);
      el.innerHTML = `<div class="sbody"><h2>${t('cust.title')}</h2><p class="lead">${t('cust.lead')}</p>
        <div class="field"><label>${t('cust.colour')}</label><div class="swatches">${ACCENTS.map(a => `<button class="swatch" data-accent="${a}" data-cu="accent" aria-pressed="${a === s.accent}" aria-label="${t('accent.' + a)}"><i></i><span>${t('accent.' + a)}</span></button>`).join('')}</div></div>
        <div class="field"><label>${t('look.title')}</label><div class="slist solid">
          <div class="srow"><span class="l"><strong>${t('look.start')}</strong><small>${t('look.startSub')}</small></span>${seg('startTab', ['today', 'workout', 'food', 'coach'], k => t('tab.' + k))}</div>
          <div class="srow"><span class="l"><strong>${t('look.text')}</strong></span>${seg('textSize', ['small', 'normal', 'large'], k => t('look.text.' + k))}</div>
          <div class="srow"><span class="l"><strong>${t('look.glow')}</strong><small>${t('look.glowSub')}</small></span>${seg('glow', ['on', 'soft', 'off'], k => t('look.glow.' + k))}</div>
          ${tog('greeting', 'look.greeting', 'look.greetingSub')}
          ${tog('dockLabels', 'look.dock', 'look.dockSub')}
        </div></div>
        <div class="field"><label>${t('look.workout')}</label><div class="slist solid">
          ${tog('exFigure', 'look.figure', 'look.figureSub')}
          ${tog('exGhost', 'look.ghost', 'look.ghostSub')}
          ${tog('autoWarmup', 'settings.autoWarmup', 'settings.autoWarmupSub')}
          ${tog('suggestions', 'settings.suggestions', 'settings.suggestionsSub')}
          ${tog('debrief', 'debrief.setting', 'debrief.settingSub')}
          ${tog('hfButton', 'look.hf', 'look.hfSub')}
        </div></div>
        <div class="field"><label>${t('cust.cards')}</label><div class="slist solid">${todayOrderOf(s).map((k, i, ord) => `<div class="srow ord"><span class="l"><strong>${t('cust.part.' + k)}</strong></span>
          <span class="ordbtns"><button class="iconbtn sm" data-cu="move" data-k="${k}" data-d="-1" aria-label="${t('cust.up')}" ${i === 0 ? 'disabled' : ''}>${I.up}</button><button class="iconbtn sm dn" data-cu="move" data-k="${k}" data-d="1" aria-label="${t('cust.down')}" ${i === ord.length - 1 ? 'disabled' : ''}>${I.up}</button></span>
          ${TODAY_PARTS.includes(k) ? `<button class="toggle" role="switch" aria-checked="${!hide.has(k)}" aria-label="${t('cust.part.' + k)}" data-cu="part" data-k="${k}"></button>` : '<span class="togph"></span>'}</div>`).join('')}</div></div></div>`;
    };
    paint();
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cu]');
      if (!b || b.disabled) return;
      haptic('tap');
      if (b.dataset.cu === 'move') {
        const ord = todayOrderOf(state.settings), i = ord.indexOf(b.dataset.k), j = i + Number(b.dataset.d);
        [ord[i], ord[j]] = [ord[j], ord[i]];
        store.setSettings({ todayOrder: ord });
        return paint();
      }
      if (b.dataset.cu === 'set') { store.setSettings({ [b.dataset.k]: b.dataset.v }); return paint(); }
      if (b.dataset.cu === 'flip') { store.setSettings({ [b.dataset.k]: !state.settings[b.dataset.k] }); return paint(); }
      if (b.dataset.cu === 'accent') {
        store.setSettings({ accent: b.dataset.accent });
        el.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      } else {
        const hide = new Set(state.settings.todayHide || []);
        const k = b.dataset.k;
        if (hide.has(k)) hide.delete(k); else hide.add(k);
        store.setSettings({ todayHide: [...hide] });
        b.setAttribute('aria-checked', String(!hide.has(k)));
      }
    });
  }, { label: t('cust.title') });
}

// Food tab: what to track and in which order. Calories off → the ring follows protein.
const QSTEP = { protein: 5, kcal: 50 };
export function openFoodCustomize({ targets = null } = {}) {
  const { t } = state;
  openSheet(el => {
    const paint = () => {
      const st = state.settings, hide = new Set(st.foodHide || []), q = sanitizeQuick(st.quickAdd), ord = foodOrderOf(st);
      const hideable = k => FOOD_PARTS.includes(k);
      el.innerHTML = `<div class="sbody"><h2>${t('cust.foodTitle')}</h2><p class="lead">${t('cust.foodLead')}</p>
        <div class="field"><label>${t('cust.track')}</label><div class="slist solid">${['calories', 'carbs', 'fat'].map(k => `<div class="srow"><span class="l"><strong>${t('cust.food.' + k)}</strong>${k === 'calories' ? `<small>${t('cust.food.caloriesSub')}</small>` : ''}</span>
          <button class="toggle" role="switch" aria-checked="${!hide.has(k)}" aria-label="${t('cust.food.' + k)}" data-cf="${k}"></button></div>`).join('')}</div></div>
        <div class="field"><label>${t('cust.sections')}</label><div class="slist solid">${ord.map((k, i) => `<div class="srow ord"><span class="l"><strong>${t('cust.food.' + k)}</strong></span>
          <span class="ordbtns"><button class="iconbtn sm" data-mv="${k}" data-d="-1" aria-label="${t('cust.up')}" ${i === 0 ? 'disabled' : ''}>${I.up}</button><button class="iconbtn sm dn" data-mv="${k}" data-d="1" aria-label="${t('cust.down')}" ${i === ord.length - 1 ? 'disabled' : ''}>${I.up}</button></span>
          ${hideable(k) ? `<button class="toggle" role="switch" aria-checked="${!hide.has(k)}" aria-label="${t('cust.food.' + k)}" data-cf="${k}"></button>` : '<span class="togph"></span>'}</div>`).join('')}</div></div>
        <div class="field"><label>${t('cust.quick')}</label>
          <div class="seg" role="group">${['kcal', 'protein'].map(k => `<button data-qk="${k}" aria-pressed="${q.kind === k}">${t('cust.quick.' + k)}</button>`).join('')}</div>
          <div class="qvals">${q.values.map((v, i) => `<div class="stepper"><button class="step" data-qv="${i}" data-d="-1">−</button><b>${v}${q.kind === 'kcal' ? '' : ' g'}</b><button class="step" data-qv="${i}" data-d="1">+</button></div>`).join('')}</div></div>
        ${targets ? `<button class="btn2 solid wide" data-cf-targets>${t('food.targets')}</button>` : ''}</div>`;
    };
    paint();
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-cf-targets]')) { haptic('tap'); await closeTop(); targets?.(); return; }
      const st = state.settings;
      const b = e.target.closest('[data-cf],[data-mv],[data-qk],[data-qv]');
      if (!b || b.disabled) return;
      haptic('tap');
      if (b.dataset.cf) {
        const h = new Set(st.foodHide || []), k = b.dataset.cf;
        if (h.has(k)) h.delete(k); else h.add(k);
        store.setSettings({ foodHide: [...h] });
      } else if (b.dataset.mv) {
        const ord = foodOrderOf(st), i = ord.indexOf(b.dataset.mv), j = i + Number(b.dataset.d);
        [ord[i], ord[j]] = [ord[j], ord[i]];
        store.setSettings({ foodOrder: ord });
      } else if (b.dataset.qk) {
        store.setSettings({ quickAdd: { kind: b.dataset.qk, values: QUICK_DEFAULTS[b.dataset.qk] } });
      } else {
        const q = sanitizeQuick(st.quickAdd), i = Number(b.dataset.qv);
        const values = [...q.values];
        values[i] = Math.max(q.kind === 'kcal' ? 10 : 1, values[i] + Number(b.dataset.d) * QSTEP[q.kind]);
        store.setSettings({ quickAdd: { kind: q.kind, values } });
      }
      paint();
    });
  }, { label: t('cust.foodTitle') });
}
