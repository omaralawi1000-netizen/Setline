// Google Drive backup: Settings group, one-tap backup, restore, and the automatic daily run.
import { state, importBackup } from '../store.js';
import { makeBackup, validateBackup } from '../backup.js';
import * as D from '../drive.js';
import { getKey, setKey } from '../keys.js';
import { dateKey } from '../body.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';

let busy = false;
let rerender = () => {};
export const setDriveRender = fn => { rerender = fn; };

const autoOn = () => getKey('driveAuto') !== 'off';
const kb = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);

function when(at) {
  const { t, lang } = state;
  const d = new Date(at);
  const today = dateKey(), y = dateKey(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString(lang === 'da' ? 'da-DK' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const k = dateKey(at);
  return k === today ? t('drive.today', { time }) : k === y ? t('drive.yesterday', { time }) : d.toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' });
}

// Last backup more than two days ago (or never) while connected: worth a gentle nudge.
export const backupStale = (now = Date.now()) => D.connected() && autoOn() && (!D.lastBackup() || now - D.lastBackup().at > 2 * 86_400_000);

// One-tap backup row: shown after training when today's backup couldn't run on its own.
export function driveNudgeHTML({ stale = false } = {}) {
  if (!D.connected() || !autoOn() || D.hasToken()) return '';
  if (stale ? !backupStale() : !D.backupDue(D.lastBackup(), Date.now(), dateKey())) return '';
  const { t } = state;
  return `<button class="dnudge solid" data-act="drive-now"><span class="dicon2">${I.cloud}</span><span class="l"><strong>${t('drive.nudge')}</strong><span>${t('drive.nudgeSub')}</span></span><span class="go">${I.fwd}</span></button>`;
}

export function driveGroupHTML() {
  const { t } = state;
  const last = D.lastBackup();
  if (!D.connected()) {
    const id = D.clientId();
    return `<div class="sgroup"><h2>${t('drive.title')}</h2><div class="slist solid">
      <div class="srow"><span class="l"><strong>${t('drive.off')}</strong><small>${t('drive.offSub')}</small></span>${I.cloud.replace('class="i"', 'class="i" style="width:22px;height:22px;color:var(--accent)"')}</div>
      <div class="keyedit"><input data-key-input="driveClient" placeholder="${esc(id ? `••••${id.slice(-28)}` : t('drive.clientPh'))}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('drive.client')}"></div>
      ${id && !D.validClientId(id) ? `<p class="snote bad">${t('drive.clientBad')}</p>` : ''}
      <details class="dhelp"><summary>${t('drive.how')}</summary><ol>${t('drive.steps').map(s => `<li>${s}</li>`).join('')}</ol><p class="snote">${t('drive.origin')} <code>${esc(location.origin)}</code></p></details>
      <div class="srow"><button class="log" data-act="drive-connect" ${D.validClientId(id) ? '' : 'disabled'}>${I.cloud}<span>${t('drive.connect')}</span></button></div>
    </div><p class="snote">${t('drive.privacy')}</p></div>`;
  }
  return `<div class="sgroup"><h2>${t('drive.title')}</h2><div class="slist solid">
    <div class="srow"><span class="l"><strong>${t('drive.on')}</strong><small>${last ? esc(t('drive.last', { when: when(last.at), size: kb(last.bytes), kept: last.kept })) : t('drive.never')}</small></span><span class="dstat${last ? ' ok' : ''}">${I.cloud}</span></div>
    <div class="srow"><span class="l"><strong>${t('drive.auto')}</strong><small>${t('drive.autoSub')}</small></span>
      <button class="toggle" role="switch" aria-checked="${autoOn()}" aria-label="${t('drive.auto')}" data-act="drive-auto"></button></div>
    <button class="srow" data-act="drive-now"><span class="l"><strong>${t('drive.now')}</strong></span>${I.upload.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--accent)"')}</button>
    <button class="srow" data-act="drive-restore"><span class="l"><strong>${t('drive.restore')}</strong><small>${t('drive.restoreSub')}</small></span>${I.download.replace('class="i"', 'class="i" style="width:20px;height:20px;color:var(--accent)"')}</button>
    <button class="srow" data-act="drive-off"><span class="l"><strong>${t('drive.disconnect')}</strong></span></button>
  </div></div>`;
}

function errorText(e) {
  const { t } = state;
  const code = e?.code || 'failed';
  return t({ noclient: 'drive.err.client', denied: 'drive.err.denied', closed: 'drive.err.closed', popup: 'drive.err.popup', offline: 'coach.offline', network: 'coach.offline', api: 'drive.err.api', signin: 'drive.err.signin', bad: 'drive.err.bad' }[code] || 'drive.err.failed');
}

// Back up now. interactive: allowed to show Google's sign-in (only right after a tap).
export async function backupNow({ interactive = true, quiet = false } = {}) {
  if (busy) return false;
  busy = true;
  try {
    const tok = await D.token({ interactive });
    const r = await D.upload(makeBackup(state), dateKey(), tok);
    D.setLastBackup({ at: Date.now(), date: dateKey(), bytes: r.bytes, kept: r.kept });
    if (!quiet) { haptic('success'); toast({ title: esc(state.t('drive.done')), sub: esc(state.t('drive.doneSub', { size: kb(r.bytes) })) }); }
    for (const n of document.querySelectorAll('.dnudge')) { n.classList.add('gone'); setTimeout(() => n.remove(), 300); }
    return true;
  } catch (e) {
    if (!quiet) { haptic('error'); toast({ title: esc(errorText(e)), error: true, ms: 6000 }); }
    return false;
  } finally { busy = false; rerender(); }
}

// Once a day, silently, when a sign-in from the last hour is still valid.
export function autoBackup() {
  if (!D.connected() || !autoOn() || !D.hasToken()) return;
  if (!D.backupDue(D.lastBackup(), Date.now(), dateKey())) return;
  backupNow({ interactive: false, quiet: true });
}

async function connect() {
  try {
    await D.token({ interactive: true });
    setKey('driveOn', '1');
    await backupNow({ interactive: false });
  } catch (e) { haptic('error'); toast({ title: esc(errorText(e)), error: true, ms: 6000 }); }
  rerender();
}

async function restoreFlow() {
  const { t, lang } = state;
  let files;
  try { files = await D.listBackups(await D.token({ interactive: true })); }
  catch (e) { haptic('error'); return toast({ title: esc(errorText(e)), error: true, ms: 6000 }); }
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<div class="sbody"><h2>${t('drive.restore')}</h2><p class="lead">${t('drive.pick')}</p>
      ${files.length ? `<ul class="dfiles">${files.map(f => `<li><button class="srow solid" data-f="${esc(f.id)}"><span class="l"><strong>${esc(new Date(D.dateOfFile(f.name)).toLocaleDateString(lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</strong><small>${kb(Number(f.size) || 0)}</small></span>${I.fwd}</button></li>`).join('')}</ul>` : `<div class="empty"><h2>${t('drive.none')}</h2></div>`}</div>`);
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      b.disabled = true;
      try {
        const obj = await D.download(b.dataset.f, await D.token({ interactive: true }));
        await closeTop();
        confirmImport(obj);
      } catch (err) { b.disabled = false; haptic('error'); toast({ title: esc(errorText(err)), error: true }); }
    });
  }, { label: t('drive.restore') });
}

// Shared by file import and Drive restore: validate everything, then ask.
export function confirmImport(obj) {
  const { t, lang } = state;
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

export const driveActions = {
  'drive-connect': () => connect(),
  'drive-now': () => backupNow(),
  'drive-restore': () => restoreFlow(),
  'drive-auto': () => { setKey('driveAuto', autoOn() ? 'off' : ''); haptic('tap'); rerender(); },
  'drive-off': () => { D.signOut(); haptic('tap'); rerender(); }
};
