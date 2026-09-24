// Exercise picker sheet: search, pick, or create a custom exercise.
import { state, addCustomExercise } from '../store.js';
import { makeCustom, MUSCLES, EQUIPMENT } from '../catalog.js';
import { joinList } from '../i18n.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { openSheet, closeTop } from './sheet.js';

function rowHTML(e) {
  const { t, lang } = state;
  const sub = `${t('equip.' + e.equipment)}, ${joinList(e.muscles.slice(0, 2).map(m => t('muscle.' + m)), lang)}`;
  return `<li><button class="prow" data-pick="${esc(e.id)}">
    <span class="l"><strong>${esc(state.catalog.name(e.id, lang))}</strong><small>${esc(sub)}${e.custom ? ` · ${t('picker.custom')}` : ''}</small></span>
    <span class="plus">${I.plus}</span></button></li>`;
}

export function openPicker({ onPick }) {
  const { t } = state;
  openSheet((el, api) => {
    api.sheet.style.height = 'calc(100% - var(--safe-top) - 24px)';
    el.insertAdjacentHTML('beforeend', `
      <div class="shead"><h2>${t('picker.title')}</h2><button class="iconbtn" data-close aria-label="${t('common.close')}">${I.close}</button></div>
      <label class="search">${I.search}<input type="search" placeholder="${t('picker.search')}" aria-label="${t('picker.search')}" autocomplete="off" enterkeyhint="search"></label>
      <div class="sbody"><ul class="plist" id="plist"></ul></div>`);
    const input = el.querySelector('input');
    const list = el.querySelector('#plist');
    const paint = () => {
      const q = input.value.trim();
      const res = state.catalog.search(q, { usage: state.usage, lang: state.lang, limit: q ? 30 : 200 });
      let html = '';
      if (!q) {
        const frequent = res.filter(e => state.usage[e.id]).slice(0, 6);
        if (frequent.length) html += `<li class="plabel">${t('picker.recent')}</li>` + frequent.map(rowHTML).join('');
        const rest = [...res].sort((a, b) => state.catalog.name(a.id, state.lang).localeCompare(state.catalog.name(b.id, state.lang), state.lang));
        html += `<li class="plabel">${t('picker.all')}</li>` + rest.map(rowHTML).join('');
      } else {
        html += res.map(rowHTML).join('') || `<li class="none">${t('picker.none')}</li>`;
        if (!state.catalog.findExact(q)) {
          html += `<li><button class="prow" data-create><span class="plus">${I.plus}</span><span class="l"><strong>${esc(t('picker.create', { name: q }))}</strong></span></button></li>`;
        }
      }
      list.innerHTML = html;
    };
    paint();
    input.addEventListener('input', paint);
    el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return closeTop();
      const pick = e.target.closest('[data-pick]');
      if (pick) { haptic('tap'); closeTop().then(() => onPick(pick.dataset.pick)); return; }
      if (e.target.closest('[data-create]')) customForm(api, input.value.trim(), onPick);
    });
  }, { label: t('picker.title') });
}

function customForm(api, name, onPick) {
  const { t } = state;
  let muscle = 'chest', equipment = 'barbell';
  api.replace(el => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody">
      <div class="shead"><h2>${t('custom.title')}</h2><button class="iconbtn" data-close aria-label="${t('common.close')}">${I.close}</button></div>
      <div class="field"><label for="cname">${t('custom.name')}</label><input id="cname" maxlength="60" autocomplete="off" value="${esc(name)}"></div>
      <div class="err" id="cerr"></div>
      <div class="field"><label>${t('custom.muscle')}</label><div class="opts" data-group="muscle">${MUSCLES.map(m => `<button class="chip" data-v="${m}" aria-pressed="${m === muscle}">${t('muscle.' + m)}</button>`).join('')}</div></div>
      <div class="field"><label>${t('custom.equipment')}</label><div class="opts" data-group="equipment">${EQUIPMENT.map(q => `<button class="chip" data-v="${q}" aria-pressed="${q === equipment}">${t('equip.' + q)}</button>`).join('')}</div></div>
      <div class="acts"><button class="log" data-save>${t('custom.save')}</button></div></div>`);
    const err = el.querySelector('#cerr');
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return closeTop();
      const opt = e.target.closest('.opts [data-v]');
      if (opt) {
        const g = opt.parentElement.dataset.group;
        if (g === 'muscle') muscle = opt.dataset.v; else equipment = opt.dataset.v;
        for (const b of opt.parentElement.children) b.setAttribute('aria-pressed', String(b === opt));
        haptic('tap');
        return;
      }
      if (e.target.closest('[data-save]')) {
        const n = el.querySelector('#cname').value;
        if (state.catalog.findExact(n)) { err.textContent = t('custom.exists'); haptic('error'); return; }
        const r = makeCustom({ name: n, muscle, equipment });
        if (!r.ok) { err.textContent = t('custom.nameInvalid'); haptic('error'); return; }
        e.target.closest('button').disabled = true;
        await addCustomExercise(r.exercise);
        await closeTop();
        onPick(r.exercise.id);
      }
    });
  });
}
