// Customize: the colour theme and which cards Today shows. Changes apply live behind the sheet.
import * as store from '../store.js';
import { state } from '../store.js';
import { ACCENTS, TODAY_PARTS } from '../settings.js';
import { haptic } from '../haptics.js';
import { openSheet } from './sheet.js';

export function openCustomize() {
  const { t } = state;
  openSheet(el => {
    const paint = () => {
      const s = state.settings, hide = new Set(s.todayHide || []);
      el.innerHTML = `<div class="sbody"><h2>${t('cust.title')}</h2><p class="lead">${t('cust.lead')}</p>
        <div class="field"><label>${t('cust.colour')}</label><div class="swatches">${ACCENTS.map(a => `<button class="swatch" data-accent="${a}" data-cu="accent" aria-pressed="${a === s.accent}" aria-label="${t('accent.' + a)}"><i></i><span>${t('accent.' + a)}</span></button>`).join('')}</div></div>
        <div class="field"><label>${t('cust.cards')}</label><div class="slist solid">${TODAY_PARTS.map(k => `<div class="srow"><span class="l"><strong>${t('cust.part.' + k)}</strong></span>
          <button class="toggle" role="switch" aria-checked="${!hide.has(k)}" aria-label="${t('cust.part.' + k)}" data-cu="part" data-k="${k}"></button></div>`).join('')}</div></div></div>`;
    };
    paint();
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cu]');
      if (!b) return;
      haptic('tap');
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
