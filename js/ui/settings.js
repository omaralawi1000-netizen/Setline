// Settings: language, units, rest, voice and keys, haptics, motion, reset.
import { state, setSettings, resetAll } from '../store.js';
import { makeBackup } from '../backup.js';
import { driveGroupHTML, driveActions, setDriveRender, confirmImport } from './drive.js';
import { openOnboarding } from './onboard.js';
import { ageOf } from '../profile.js';
import { dateKey } from '../body.js';
import { VERSION } from '../version.js';
import { LIMITS } from '../workout.js';
import { STEP_GROUPS, STEP_CHOICES } from '../progression.js';
import { addMemories } from '../coach.js';
import { haptic } from '../haptics.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { esc } from './dom.js';
import { num } from '../format.js';
import { getKey, setKey, mask } from '../keys.js';
import { VOICES, VOICE_FEEL, DEFAULT_TTS_MODEL, ttsModelId, ttsAlt } from '../settings.js';
import { testGroqKey } from '../stt.js';
import { listModels, pickTtsModel, speak, lastSpeech, onSpeaking, lastClipWav } from '../tts.js';
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

// Weight steps: how far − and + move for each kind of kit (and how big the suggested jumps are)
const STEP_DEFAULT = { barbell: 2.5, dumbbell: 2, machine: 2.5 };
function stepsSummary() {
  const { t } = state;
  const s = state.settings.kgSteps || {};
  return STEP_GROUPS.map(g => `${t('steps.' + g)} ${num(s[g] || STEP_DEFAULT[g], state.lang, 2)} kg`).join(' · ');
}
function stepsSheet() {
  const { t } = state;
  openSheet(el => {
    const paint = () => {
      const s = state.settings.kgSteps || {};
      el.innerHTML = `<div class="sbody"><h2>${t('steps.title')}</h2><p class="lead">${t('steps.lead')}</p>
        ${STEP_GROUPS.map(g => `<div class="field"><label>${t('steps.' + g)}<small> · ${t('steps.' + g + 'Sub')}</small></label><div class="opts">${STEP_CHOICES.map(v => `<button class="chip" data-step="${g}" data-v="${v}" aria-pressed="${(s[g] || STEP_DEFAULT[g]) === v}">${num(v, state.lang, 2)} kg</button>`).join('')}</div></div>`).join('')}
        ${state.settings.unit === 'lb' ? `<p class="snote">${t('steps.lbNote')}</p>` : ''}</div>`;
    };
    paint();
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      haptic('tap');
      setSettings({ kgSteps: { ...(state.settings.kgSteps || {}), [b.dataset.step]: Number(b.dataset.v) } });
      paint();
    });
  }, { label: t('steps.title') });
}

function profileRow() {
  const { t } = state;
  const p = state.settings.profile;
  const age = ageOf(p);
  const bits = p ? [age && `${age} ${t('ob.years')}`, p.goal && t(`ob.goal.${p.goal}`), p.days && t('ob.daysShort', { n: p.days })].filter(Boolean).join(' · ') : t('profile.empty');
  return `<button class="profrow glass" data-act="edit-profile"><span class="pav">${esc((p?.name || '?').slice(0, 1).toUpperCase())}</span>
    <span class="l"><strong>${esc(p?.name || t('profile.title'))}</strong><span>${esc(bits)}</span></span><span class="go">${I.fwd}</span></button>`;
}

