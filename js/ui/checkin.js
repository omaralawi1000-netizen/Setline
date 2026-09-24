// Morning check-in card on Today: sleep, energy, soreness in a few taps, then a readiness summary.
import * as store from '../store.js';
import { state } from '../store.js';
import { readiness, routineGroups, SORE_GROUPS, sleepTrend } from '../checkin.js';
import { nextRoutine } from '../routines.js';
import { dateKey } from '../body.js';
import { checkinText } from '../commands.js';
import { getKey } from '../keys.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';

const SLEEP = [5, 6, 7, 8, 9];
const C = 2 * Math.PI * 21;
let draft = null;     // answers being given on the card
let editing = false;

export const todayCheckin = () => state.daily.find(d => d.date === dateKey()) || null;
export const nextGroups = () => routineGroups(nextRoutine([...state.routines].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), state.history), state.catalog);
export const todayReadiness = (groups = nextGroups()) => readiness(todayCheckin(), groups);

export function checkinHTML() {
  const { t, lang } = state;
  const c = todayCheckin();
  if (c && !editing) {
    const r = readiness(c, nextGroups());
    if (!r) return '';
    const tr = sleepTrend(state.daily, 7);
    return `<button class="ckdone solid ${r.advice}" data-ck="edit" aria-label="${esc(t('checkin.edit'))}">
      <span class="ckring"><svg viewBox="0 0 52 52" aria-hidden="true"><circle class="bg" cx="26" cy="26" r="21"/><circle class="fg" cx="26" cy="26" r="21" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - r.score / 5)}"/></svg><b>${r.score}</b></span>
      <span class="l"><strong>${esc(t('checkin.head.' + r.advice))}</strong><span>${esc(checkinText(c, t, lang))}</span>
      ${r.soreHit.length ? `<span class="ckwarn">${esc(t('checkin.soreHit', { what: r.soreHit.map(g => t('group.' + g)).join(', ') }))}</span>` : ''}</span>
      ${tr && tr.series.length >= 3 ? sleepBars(tr.series) : ''}
    </button>`;
  }
  // only asked in the first half of the day (or when editing)
  if (!c && new Date().getHours() >= 14) return '';
  const d = draft || (draft = { sleepH: c?.sleepH ?? null, energy: c?.energy ?? null, sore: [...(c?.sore || [])] });
  const on = (a, b) => (a === b ? 'true' : 'false');
  return `<div class="ckcard glass">
    <div class="rhead"><span class="label">${t('checkin.title')}</span>${getKey('groq') ? `<span class="cksay">${t('checkin.orSay')}</span>` : ''}</div>
    <div class="ckrow"><span class="ckl">${t('checkin.sleep')}</span><div class="ckopts">${SLEEP.map(h => `<button class="chip" data-ck="sleep" data-v="${h}" aria-pressed="${on(d.sleepH != null && (h === 9 ? d.sleepH >= 9 : Math.round(d.sleepH) === h), true)}">${h === 9 ? '9+' : h} ${lang === 'da' ? 't' : 'h'}</button>`).join('')}</div></div>
    <div class="ckrow"><span class="ckl">${t('checkin.energy')}</span><div class="ckopts energy">${[1, 2, 3, 4, 5].map(n => `<button class="chip e${n}" data-ck="energy" data-v="${n}" aria-pressed="${on(d.energy, n)}">${t('checkin.e' + n)}</button>`).join('')}</div></div>
    <div class="ckrow"><span class="ckl">${t('checkin.sore')}</span><div class="ckopts">${['none', ...SORE_GROUPS].map(g => `<button class="chip" data-ck="sore" data-v="${g}" aria-pressed="${g === 'none' ? on(d.sore.length, 0) : on(d.sore.includes(g), true)}">${esc(g === 'none' ? t('checkin.none') : t('group.' + g))}</button>`).join('')}</div></div>
    <button class="log" data-ck="save" ${d.sleepH == null && d.energy == null ? 'disabled' : ''}>${I.check}<span>${t('checkin.save')}</span></button>
  </div>`;
}

function sleepBars(series) {
  const max = Math.max(9, ...series.map(s => s.v));
  return `<span class="ckbars" aria-hidden="true">${series.map((s, i) => `<i style="--i:${i};transform:scaleY(${Math.max(0.08, s.v / max).toFixed(3)})"></i>`).join('')}</span>`;
}

// Tap handling on Today. Returns true if it handled the click.
export async function onCheckinClick(el, rerender) {
  const k = el.dataset.ck;
  if (k === 'edit') { editing = true; draft = null; haptic('tap'); return rerender(); }
  const d = draft || (draft = { sleepH: null, energy: null, sore: [] });
  if (k === 'sleep') d.sleepH = Number(el.dataset.v) === d.sleepH ? null : Number(el.dataset.v);
  else if (k === 'energy') d.energy = Number(el.dataset.v) === d.energy ? null : Number(el.dataset.v);
  else if (k === 'sore') {
    const g = el.dataset.v;
    d.sore = g === 'none' ? [] : d.sore.includes(g) ? d.sore.filter(x => x !== g) : [...d.sore, g];
  } else if (k === 'save') {
    const patch = { sore: d.sore };
    if (d.sleepH != null) patch.sleepH = d.sleepH;
    if (d.energy != null) patch.energy = d.energy;
    editing = false;
    draft = null;
    haptic('success');
    await store.saveCheckin(patch);
    return;
  }
  haptic('tap');
  // repaint just the chips, so the card doesn't flash
  const card = el.closest('.ckcard');
  if (!card) return rerender();
  for (const b of card.querySelectorAll('[data-ck]')) {
    const v = b.dataset.v, kind = b.dataset.ck;
    if (kind === 'sleep') b.setAttribute('aria-pressed', String(d.sleepH != null && (Number(v) === 9 ? d.sleepH >= 9 : Math.round(d.sleepH) === Number(v))));
    if (kind === 'energy') b.setAttribute('aria-pressed', String(d.energy === Number(v)));
    if (kind === 'sore') b.setAttribute('aria-pressed', String(v === 'none' ? !d.sore.length : d.sore.includes(v)));
    if (kind === 'save') b.disabled = d.sleepH == null && d.energy == null;
  }
}
