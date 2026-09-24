// Bodyweight sheet and quick protein logging.
import * as store from '../store.js';
import { state } from '../store.js';
import { bodyTrend, validBodyweight } from '../body.js';
import { parseNumber, fromDisplay, lbToKg } from '../units.js';
import { weight } from '../format.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { openMealSheet } from './meal.js';
import { openScanner } from './scan.js';

function weightSheet() {
  const { t, lang, settings } = state;
  const unit = settings.unit, u = t(`unit.${unit}`);
  let kg = bodyTrend(state.bodyweight)?.latest.kg ?? 80;
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('body.logTitle')}</h2>
      <div class="editnums solid"><div class="bigstep"><button class="step" data-s="-1" aria-label="−">−</button>
        <input id="bw" inputmode="decimal" aria-label="${t('body.weight')}"><span>${u}</span><button class="step" data-s="1" aria-label="+">+</button></div></div>
      <div class="err" id="berr"></div>
      <div class="acts"><button class="log" data-k="save">${I.check}<span>${t('common.save')}</span></button></div>`);
    const input = el.querySelector('#bw');
    const paint = () => { input.value = weight(kg, unit, lang); };
    paint();
    const read = () => { const n = parseNumber(input.value); if (n != null) kg = fromDisplay(n, unit); };
    el.addEventListener('click', async e => {
      const st = e.target.closest('[data-s]');
      if (st) { read(); kg = Math.round((kg + Number(st.dataset.s) * (unit === 'kg' ? 0.1 : lbToKg(0.2))) * 100) / 100; paint(); haptic('tap'); return; }
      if (e.target.closest('[data-k=save]')) {
        read();
        if (!validBodyweight(kg)) { el.querySelector('#berr').textContent = t('body.invalid'); haptic('error'); return; }
        await closeTop();
        await store.logBodyweight(kg);
        haptic('success');
        toast({ title: `${esc(t('body.weight'))} <span class="v">${esc(weight(kg, unit, lang))} ${u}</span>`, sub: t('body.saved') });
      }
    });
  }, { label: t('body.logTitle') });
}

export async function addProteinQuick(g) {
  const { t } = state;
  await store.logProtein(g);
  haptic('tap');
  toast({ title: `${esc(t('body.protein'))} <span class="v">+${g} g</span>`, action: t('common.undo'), onAction: () => store.undoProtein(g), ms: 3000 });
}

export function initBody() {
  document.getElementById('app').addEventListener('click', e => {
    const b = e.target.closest('[data-body]');
    if (!b) return;
    if (b.dataset.body === 'weight') weightSheet();
    else if (b.dataset.body === 'protein') addProteinQuick(Number(b.dataset.g));
    else if (b.dataset.body === 'meal') openMealSheet();
    else if (b.dataset.body === 'scan') openScanner();
  });
}
