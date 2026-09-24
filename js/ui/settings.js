// Settings: language, units, rest, voice and keys, haptics, motion, reset.
import { state, setSettings, resetAll } from '../store.js';
import { VERSION } from '../version.js';
import { LIMITS } from '../workout.js';
import { haptic } from '../haptics.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { esc } from './dom.js';
import { getKey, setKey, mask } from '../keys.js';
import { VOICES, DEFAULT_TTS_MODEL, ttsModelId } from '../settings.js';
import { testGroqKey } from '../stt.js';
import { listModels, pickTtsModel, speak } from '../tts.js';
import { unlockAudio } from '../audio.js';

const KEYS = {
  groq: { link: 'https://console.groq.com/keys', title: 'settings.groqKey', sub: 'settings.groqSub' },
  google: { link: 'https://aistudio.google.com/apikey', title: 'settings.googleKey', sub: 'settings.googleSub' }
};
const keyStatus = {}; // name -> 'ok' | 'bad' | 'offline' | code | 'testing'

function keyRow(name) {
  const { t } = state;
  const k = KEYS[name];
  const v = getKey(name);
  const st = keyStatus[name];
  const status = st === 'testing' ? t('settings.testing') : st === 'ok' ? t('settings.keyOk') : st === 'bad' ? t('settings.keyBad')
    : st === 'offline' ? t('settings.keyOffline') : st ? t('settings.keyFail', { code: st }) : v ? `${t('settings.keySet')} ${mask(v)}` : t('settings.keyNone');
  const cls = st === 'ok' ? 'good' : st && st !== 'testing' ? 'bad' : '';
  return `<div class="srow keyrow">
      <span class="l"><strong>${t(k.title)}</strong><small>${t(k.sub)}</small><small class="kstat ${cls}">${esc(status)}</small></span>
      <a class="chip" href="${k.link}" target="_blank" rel="noopener">${t('settings.getKey')}</a>
    </div>
    <div class="keyedit">
      <input type="password" data-key-input="${name}" placeholder="${esc(v ? mask(v) : t('settings.keyPh'))}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t(k.title)}">
      <button class="chip" data-act="test-key" data-k="${name}" ${st === 'testing' ? 'disabled' : ''}>${t('settings.test')}</button>
      ${v ? `<button class="chip" data-act="clear-key" data-k="${name}">${t('settings.clearKey')}</button>` : ''}
    </div>`;
}

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

    <div class="sgroup"><h2>${t('settings.voice')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.voiceLang')}</strong></span>${seg('voiceLang', ['auto', 'da', 'en'], [t('lang.auto'), t('lang.da'), t('lang.en')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.micMode')}</strong><small>${t('settings.micModeSub')}</small></span>${seg('micMode', ['hold', 'tap'], [t('mic.hold'), t('mic.tap')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.spoken')}</strong></span>${seg('spoken', ['off', 'minimal', 'full'], [t('spoken.off'), t('spoken.minimal'), t('spoken.full')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.voiceName')}</strong></span>
        <span class="stepper"><select class="select" data-set="voice" aria-label="${t('settings.voiceName')}">${VOICES.map(n => `<option ${n === s.voice ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="chip" data-act="preview-voice">${t('settings.preview')}</button></span></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.keys')}</h2><div class="slist solid">
      ${keyRow('groq')}
      ${keyRow('google')}
    </div><p class="snote">${t('settings.privacy')}</p></div>

    <div class="sgroup"><h2>${t('settings.workout')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.rest')}</strong></span>
        <div class="stepper"><button class="step" data-act="rest-default" data-d="-15" aria-label="−15 s" ${s.restSec <= LIMITS.restMin ? 'disabled' : ''}>−</button><b>${t('seconds', { n: s.restSec })}</b><button class="step" data-act="rest-default" data-d="15" aria-label="+15 s" ${s.restSec >= LIMITS.restMax ? 'disabled' : ''}>+</button></div></div>
      <div class="srow"><span class="l"><strong>${t('settings.weeklyGoal')}</strong><small>${t('settings.weeklyGoalSub')}</small></span>
        <div class="stepper"><button class="step" data-act="goal" data-d="-1" aria-label="−1" ${s.weeklyGoal <= 1 ? 'disabled' : ''}>−</button><b>${s.weeklyGoal}</b><button class="step" data-act="goal" data-d="1" aria-label="+1" ${s.weeklyGoal >= 7 ? 'disabled' : ''}>+</button></div></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.feel')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.haptics')}</strong><small>${t('settings.hapticsSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.haptics}" aria-label="${t('settings.haptics')}" data-act="toggle-haptics"></button></div>
      <div class="srow"><span class="l"><strong>${t('settings.motion')}</strong></span>${seg('motion', ['auto', 'on', 'off'], [t('settings.motion.auto'), t('settings.motion.on'), t('settings.motion.off')])}</div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.advanced')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.sttModel')}</strong></span>${seg('stt', ['fast', 'accurate'], [t('stt.fast'), t('stt.accurate')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.ttsModel')}</strong><small>${esc(t('settings.ttsModelSub', { id: s.ttsOverride || s.ttsModel }))}</small></span></div>
      <div class="keyedit"><input data-set="ttsOverride" value="${esc(s.ttsOverride)}" placeholder="${esc(s.ttsModel || DEFAULT_TTS_MODEL)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('settings.ttsOverride')}"></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.data')}</h2><div class="slist solid">
      <button class="srow danger" data-act="reset"><span class="l"><strong>${t('settings.reset')}</strong><small>${t('settings.resetSub')}</small></span>${I.trash.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--danger)"')}</button>
    </div></div>
    <p class="version">${esc(t('settings.version', { v: VERSION }))}</p>`;
}

async function testKey(name, root) {
  const input = root.querySelector(`[data-key-input="${name}"]`);
  if (input?.value.trim()) { setKey(name, input.value); input.value = ''; }
  const key = getKey(name);
  if (!key) return;
  keyStatus[name] = 'testing';
  renderSettings(root);
  let st;
  if (name === 'groq') st = await testGroqKey(key);
  else {
    try {
      const r = await listModels(key);
      st = r.status;
      if (st === 'ok') setSettings({ ttsModel: pickTtsModel(r.models, DEFAULT_TTS_MODEL) || '' });
    } catch { st = 'offline'; }
  }
  keyStatus[name] = st;
  haptic(st === 'ok' ? 'success' : 'error');
  renderSettings(root);
}

export function initSettings(actions, root) {
  root.addEventListener('change', e => {
    const k = e.target.dataset.keyInput;
    if (k) { if (e.target.value.trim()) { setKey(k, e.target.value); delete keyStatus[k]; e.target.value = ''; renderSettings(root); } return; }
    const set = e.target.dataset.set;
    if (set) setSettings({ [set]: e.target.value });
  });
  Object.assign(actions, {
    'test-key': el => testKey(el.dataset.k, root),
    'clear-key': el => { setKey(el.dataset.k, ''); delete keyStatus[el.dataset.k]; haptic('tap'); renderSettings(root); },
    'preview-voice': () => {
      unlockAudio();
      speak(state.t('settings.previewText'), { key: getKey('google'), model: ttsModelId(state.settings), voice: state.settings.voice, lang: state.lang, canSpeak: () => true });
    },
    set: el => { setSettings({ [el.dataset.key]: el.dataset.v }); haptic('tap'); },
    goal: el => { setSettings({ weeklyGoal: state.settings.weeklyGoal + Number(el.dataset.d) }); haptic('tap'); },
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
