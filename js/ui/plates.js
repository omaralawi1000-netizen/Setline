// Plate calculator sheet: which plates go on each side, drawn on a bar.
import { state } from '../store.js';
import { platesFor, BARS } from '../plates.js';
import { weight } from '../format.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { openSheet } from './sheet.js';

let bar = 20;
const COLORS = { 25: '#E0566F', 20: '#5B86FF', 15: '#F2C14E', 10: '#5CC98B', 5: '#E8E8EE', 2.5: '#9293A6', 1.25: '#C6BBFA' };
const HEIGHT = { 25: 96, 20: 96, 15: 84, 10: 72, 5: 56, 2.5: 44, 1.25: 36 };

function drawing(perSide) {
  // one side, mirrored with CSS
  const plates = perSide.map((p, i) => `<i class="plate" style="--h:${HEIGHT[p]}px;--c:${COLORS[p]};--i:${i}"><span>${String(p).replace('.', state.lang === 'da' ? ',' : '.')}</span></i>`).join('');
  return `<div class="barviz"><div class="side l">${plates}</div><div class="shaft"></div><div class="side r">${plates}</div></div>`;
}

export function openPlates(targetKg) {
  const { t, lang } = state;
  openSheet(el => {
    const paint = () => {
      const r = platesFor(targetKg, bar);
      el.querySelector('.pbody')?.remove();
      el.insertAdjacentHTML('beforeend', `<div class="pbody">
        <div class="shead"><h2>${esc(weight(targetKg, 'kg', lang))} kg</h2><span class="label">${t('plates.perSide')}</span></div>
        ${drawing(r.perSide)}
        <p class="lead ptext">${r.under ? esc(t('plates.under', { bar })) : r.perSide.length ? esc(r.perSide.map(p => weight(p, 'kg', lang)).join(' + ')) + ' kg' : t('plates.empty')}${r.remainder > 0 && !r.under ? ` · ${esc(t('plates.left', { kg: weight(r.remainder, 'kg', lang) }))}` : ''}</p>
        <div class="field"><label>${t('plates.bar')}</label><div class="opts">${BARS.map(b => `<button class="chip" data-bar="${b}" aria-pressed="${b === bar}">${b ? `${b} kg` : t('plates.noBar')}</button>`).join('')}</div></div>
      </div>`);
    };
    paint();
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-bar]');
      if (!b) return;
      bar = Number(b.dataset.bar);
      haptic('tap');
      paint();
    });
  }, { label: t('plates.title') });
}