// What the Coach remembers about you (it adds to this itself when you tell it things), and the weekly check-in.
function memorySheet() {
  const { t } = state;
  openSheet(el => {
    const paint = () => {
      const list = state.settings.memories || [];
      el.innerHTML = `<div class="sbody"><h2>${t('memory.title')}</h2>
        <div class="field"><label>${t('brief.title')}</label><p class="snote">${t('brief.lead')}</p>
          <textarea class="brief solid" data-brief rows="7" maxlength="5000" placeholder="${esc(t('brief.ph'))}">${esc(state.settings.coachBrief || '')}</textarea>
          <div class="briefbar"><small data-brief-n>${(state.settings.coachBrief || '').length} / 5000</small><button class="btn2 solid" data-brief-save>${I.check}<span>${t('common.save')}</span></button></div></div>
        <div class="field"><label>${t('memory.facts')}</label><p class="snote">${t('memory.lead')}</p></div>
        ${list.length ? `<ul class="memlist">${[...list].reverse().map(m => `<li><span>${esc(m.text)}</span><button class="iconbtn sm" data-mem-del="${esc(m.id)}" aria-label="${esc(t('common.delete'))}">${I.close}</button></li>`).join('')}</ul>` : `<p class="snote">${t('memory.none')}</p>`}
        <form class="mdesc solid" data-mem-add><input name="m" maxlength="140" autocomplete="off" placeholder="${esc(t('memory.addPh'))}"><button class="send" aria-label="${esc(t('voice.send'))}">${I.plus}</button></form>
        <div class="slist solid" style="margin-top:14px"><div class="srow"><span class="l"><strong>${t('memory.weekly')}</strong><small>${t('memory.weeklySub')}</small></span>
          <button class="toggle" role="switch" aria-checked="${state.settings.weeklyCheckin}" aria-label="${t('memory.weekly')}" data-mem-weekly></button></div></div></div>`;
    };
    paint();
    el.addEventListener('click', e => {
      const d = e.target.closest('[data-mem-del]');
      if (d) { haptic('tap'); setSettings({ memories: (state.settings.memories || []).filter(m => m.id !== d.dataset.memDel) }); return paint(); }
      if (e.target.closest('[data-brief-save]')) {
        setSettings({ coachBrief: el.querySelector('[data-brief]').value.trim() });
        haptic('success'); toast({ title: esc(t('brief.saved')) }); return paint();
      }
      if (e.target.closest('[data-mem-weekly]')) { haptic('tap'); setSettings({ weeklyCheckin: !state.settings.weeklyCheckin }); return paint(); }
    });
    el.addEventListener('input', e => { if (e.target.matches('[data-brief]')) el.querySelector('[data-brief-n]').textContent = `${e.target.value.length} / 5000`; });
    el.addEventListener('submit', e => {
      e.preventDefault();
      const v = String(e.target.m?.value || '').trim();
      if (!v) return;
      haptic('success');
      setSettings({ memories: addMemories(state.settings.memories, [v]) });
      paint();
      el.querySelector('[data-mem-add] input')?.focus();
    });
  }, { label: t('memory.title') });
}

