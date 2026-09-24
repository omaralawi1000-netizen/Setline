// Food search: type (or say) a food, get Danish foods at once and Danish products from Open Food
// Facts as you type; tap one for the amount card. Nothing found → let the AI estimate it.
import * as db from '../db.js';
import { state } from '../store.js';
import { searchLocal, searchOnline, localFood } from '../fooddb.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { openSheet, closeTop } from './sheet.js';
import { openScanner, scanIcon } from './scan.js';
import { openMealSheet } from './meal.js';

const POPULAR = ['skyr', 'havregryn', 'rugbrod', 'aeg', 'kyllingebryst', 'banan', 'ris-kogt', 'hytteost', 'minimaelk', 'proteinpulver-valle'];

function rowHTML(p, i) {
  const { t } = state;
  const sub = [p.brand, t('search.per100', { k: p.per100.kcal, p: p.per100.protein })].filter(Boolean).join(' · ');
  return `<li class="sres" style="--i:${i}"><button class="fmain" data-pick-food="${esc(p.code)}">
    ${p.image ? `<img class="fthumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="fthumb ic">${p.source === 'dk' ? I.meal : scanIcon}</span>`}
    <span class="l"><strong>${esc(p.name)}</strong><small>${esc(sub)}</small></span>${I.fwd}</button></li>`;
}

export function openFoodSearch({ query = '' } = {}) {
  const { t, lang } = state;
  let online = [], ctl = null, timer = 0, q = query, busy = false;
  const found = new Map();
  openSheet((el, api) => {
    api.sheet.style.height = 'calc(100% - var(--safe-top) - 24px)';
    el.innerHTML = `<div class="sbody fsearch"><h2>${t('search.title')}</h2>
      <label class="search">${I.search}<input type="search" enterkeyhint="search" autocomplete="off" placeholder="${esc(t('search.ph'))}" value="${esc(q)}"></label>
      <div class="fsres anim"></div></div>`;
    const input = el.querySelector('input'), box = el.querySelector('.fsres');
    const recent = async () => ((await db.get('meta', 'products').catch(() => null)) || []).filter(p => p.name).slice(0, 8);
    const paint = async () => {
      const local = q ? searchLocal(q, lang) : [];
      const list = q ? [...local, ...online.filter(o => !local.some(l => l.name === o.name))] : [...(await recent()), ...POPULAR.map(id => localFood(id, lang))];
      for (const p of list) found.set(p.code, p);
      box.innerHTML = (q ? '' : `<div class="section"><span class="label">${t('search.start')}</span></div>`) +
        (list.length ? `<ul class="flist solid">${list.map(rowHTML).join('')}</ul>` : '') +
        (q && busy ? `<p class="snote center"><span class="dots"><i></i><i></i><i></i></span> ${t('search.online')}</p>` : '') +
        (q ? `<button class="srow sai solid" data-ai>${I.chat}<span class="l"><strong>${esc(t('search.ai', { q }))}</strong><small>${t('search.aiSub')}</small></span>${I.fwd}</button>` : '');
    };
    const lookOnline = () => {
      clearTimeout(timer); ctl?.abort(); online = [];
      if (q.length < 3 || navigator.onLine === false) { busy = false; return paint(); }
      busy = true; paint();
      timer = setTimeout(async () => {
        ctl = new AbortController();
        const mine = ctl;
        try { online = await searchOnline(q, lang, { signal: ctl.signal }); } catch { online = []; }
        if (mine !== ctl) return;
        busy = false;
        if (el.isConnected) paint();
      }, 450);
    };
    input.addEventListener('input', () => { box.classList.remove('anim'); q = input.value.trim(); lookOnline(); });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-pick-food]');
      if (b) {
        const p = found.get(b.dataset.pickFood);
        if (!p) return;
        haptic('tap');
        await closeTop();
        openScanner({ product: p });
        return;
      }
      if (e.target.closest('[data-ai]')) { haptic('tap'); await closeTop(); openMealSheet({ text: q }); }
    });
    paint();
    if (q) lookOnline();
    setTimeout(() => input.focus(), 380);
  }, { label: t('search.title'), onClose: () => { clearTimeout(timer); ctl?.abort(); } });
}
