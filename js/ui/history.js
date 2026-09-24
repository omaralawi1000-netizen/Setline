// History list and workout detail.
import { state } from '../store.js';
import { volume, doneSetCount, elapsedSec } from '../workout.js';
import { day, dayLong, time, minutes, total, weight, num } from '../format.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { workoutTitle } from './today.js';
import { cardioName, paceText } from '../cardio.js';
import { toDisplay } from '../units.js';
import { cardioIcon } from './cardio.js';

const u = () => state.t(`unit.${state.settings.unit}`);

function startOfWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

let filter = 'all';
export const setHistoryFilter = f => { filter = f; };

export function renderHistory(root) {
  const { t, lang } = state;
  const strength = state.history.map(w => ({ kind: 'w', t: w.startedAt, w }));
  const cardio = state.cardio.map(c => ({ kind: 'c', t: c.startedAt, c }));
  const all = [...(filter === 'cardio' ? [] : strength), ...(filter === 'strength' ? [] : cardio)].sort((a, b) => b.t - a.t);
  const seg = `<div class="seg hseg" role="group">${['all', 'strength', 'cardio'].map(f => `<button data-hfilter="${f}" aria-pressed="${filter === f}">${t('history.' + f)}</button>`).join('')}</div>`;
  let body;
  if (!state.history.length && !state.cardio.length) {
    body = `<div class="empty solid"><div class="emptyglyph">${I.history}</div><h2>${t('history.empty')}</h2><p>${t('history.emptySub')}</p></div>`;
  } else {
    const week = startOfWeek();
    const item = x => {
      if (x.kind === 'c') {
        const c = x.c, pace = paceText(c, lang);
        return `<li><button class="hitem solid cardio" data-act="detail" data-kind="cardio" data-id="${esc(c.id)}">
          <strong><span class="hic">${cardioIcon(c.type)}</span>${esc(cardioName(c.type, lang))}</strong>
          ${c.records?.length ? `<span class="tag">${t('history.prs', { n: c.records.length })}</span>` : ''}
          <span class="d">${esc(day(c.startedAt, lang))} · ${esc(time(c.startedAt, lang))}</span>
          <span class="stats"><span><b>${minutes(c.durationSec)}</b></span>${c.distanceKm ? `<span><b>${esc(num(c.distanceKm, lang, 2))}</b> km</span>` : ''}${pace ? `<span><b>${esc(pace)}</b></span>` : ''}${c.zone ? `<span>${t('cardio.zone', { n: c.zone })}</span>` : ''}</span>
        </button></li>`;
      }
      const w = x.w, prs = w.prs?.length || 0;
      return `<li><button class="hitem solid" data-act="detail" data-id="${esc(w.id)}">
        <strong>${esc(workoutTitle(w))}</strong>
        ${prs ? `<span class="tag">${t('history.prs', { n: prs })}</span>` : ''}
        <span class="d">${esc(day(w.startedAt, lang))} · ${esc(time(w.startedAt, lang))}</span>
        <span class="stats"><span><b>${minutes(elapsedSec(w))}</b></span><span><b>${total(volume(w), state.settings.unit, lang)}</b> ${u()}</span><span><b>${doneSetCount(w)}</b> ${t('history.sets', { n: doneSetCount(w) }).replace(/^\d+\s*/, '')}</span></span>
      </button></li>`;
    };
    const thisWeek = all.filter(x => x.t >= week), earlier = all.filter(x => x.t < week);
    body = (thisWeek.length ? `<p class="group">${t('history.thisWeek')}</p><ul class="hlist">${thisWeek.map(item).join('')}</ul>` : '')
      + (earlier.length ? `<p class="group">${t('history.earlier')}</p><ul class="hlist">${earlier.map(item).join('')}</ul>` : '')
      + (!all.length ? `<p class="none">${t('history.empty')}</p>` : '');
  }
  root.innerHTML = `<div class="tabtop"></div>
    <div class="hhead"><h1 class="h1 tabh">${t('history.title')}</h1><button class="iconbtn" data-progress aria-label="${t('progress.title')}">${I.chart}</button></div>${seg}${body}`;
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
      <div><b data-count="${Math.round(toDisplay(volume(w), state.settings.unit))}">${total(volume(w), state.settings.unit, lang)}</b><span>${t('history.volume')}, ${u()}</span></div>
      <div><b data-count="${doneSetCount(w)}">${doneSetCount(w)}</b><span>${t('history.setsLabel')}</span></div>
    </div>
    ${prs ? `<div class="prs solid"><span class="tag">${t('history.newPrs')}</span><ul>${prs}</ul></div>` : ''}
    ${w.exercises.map(ex => `<div class="exblock solid"><h3><button data-ex="${esc(ex.exerciseId)}">${esc(state.catalog.name(ex.exerciseId, lang))} <span class="chev">›</span></button></h3><ol>
      ${ex.sets.map((s, k) => `<li><span class="idx">${k + 1}</span><span class="val"><b>${weight(s.kg, state.settings.unit, lang)}</b> ${u()} × <b>${s.reps}</b></span>${prSets.has(s.id) ? `<span class="tag sm">${t('workout.pr')}</span>` : '<span></span>'}</li>`).join('')}
    </ol></div>`).join('')}
    ${w.exercises.length ? `<button class="log again" data-act="repeat-workout" data-id="${esc(w.id)}">${I.play}<span>${t('history.again')}</span></button>
    <p class="hint">${t('history.againSub')}</p>` : ''}`;
}
