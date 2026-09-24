// Basic settings: language, units, default rest, haptics, motion, reset.
import { state, setSettings, resetAll } from '../store.js';
import { VERSION } from '../version.js';
import { LIMITS } from '../workout.js';
import { haptic } from '../haptics.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { esc } from './dom.js';

const seg = (key, options, labels) => `<div class="seg" role="group">${options.map((o, i) =>
  `<button data-act="set" data-key="${key}" data-v="${o}" aria-pressed="${state.settings[key] === o}">${labels[i]}</button>`).join('')}</div>`;

export function renderSettings(root) {
  const { t, settings: s } = state;
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${t('settings.title')}</strong></div><span class="spacer"></span>
    </header>
    <h1 class="h1">${t('settings.title')}</h1>

    <div class="sgroup"><h2>${t('settings.general')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.language')}</strong></span>${seg('lang', ['auto', 'da', 'en'], [t('lang.auto'), t('lang.da'), t('lang.en')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.units')}</strong></span>${seg('unit', ['kg', 'lb'], [t('unit.kg'), t('unit.lb')])}</div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.workout')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.rest')}</strong></span>
        <div class="stepper"><button class="step" data-act="rest-default" data-d="-15" aria-label="−15 s" ${s.restSec <= LIMITS.restMin ? 'disabled' : ''}>−</button><b>${t('seconds', { n: s.restSec })}</b><button class="step" data-act="rest-default" data-d="15" aria-label="+15 s" ${s.restSec >= LIMITS.restMax ? 'disabled' : ''}>+</button></div></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.feel')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.haptics')}</strong><small>${t('settings.hapticsSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.haptics}" aria-label="${t('settings.haptics')}" data-act="toggle-haptics"></button></div>
      <div class="srow"><span class="l"><strong>${t('settings.motion')}</strong></span>${seg('motion', ['auto', 'on', 'off'], [t('settings.motion.auto'), t('settings.motion.on'), t('settings.motion.off')])}</div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.data')}</h2><div class="slist solid">
      <button class="srow danger" data-act="reset"><span class="l"><strong>${t('settings.reset')}</strong><small>${t('settings.resetSub')}</small></span>${I.trash.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--danger)"')}</button>
    </div></div>
    <p class="version">${esc(t('settings.version', { v: VERSION }))}</p>`;
}

export function initSettings(actions) {
  Object.assign(actions, {
    set: el => { setSettings({ [el.dataset.key]: el.dataset.v }); haptic('tap'); },
    'rest-default': el => { setSettings({ restSec: state.settings.restSec + Number(el.dataset.d) }); haptic('tap'); },
    'toggle-haptics': () => { setSettings({ haptics: !state.settings.haptics }); haptic('tap'); },
    reset: () => resetFlow()
  });
}

function resetFlow() {
  const { t } = state;
  openSheet((el, api) => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('settings.resetTitle')}</h2><p class="lead">${t('settings.resetBody')}</p>
      <div class="acts"><button class="btn2 solid danger" data-k="yes">${I.trash}<span>${t('settings.reset')}</span></button><button class="btn2 solid" data-k="no">${t('common.cancel')}</button></div>`);
    el.querySelector('[data-k=no]').onclick = () => closeTop();
    el.querySelector('[data-k=yes]').onclick = () => api.replace(el2 => {
      el2.insertAdjacentHTML('beforeend', `<h2>${t('settings.resetAgainTitle')}</h2><p class="lead">${t('settings.resetAgainBody')}</p>
        <div class="acts"><button class="btn2 solid danger" data-k="yes">${I.trash}<span>${t('settings.resetConfirm')}</span></button><button class="btn2 solid" data-k="no">${t('common.cancel')}</button></div>`);
      el2.querySelector('[data-k=no]').onclick = () => closeTop();
      el2.querySelector('[data-k=yes]').onclick = async e => {
        e.currentTarget.disabled = true;
        await closeTop();
        await resetAll();
        haptic('success');
        toast({ title: esc(state.t('toast.reset')) });
      };
    });
  }, { label: t('settings.resetTitle') });
}
