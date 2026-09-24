// Settings: language, units, rest, voice and keys, haptics, motion, reset.
import { state, setSettings, resetAll, importBackup } from '../store.js';
import { makeBackup, validateBackup } from '../backup.js';
import { dateKey } from '../body.js';
import { VERSION } from '../version.js';
import { LIMITS } from '../workout.js';
import { haptic } from '../haptics.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { esc } from './dom.js';
import { num } from '../format.js';
import { getKey, setKey, mask } from '../keys.js';
import { VOICES, VOICE_FEEL, DEFAULT_TTS_MODEL, ttsModelId, ttsAlt } from '../settings.js';
import { testGroqKey } from '../stt.js';
import { listModels, pickTtsModel, speak, lastSpeech, onSpeaking } from '../tts.js';
import { unlockAudio } from '../audio.js';
import { pickTextModels, FALLBACK_MODELS } from '../ai.js';

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

function speechStatus() {
  const { t } = state;
  if (!lastSpeech.engine) return getKey('google') ? t('speech.unknown') : t('speech.noKey');
  if (lastSpeech.engine === 'gemini') return t('speech.gemini');
  return t('speech.device', { why: lastSpeech.error === 'nokey' ? t('speech.why.nokey') : t('speech.why.error', { code: lastSpeech.error }) });
}

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
      <div class="srow"><span class="l"><strong>${t('settings.ttsQuality')}</strong><small>${t('settings.ttsQualitySub')}</small></span>${seg('ttsQuality', ['natural', 'fast'], [t('tts.natural'), t('tts.fast')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.voiceName')}</strong><small id="speechstat">${esc(speechStatus())}</small></span>
        <span class="stepper"><select class="select" data-set="voice" aria-label="${t('settings.voiceName')}">${VOICES.map(n => `<option value="${n}" ${n === s.voice ? 'selected' : ''}>${n} · ${t('feel.' + VOICE_FEEL[n])}</option>`).join('')}</select>
        <button class="chip" data-act="preview-voice">${t('settings.preview')}</button></span></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.keys')}</h2><div class="slist solid">
      ${keyRow('groq')}
      ${keyRow('google')}
    </div><p class="snote">${t('settings.privacy')}</p></div>

    <div class="sgroup"><h2>${t('settings.workout')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.rest')}</strong></span>
        <div class="stepper"><button class="step" data-act="rest-default" data-d="-15" aria-label="−15 s" ${s.restSec <= LIMITS.restMin ? 'disabled' : ''}>−</button><b>${t('seconds', { n: s.restSec })}</b><button class="step" data-act="rest-default" data-d="15" aria-label="+15 s" ${s.restSec >= LIMITS.restMax ? 'disabled' : ''}>+</button></div></div>
      <div class="srow"><span class="l"><strong>${t('alerts.title')}</strong><small>${t('alerts.sub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.restAlerts}" aria-label="${t('alerts.title')}" data-act="rest-alerts"></button></div>
      <div class="srow"><span class="l"><strong>${t('settings.readiness')}</strong><small>${t('settings.readinessSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.readiness}" aria-label="${t('settings.readiness')}" data-act="toggle" data-key="readiness"></button></div>
      <div class="srow"><span class="l"><strong>${t('settings.suggestions')}</strong><small>${t('settings.suggestionsSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.suggestions}" aria-label="${t('settings.suggestions')}" data-act="toggle" data-key="suggestions"></button></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.goals')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.cardioGoal')}</strong><small>${t('settings.cardioGoalSub')}</small></span>
        <div class="stepper"><button class="step" data-act="num" data-key="cardioGoal" data-d="-15" aria-label="−15" ${s.cardioGoal <= 30 ? 'disabled' : ''}>−</button><b>${s.cardioGoal}</b><button class="step" data-act="num" data-key="cardioGoal" data-d="15" aria-label="+15" ${s.cardioGoal >= 900 ? 'disabled' : ''}>+</button></div></div>
      <div class="srow"><span class="l"><strong>${t('settings.protein')}</strong><small>${t('settings.proteinSub')}</small></span>
        <div class="stepper"><button class="step" data-act="num" data-key="proteinPerKg" data-d="-0.2" aria-label="−0.2" ${s.proteinPerKg <= 1.2 ? 'disabled' : ''}>−</button><b>${num(s.proteinPerKg, state.lang, 1)}</b><button class="step" data-act="num" data-key="proteinPerKg" data-d="0.2" aria-label="+0.2" ${s.proteinPerKg >= 2.6 ? 'disabled' : ''}>+</button></div></div>
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
      <div class="srow"><span class="l"><strong>${t('settings.coachModel')}</strong><small>${esc(t('settings.modelUsing', { id: s.coachOverride || s.coachModel }))}</small></span></div>
      <div class="keyedit"><input data-set="coachOverride" value="${esc(s.coachOverride)}" placeholder="${esc(s.coachModel || FALLBACK_MODELS.coach)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('settings.coachModel')}"></div>
      <div class="srow"><span class="l"><strong>${t('settings.cmdModel')}</strong><small>${esc(t('settings.modelUsing', { id: s.cmdOverride || s.cmdModel }))}</small></span></div>
      <div class="keyedit"><input data-set="cmdOverride" value="${esc(s.cmdOverride)}" placeholder="${esc(s.cmdModel || FALLBACK_MODELS.command)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('settings.cmdModel')}"></div>
      <div class="srow"><span class="l"><strong>${t('settings.ttsModel')}</strong><small>${esc(t('settings.ttsModelSub', { id: s.ttsOverride || s.ttsModel }))}</small></span></div>
      <div class="keyedit"><input data-set="ttsOverride" value="${esc(s.ttsOverride)}" placeholder="${esc(s.ttsModel || DEFAULT_TTS_MODEL)}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('settings.ttsOverride')}"></div>
    </div></div>

    <div class="sgroup"><h2>${t('settings.data')}</h2><div class="slist solid">
      <button class="srow" data-act="backup-export"><span class="l"><strong>${t('backup.export')}</strong><small>${t('backup.exportSub')}</small></span>${I.download.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--accent)"')}</button>
      <button class="srow" data-act="backup-import"><span class="l"><strong>${t('backup.import')}</strong><small>${t('backup.importSub')}</small></span>${I.upload.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--accent)"')}</button>
      <input type="file" id="backupfile" accept="application/json,.json" hidden>
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
      if (st === 'ok') {
        const text = pickTextModels(r.models);
        setSettings({ ttsModel: pickTtsModel(r.models, null, 'natural') || '', ttsLite: pickTtsModel(r.models, null, 'fast') || '', cmdModel: text.command || '', coachModel: text.coach || '', cmdAlt: text.commandAlt || '', coachAlt: text.coachAlt || '' });
      }
    } catch { st = 'offline'; }
  }
  keyStatus[name] = st;
  haptic(st === 'ok' ? 'success' : 'error');
  renderSettings(root);
}

async function importFile(file) {
  const { t, lang } = state;
  let obj = null;
  try { obj = JSON.parse(await file.text()); } catch { obj = null; }
  const v = validateBackup(obj);
  if (!v.ok) { haptic('error'); toast({ title: esc(t('backup.bad', { why: obj ? v.error : 'JSON' })), error: true, ms: 6000 }); return; }
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('backup.confirmTitle')}</h2><p class="lead">${esc(t('backup.confirmBody', { w: v.data.workouts.length, c: v.data.cardio.length, date: obj.exportedAt ? new Date(obj.exportedAt).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-GB') : '?' }))}</p>
      <div class="acts"><button class="btn2 solid danger" data-k="yes">${I.upload}<span>${t('backup.confirm')}</span></button><button class="btn2 solid" data-k="no">${t('common.cancel')}</button></div>`);
    el.querySelector('[data-k=no]').onclick = () => closeTop();
    el.querySelector('[data-k=yes]').onclick = async e => {
      e.currentTarget.disabled = true;
      await closeTop();
      await importBackup(v.data);
      haptic('success');
      toast({ title: esc(state.t('backup.done')) });
    };
  }, { label: t('backup.confirmTitle') });
}

export function initSettings(actions, root) {
  root.addEventListener('change', e => { if (e.target.id === 'backupfile' && e.target.files?.[0]) { importFile(e.target.files[0]); e.target.value = ''; } });
  onSpeaking(on => { if (!on) { const el = root.querySelector('#speechstat'); if (el) el.textContent = speechStatus(); } });
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
      speak(state.t('settings.previewText'), { key: getKey('google'), model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang: state.lang, canSpeak: () => true });
    },
    set: el => { setSettings({ [el.dataset.key]: el.dataset.v }); haptic('tap'); },
    'rest-alerts': async () => {
      const { t } = state;
      if (state.settings.restAlerts) { setSettings({ restAlerts: false }); return; }
      if (!('Notification' in globalThis)) return;
      const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (p !== 'granted') { toast({ title: esc(t('alerts.denied')), error: true, ms: 5000 }); return; }
      setSettings({ restAlerts: true });
      haptic('success');
    },
    'backup-export': () => {
      const { t } = state;
      const blob = new Blob([JSON.stringify(makeBackup(state), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `setline-backup-${dateKey()}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      haptic('success');
      toast({ title: esc(t('backup.exported')) });
    },
    'backup-import': () => root.querySelector('#backupfile').click(),
    toggle: el => { setSettings({ [el.dataset.key]: !state.settings[el.dataset.key] }); haptic('tap'); },
    num: el => { setSettings({ [el.dataset.key]: Math.round((state.settings[el.dataset.key] + Number(el.dataset.d)) * 10) / 10 }); haptic('tap'); },
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
