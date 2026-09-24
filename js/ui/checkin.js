// Morning check-in on Today. One tap: how you feel. Sleep and sore spots are optional extras
// on the summary, one tap each.
import * as store from '../store.js';
import { state } from '../store.js';
import { readiness, routineGroups, SORE_GROUPS, sleepTrend } from '../checkin.js';
import { nextRoutine } from '../routines.js';
import { dateKey } from '../body.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';

const SLEEP = [5, 6, 7, 8, 9];
const C = 2 * Math.PI * 21;
let open = null;      // 'sleep' | 'sore' | 'feel': which extra row is showing on the summary

export const todayCheckin = () => state.daily.find(d => d.date === dateKey()) || null;
export const nextGroups = () => routineGroups(nextRoutine([...state.routines].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), state.history), state.catalog);

// A small face: the mouth goes from a frown (1) to a smile (5).
function face(n) {
  const c = (n - 3) / 2; // -1..1
  const y = 15.2 + c * 2.6;
  return `<svg class="face" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><circle class="eye" cx="9" cy="10" r="1.1"/><circle class="eye" cx="15" cy="10" r="1.1"/><path d="M8 ${(15.2 - c * 0.6).toFixed(1)} Q12 ${y.toFixed(1)} 16 ${(15.2 - c * 0.6).toFixed(1)}"/></svg>`;
}

const feelRow = (sel = null) => `<div class="feel" role="group">${[1, 2, 3, 4, 5].map(n => `<button class="fbtn f${n}" data-ck="feel" data-v="${n}" aria-pressed="${sel === n}">${face(n)}<span>${state.t('checkin.e' + n)}</span></button>`).join('')}</div>`;

export function checkinHTML() {
  const { t, lang } = state;
  const c = todayCheckin();
  if (!c) {
    if (new Date().getHours() >= 14) return ''; // a morning question only
    return `<div class="ckq glass"><strong>${t('checkin.feelQ')}</strong>${feelRow()}</div>`;
  }
  const r = readiness(c, nextGroups());
  if (!r) return '';
  const h = c.sleepH != null ? `${String(c.sleepH).replace('.', lang === 'da' ? ',' : '.')} ${lang === 'da' ? 't' : 'h'}` : null;
  const tr = sleepTrend(state.daily, 7);
  const extra = open === 'feel' ? feelRow(c.energy)
    : open === 'sleep' ? `<div class="ckopts">${SLEEP.map(v => `<button class="chip" data-ck="sleep" data-v="${v}" aria-pressed="${c.sleepH != null && (v === 9 ? c.sleepH >= 9 : Math.round(c.sleepH) === v)}">${v === 9 ? '9+' : v} ${lang === 'da' ? 't' : 'h'}</button>`).join('')}</div>`
    : open === 'sore' ? `<div class="ckopts">${SORE_GROUPS.map(g => `<button class="chip" data-ck="sore" data-v="${g}" aria-pressed="${c.sore.includes(g)}">${esc(t('group.' + g))}</button>`).join('')}<button class="chip done" data-ck="close">${t('checkin.done')}</button></div>`
    : '';
  return `<div class="ckdone solid ${r.advice}">
    <div class="ckmain">
      <button class="ckring" data-ck="open" data-v="feel" aria-label="${esc(t('checkin.edit'))}"><svg viewBox="0 0 52 52" aria-hidden="true"><circle class="bg" cx="26" cy="26" r="21"/><circle class="fg" cx="26" cy="26" r="21" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - r.score / 5)}"/></svg><b>${r.score}</b></button>
      <span class="l"><strong>${esc(t('checkin.head.' + r.advice))}</strong>
        ${r.soreHit.length ? `<span class="ckwarn">${esc(t('checkin.soreHit', { what: r.soreHit.map(g => t('group.' + g)).join(', ') }))}</span>` : `<span>${esc(t('checkin.feltShort', { feel: t('checkin.e' + (c.energy ?? 3)).toLowerCase() }))}</span>`}</span>
      ${tr && tr.series.length >= 3 ? `<span class="ckbars" aria-hidden="true">${tr.series.map((s, i) => `<i style="--i:${i};transform:scaleY(${Math.max(0.08, s.v / 9).toFixed(3)})"></i>`).join('')}</span>` : ''}
    </div>
    <div class="ckadd">
      <button class="chip${h ? ' is-set' : ''}" data-ck="open" data-v="sleep" aria-expanded="${open === 'sleep'}">${h ? esc(t('checkin.sleepShort', { h: h.replace(/ .+$/, '') })) : `+ ${t('checkin.sleep')}`}</button>
      <button class="chip${c.sore.length ? ' is-set' : ''}" data-ck="open" data-v="sore" aria-expanded="${open === 'sore'}">${c.sore.length ? esc(t('checkin.soreShort', { what: c.sore.map(g => t('group.' + g).toLowerCase()).join(', ') })) : `+ ${t('checkin.sore')}`}</button>
    </div>
    ${extra ? `<div class="ckextra">${extra}</div>` : ''}
  </div>`;
}

// Taps on Today.
export async function onCheckinClick(el, rerender) {
  const k = el.dataset.ck, v = el.dataset.v;
  const c = todayCheckin();
  if (k === 'feel') {
    const first = !c;
    open = null;
    haptic(first ? 'success' : 'tap');
    await store.saveCheckin({ energy: Number(v) });
    if (first) requestAnimationFrame(() => document.querySelector('.ckdone')?.classList.add('arrive'));
    return;
  }
  if (k === 'open') { open = open === v ? null : v; haptic('tap'); return rerender(); }
  if (k === 'close') { open = null; haptic('tap'); return rerender(); }
  if (k === 'sleep') { open = null; haptic('tap'); return store.saveCheckin({ sleepH: Number(v) === 9 && c?.sleepH >= 9 ? c.sleepH : Number(v) }); }
  if (k === 'sore') {
    const cur = c?.sore || [];
    haptic('tap');
    return store.saveCheckin({ sore: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
  }
}
