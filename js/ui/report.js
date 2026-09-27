// Report a bug, an idea or something important, straight from the app. Each report is kept here
// and sent as a GitHub issue on the app's repository (GitHub's own page opens filled in: one tap on
// "Submit"). The next coding session reads the issues. Errors the app runs into, and the last few
// things the voice heard, go along so a bug can be found. No keys, food or training data are sent.
import { state } from '../store.js';
import { VERSION } from '../version.js';
import { makeReport, sanitizeReports, issueUrl, reportsText, reportTitle, pushError, KINDS } from '../reports.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet } from './sheet.js';

const KEY = 'setline.reports', ERRS = 'setline.errors';
const load = (k, fallback = []) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const loadReports = () => sanitizeReports(load(KEY));
const saveReports = list => save(KEY, sanitizeReports(list));

// the last few things the voice heard (a misheard command is the most common bug)
let heard = [];
export function noteHeard(text) { const t = String(text || '').trim(); if (t) heard = [...heard, t.slice(0, 160)].slice(-5); }

// errors, kept across reloads (the last 12)
let errToast = false;
export function installErrorLog() {
  const add = (msg, where) => {
    save(ERRS, pushError(load(ERRS), { msg, where }));
    // once a session: a quiet way to report it
    if (errToast) return;
    errToast = true;
    setTimeout(() => toast({ title: esc(state.t('report.errToast')), action: state.t('report.report'), ms: 6000, onAction: () => openReport({ kind: 'bug' }) }), 600);
  };
  window.addEventListener('error', e => { if (e.message && !/ResizeObserver|Script error/i.test(e.message)) add(e.message, `${String(e.filename || '').split('/').pop()}:${e.lineno || ''}`); });
  window.addEventListener('unhandledrejection', e => { const r = e.reason; const m = r?.message || String(r || ''); if (m && !/AbortError|aborted/i.test(m + (r?.name || ''))) add(m, (r?.stack || '').split('\n')[1]?.trim().replace(/^at /, '').split('/').pop() || ''); });
}

function context() {
  const s = state.settings, ua = navigator.userAgent;
  const android = /Android ([\d.]+)/.exec(ua)?.[1], chrome = /Chrome\/([\d]+)/.exec(ua)?.[1];
  return {
    version: VERSION,
    screen: document.querySelector('.screen.on')?.dataset.screen || document.querySelector('.screen.on')?.id?.replace(/^s-/, '') || '',
    workout: !!state.active,
    device: `${android ? `Android ${android}` : navigator.platform || ''}${chrome ? ` · Chrome ${chrome}` : ''} · ${innerWidth}×${innerHeight}${matchMedia('(display-mode: standalone)').matches ? ' · installed' : ''}`,
    settings: `lang ${s.lang}, voice ${s.voiceLang}, mic ${s.micMode}, spoken ${s.spoken}, theme ${s.accent}, glass ${s.glass}, motion ${s.motion}`,
    heard: [...heard],
    errors: load(ERRS).slice(-6)
  };
}

export function send(r) {
  window.open(issueUrl(r), '_blank', 'noopener');
  saveReports(loadReports().map(x => (x.id === r.id ? { ...x, sent: true } : x)));
}

// Saved straight from a voice or Coach command ("bug: the rest timer froze"): a toast offers to send it.
export function quickReport(kind, text) {
  const r = makeReport({ kind, text, context: context() });
  if (!r.text) return openReport({ kind });
  saveReports([...loadReports(), r]);
  haptic('success');
  toast({ title: esc(state.t('report.saved')), sub: esc(reportTitle(r)), action: state.t('report.send'), ms: 8000, onAction: () => send(r) });
  return r;
}

export function openReport({ kind = 'bug', text = '' } = {}) {
  const { t } = state;
  let k = KINDS.includes(kind) ? kind : 'bug';
  openSheet(el => {
    const paint = (keep = '') => {
      const list = loadReports().reverse(), ctx = context();
      el.innerHTML = `<div class="sbody"><h2>${t('report.title')}</h2><p class="lead">${t('report.lead')}</p>
        <div class="opts rkinds">${KINDS.map(x => `<button class="chip" data-rk="${x}" aria-pressed="${x === k}">${t('report.kind.' + x)}</button>`).join('')}</div>
        <textarea class="brief solid" data-rtext rows="5" maxlength="2000" placeholder="${esc(t('report.ph.' + k))}">${esc(keep)}</textarea>
        <p class="snote">${esc(t('report.adds', { n: ctx.errors.length, h: ctx.heard.length }))}</p>
        <div class="acts"><button class="log" data-r="send">${I.upload}<span>${t('report.sendGit')}</span></button><button class="btn2 solid" data-r="save">${t('report.later')}</button></div>
        ${list.length ? `<div class="section"><span class="label">${t('report.yours', { n: list.length })}</span><button class="textbtn" data-r="copy">${t('report.copyAll')}</button></div>
          <ul class="rlist">${list.map(r => `<li class="solid"><span class="tag sm">${t('report.kind.' + r.kind)}</span><span class="rt">${esc(r.text.split('\n')[0].slice(0, 80))}</span>
            ${r.sent ? `<span class="rsent">${I.check}</span>` : `<button class="chip sm" data-r="resend" data-id="${esc(r.id)}">${t('report.send')}</button>`}<button class="iconbtn sm" data-r="del" data-id="${esc(r.id)}" aria-label="${esc(t('common.delete'))}">${I.close}</button></li>`).join('')}</ul>` : ''}
        <p class="snote">${t('report.how')}</p></div>`;
    };
    paint(text);
    const value = () => el.querySelector('[data-rtext]')?.value.trim() || '';
    el.addEventListener('click', async e => {
      const kb = e.target.closest('[data-rk]');
      if (kb) { haptic('tick'); k = kb.dataset.rk; paint(value()); return; }
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const act = b.dataset.r;
      if (act === 'send' || act === 'save') {
        const text = value();
        if (!text) { haptic('error'); el.querySelector('[data-rtext]')?.focus(); return; }
        const r = makeReport({ kind: k, text, context: context() });
        saveReports([...loadReports(), r]);
        haptic('success');
        if (act === 'send') send(r);
        else toast({ title: esc(t('report.saved')) });
        paint('');
        return;
      }
      if (act === 'resend') { const r = loadReports().find(x => x.id === b.dataset.id); if (r) { send(r); paint(value()); } return; }
      if (act === 'del') { haptic('tap'); saveReports(loadReports().filter(x => x.id !== b.dataset.id)); paint(value()); return; }
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(reportsText(loadReports())); haptic('success'); toast({ title: esc(t('report.copied')) }); } catch { toast({ title: esc(t('report.copyFail')), error: true }); }
      }
    });
  }, { label: t('report.title') });
}