export function renderSettings(root) {
  const { t, settings: s } = state;
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${t('settings.title')}</strong></div><span class="spacer"></span>
    </header>
    <h1 class="h1">${t('settings.title')}</h1>
    ${profileRow()}
    <div class="slist solid memlink"><button class="srow" data-act="memory"><span class="l"><strong>${t('memory.title')}</strong><small>${esc([s.coachBrief ? t('brief.has') : '', t('memory.sub', { n: (s.memories || []).length })].filter(Boolean).join(' · '))}</small></span>${I.fwd}</button></div>

    <div class="sgroup"><h2>${t('settings.general')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.language')}</strong></span>${seg('lang', ['auto', 'da', 'en'], [t('lang.auto'), t('lang.da'), t('lang.en')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.units')}</strong></span>${seg('unit', ['kg', 'lb'], [t('unit.kg'), t('unit.lb')])}</div>
      <button class="srow" data-act="customize"><span class="l"><strong>${t('cust.title')}</strong><small>${t('look.settingsSub')}</small></span>${I.fwd}</button>
    </div></div>

    <div class="sgroup"><h2>${t('settings.voice')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.voiceLang')}</strong></span>${seg('voiceLang', ['auto', 'da', 'en'], [t('lang.auto'), t('lang.da'), t('lang.en')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.micMode')}</strong><small>${t('settings.micModeSub')}</small></span>${seg('micMode', ['hold', 'tap'], [t('mic.hold'), t('mic.tap')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.spoken')}</strong></span>${seg('spoken', ['off', 'minimal', 'full'], [t('spoken.off'), t('spoken.minimal'), t('spoken.full')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.ttsQuality')}</strong><small>${t('settings.ttsQualitySub')}</small></span>${seg('ttsQuality', ['natural', 'fast'], [t('tts.natural'), t('tts.fast')])}</div>
      <div class="srow"><span class="l"><strong>${t('settings.voiceName')}</strong><small id="speechstat">${esc(speechStatus())}</small></span>
        <span class="stepper"><select class="select" data-set="voice" aria-label="${t('settings.voiceName')}">${VOICES.map(n => `<option value="${n}" ${n === s.voice ? 'selected' : ''}>${n} · ${t('feel.' + VOICE_FEEL[n])}</option>`).join('')}</select>
        <button class="chip" data-act="preview-voice">${t('settings.preview')}</button></span></div>
      <button class="srow" data-act="save-reply"><span class="l"><strong>${t('settings.saveReply')}</strong><small>${t('settings.saveReplySub')}</small></span>${I.download.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--accent)"')}</button>
    </div></div>

    <div class="sgroup"><h2>${t('settings.keys')}</h2><div class="slist solid">
      ${keyRow('groq')}
      ${keyRow('google')}
    </div><p class="snote">${t('settings.privacy')}</p></div>

    <div class="sgroup"><h2>${t('settings.workout')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('settings.rest')}</strong><small>${t('settings.restSub')}</small></span>
        <div class="stepper"><button class="step" data-act="rest-default" data-d="-15" aria-label="−15 s" ${s.restSec <= LIMITS.restMin ? 'disabled' : ''}>−</button><b>${t('seconds', { n: s.restSec })}</b><button class="step" data-act="rest-default" data-d="15" aria-label="+15 s" ${s.restSec >= LIMITS.restMax ? 'disabled' : ''}>+</button></div></div>
      <button class="srow" data-act="kg-steps"><span class="l"><strong>${t('steps.title')}</strong><small>${esc(stepsSummary())}</small></span>${I.fwd}</button>
      <div class="srow"><span class="l"><strong>${t('settings.autoAdvance')}</strong><small>${t('settings.autoAdvanceSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.autoAdvance}" aria-label="${t('settings.autoAdvance')}" data-act="toggle" data-key="autoAdvance"></button></div>
      <div class="srow"><span class="l"><strong>${t('settings.autoWarmup')}</strong><small>${t('settings.autoWarmupSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.autoWarmup}" aria-label="${t('settings.autoWarmup')}" data-act="toggle" data-key="autoWarmup"></button></div>
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
      <div class="srow"><span class="l"><strong>${t('settings.fullscreen')}</strong><small>${t('settings.fullscreenSub')}</small></span>
        <button class="toggle" role="switch" aria-checked="${s.fullscreen}" aria-label="${t('settings.fullscreen')}" data-act="toggle" data-key="fullscreen"></button></div>
      <div class="srow"><span class="l"><strong>${t('settings.motion')}</strong></span>${seg('motion', ['auto', 'on', 'off'], [t('settings.motion.auto'), t('settings.motion.on'), t('settings.motion.off')])}</div>
    </div></div>

    ${driveGroupHTML()}

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
  let obj = null;
  try { obj = JSON.parse(await file.text()); } catch { obj = null; }
  confirmImport(obj);
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
  setDriveRender(() => { if (root.classList.contains('on')) renderSettings(root); });
  Object.assign(actions, driveActions, {
    'edit-profile': () => openOnboarding({ edit: true }),
    'test-key': el => testKey(el.dataset.k, root),
    'clear-key': el => { setKey(el.dataset.k, ''); delete keyStatus[el.dataset.k]; haptic('tap'); renderSettings(root); },
    'preview-voice': () => {
      unlockAudio();
      speak(state.t('settings.previewText'), { key: getKey('google'), model: ttsModelId(state.settings), alt: ttsAlt(state.settings), voice: state.settings.voice, lang: state.lang, canSpeak: () => true });
    },
    set: el => { setSettings({ [el.dataset.key]: el.dataset.v }); haptic('tap'); },
    'kg-steps': () => { haptic('tap'); stepsSheet(); },
    memory: () => { haptic('tap'); memorySheet(); },
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
    'save-reply': () => {
      const c = lastClipWav();
      if (!c) { toast({ title: esc(state.t('settings.saveReplyNone')) }); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(c.blob);
      a.download = `setline-reply-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      haptic('tap');
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
