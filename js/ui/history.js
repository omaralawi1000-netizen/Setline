// History list and workout detail.
import { state } from '../store.js';
import { volume, doneSetCount, elapsedSec } from '../workout.js';
import { day, dayLong, time, minutes, total, weight } from '../format.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { workoutTitle } from './today.js';

const u = () => state.t(`unit.${state.settings.unit}`);

function startOfWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function renderHistory(root) {
  const { t, lang } = state;
  const list = state.history;
  let body;
  if (!list.length) {
    body = `<div class="empty solid"><div class="emptyglyph">${I.history}</div><h2>${t('history.empty')}</h2><p>${t('history.emptySub')}</p></div>`;
  } else {
    const week = startOfWeek();
    const item = w => {
      const prs = w.prs?.length || 0;
      return `<li><button class="hitem solid" data-act="detail" data-id="${esc(w.id)}">
        <strong>${esc(workoutTitle(w))}</strong>
        ${prs ? `<span class="tag">${t('history.prs', { n: prs })}</span>` : ''}
        <span class="d">${esc(day(w.startedAt, lang))} · ${esc(time(w.startedAt, lang))}</span>
        <span class="stats"><span><b>${minutes(elapsedSec(w))}</b></span><span><b>${total(volume(w), state.settings.unit, lang)}</b> ${u()}</span><span><b>${doneSetCount(w)}</b> ${t('history.sets', { n: doneSetCount(w) }).replace(/^\d+\s*/, '')}</span></span>
      </button></li>`;
    };
    const thisWeek = list.filter(w => w.startedAt >= week), earlier = list.filter(w => w.startedAt < week);
    body = (thisWeek.length ? `<p class="group">${t('history.thisWeek')}</p><ul class="hlist">${thisWeek.map(item).join('')}</ul>` : '')
      + (earlier.length ? `<p class="group">${t('history.earlier')}</p><ul class="hlist">${earlier.map(item).join('')}</ul>` : '');
  }
  root.innerHTML = `<div class="tabtop"></div>
    <h1 class="h1">${t('history.title')}</h1>${body}`;
}

function prLabel(p) {
  const { t, lang } = state;
  const unit = state.settings.unit;
  const kg = `${weight(p.kg, unit, lang)} ${u()}`;
  if (p.kind === 'weight') return [t('pr.weight'), `${kg} × ${p.reps}`];
  if (p.kind === 'e1rm') return [t('pr.e1rm'), `${weight(p.value, unit, lang)} ${u()}`];
  return [t('pr.reps', { kg }), `${p.reps}`];
}

export function renderDetail(root, id) {
  const { t, lang } = state;
  const w = state.history.find(x => x.id === id);
  if (!w) {
    root.innerHTML = `<header class="top"><button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button><span class="spacer"></span></header>
      <div class="empty solid"><h2>${t('history.empty')}</h2></div>`;
    return;
  }
  const prSets = new Map((w.prs || []).map(p => [p.setId, true]));
  const prs = (w.prs || []).map(p => {
    const [label, val] = prLabel(p);
    return `<li><span><b>${esc(state.catalog.name(p.exerciseId, lang))}</b><br>${esc(label)}</span><span class="v">${esc(val)}</span></li>`;
  }).join('');
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${esc(workoutTitle(w))}</strong><span>${esc(day(w.startedAt, lang))}</span></div>
      <span class="spacer"></span>
    </header>
    <h1 class="h1">${esc(workoutTitle(w))}</h1>
    <p class="detail-date">${esc(dayLong(w.startedAt, lang))} · ${esc(time(w.startedAt, lang))}</p>
    <div class="summary glass">
      <div><b>${minutes(elapsedSec(w))}</b><span>${t('history.duration')}</span></div>
      <div><b>${total(volume(w), state.settings.unit, lang)}</b><span>${t('history.volume')}, ${u()}</span></div>
      <div><b>${doneSetCount(w)}</b><span>${t('history.setsLabel')}</span></div>
    </div>
    ${prs ? `<div class="prs solid"><span class="tag">${t('history.newPrs')}</span><ul>${prs}</ul></div>` : ''}
    ${w.exercises.map(ex => `<div class="exblock solid"><h3>${esc(state.catalog.name(ex.exerciseId, lang))}</h3><ol>
      ${ex.sets.map((s, k) => `<li><span class="idx">${k + 1}</span><span class="val"><b>${weight(s.kg, state.settings.unit, lang)}</b> ${u()} × <b>${s.reps}</b></span>${prSets.has(s.id) ? `<span class="tag sm">${t('workout.pr')}</span>` : '<span></span>'}</li>`).join('')}
    </ol></div>`).join('')}`;
}
