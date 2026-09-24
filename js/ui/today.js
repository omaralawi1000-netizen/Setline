// Today: the hub. Streak, what's next, cardio, the week, body, last week's review, routines.
import { state } from '../store.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { routineName, estimateMinutes, nextRoutine } from '../routines.js';
import { greetingKey, clock, total, weight, num } from '../format.js';
import { toDisplay } from '../units.js';
import { doneSetCount, elapsedSec } from '../workout.js';
import { getKey } from '../keys.js';
import { thisWeek, lastSessionSummary, latestPR, sparkline, weekStreak, weekReview, weekStart } from '../stats.js';
import { cardioMinutes, cardioName, cardioElapsed, paceText } from '../cardio.js';
import { bodyTrend, proteinTarget, dateKey } from '../body.js';
import { cardioIcon, favouriteTypes } from './cardio.js';
import { muscleBalance, deloadStatus } from '../insights.js';
import { driveNudgeHTML } from './drive.js';

const MIC = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0M12 18v3"/></svg>';
const C = 157.08; // ring r=25
const DAY = 86_400_000;

export function workoutTitle(w) {
  const r = w.routineId && state.routines.find(r => r.id === w.routineId);
  return r ? routineName(r, state.lang) : (w.name || state.t('workout.untitled'));
}

const sortedRoutines = () => [...state.routines].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

// "Up next" hero: the routine done least recently.
function upNextHTML() {
  const { t, lang, catalog } = state;
  const r = nextRoutine(sortedRoutines(), state.history);
  if (!r) return `<div class="upcoming glass"><span class="label">${t('label.routines')}</span><h2>${t('routine.none')}</h2>
      <div class="row2"><button class="log" data-routine="new">${I.plus}<span>${t('routine.new')}</span></button><button class="btn2 solid" data-routine="programs">${t('routine.program')}</button></div></div>`;
  const names = r.exercises.map(e => catalog.name(e.exerciseId, lang));
  return `<div class="upcoming glass">
      <span class="label">${t('label.upNext')}</span>
      <h2>${esc(routineName(r, lang))}</h2>
      <p>${t('today.exercisesAbout', { n: r.exercises.length, min: estimateMinutes(r) })}</p>
      <p class="exnames">${esc(names.slice(0, 4).join(' · '))}${names.length > 4 ? ` · +${names.length - 4}` : ''}</p>
      <button class="log" data-act="start-routine" data-id="${esc(r.id)}">${I.play}<span>${t('today.start')}</span></button>
      ${getKey('groq') ? `<p class="sayhint">${MIC}${esc(t('today.orSay', { text: `start ${routineName(r, lang).toLowerCase()}` }))}</p>` : ''}
    </div>`;
}

function resumeHTML() {
  const { t, lang } = state;
  const w = state.active;
  if (w) {
    const cur = w.exercises[w.current];
    return `<div class="upcoming glass">
      <span class="live"><i></i><span data-elapsed>${esc(clock(elapsedSec(w)))}</span></span>
      <h2>${esc(workoutTitle(w))}</h2>
      <p>${t('today.resumeSub', { sets: doneSetCount(w) })}${cur ? ` · ${esc(state.catalog.name(cur.exerciseId, lang))}` : ''}</p>
      <button class="log" data-act="go" data-to="workout"><span>${t('today.resume')}</span></button>
    </div>`;
  }
  const a = state.activeCardio;
  return `<div class="upcoming glass">
      <span class="live${a.pausedAt ? ' paused' : ''}"><i></i><span data-cclock>${esc(clock(cardioElapsed(a)))}</span></span>
      <h2>${esc(cardioName(a.type, lang))}</h2>
      <p>${t(a.pausedAt ? 'cardio.paused' : 'cardio.running')}</p>
      <button class="log" data-act="go" data-to="workout"><span>${t('today.resume')}</span></button>
    </div>`;
}

// Start cards, shared with the Workout tab's empty state.
export function startCardsHTML() {
  return upNextHTML() + cardioRowHTML() + routinesHTML();
}

function cardioRowHTML() {
  const { t, lang } = state;
  return `<div class="section"><span class="label">${t('label.cardio')}</span><button class="textbtn" data-cardio="log">${t('cardio.logPast')}</button></div>
    <div class="crow">${favouriteTypes(4).map(id => `<button class="cstart solid" data-cardio="start" data-type="${id}">${cardioIcon(id)}<span>${esc(cardioName(id, lang))}</span></button>`).join('')}
      <button class="cstart solid more" data-cardio="more"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg><span>${t('cardio.more')}</span></button></div>
    ${againChip()}`;
}

// One tap repeats the last cardio session (not when it was already today).
function againChip() {
  const { t, lang } = state;
  const c = state.cardio[0];
  if (!c || dateKey(c.startedAt) === dateKey()) return '';
  const what = c.distanceKm ? `${num(c.distanceKm, lang, c.distanceKm % 1 ? 1 : 0)} km` : t('min', { n: Math.round(c.durationSec / 60) });
  return `<button class="againchip" data-cardio="again" data-id="${esc(c.id)}"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/></svg><span>${esc(t('cardio.sameAgain', { name: cardioName(c.type, lang), what }))}</span></button>`;
}

function routinesHTML() {
  const { t, lang } = state;
  const list = sortedRoutines();
  return `<div class="section"><span class="label">${t('label.routines')}</span><button class="textbtn" data-routine="programs">${t('routine.program')}</button></div>
    <ul class="rlist">${list.map(r => `<li class="rrow solid">
        <button class="rmain" data-act="start-routine" data-id="${esc(r.id)}"><strong>${esc(routineName(r, lang))}</strong><span>${t('routine.exercises', { n: r.exercises.length })} · ${t('min', { n: estimateMinutes(r) })}</span></button>
        <button class="iconbtn" data-routine="edit" data-id="${esc(r.id)}" aria-label="${t('routine.edit')}"><svg class="i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button>
      </li>`).join('')}</ul>
    <div class="row2"><button class="btn2 solid" data-routine="new">${I.plus}<span>${t('routine.new')}</span></button><button class="btn2 solid" data-act="start-empty">${I.workout}<span>${t('workout.emptyTitle')}</span></button></div>`;
}

function weekCardsHTML() {
  const { t, lang, settings } = state;
  const unit = settings.unit;
  const u = t(`unit.${unit}`);
  const wk = thisWeek(state.history);
  const cardioWeek = state.cardio.filter(c => c.startedAt >= weekStart(Date.now()) && c.durationSec >= 1200);
  const done = wk.count + cardioWeek.length;
  const goal = settings.weeklyGoal;
  const days = [...wk.days];
  for (const c of cardioWeek) days[Math.min(6, Math.floor((c.startedAt - weekStart(Date.now())) / DAY))] = true;
  const letters = t('today.days').split(' ');
  const week = `<div class="mini solid" role="img" aria-label="${esc(t('today.weekAria', { n: done, goal }))}"><span class="label">${t('today.workouts')}</span>
      <div class="week"><div class="ring"><svg viewBox="0 0 60 60" aria-hidden="true"><circle class="bg" cx="30" cy="30" r="25"/><circle class="fg" cx="30" cy="30" r="25" style="stroke-dashoffset:${C}" data-to="${C * (1 - Math.min(1, done / goal))}"/></svg><b>${done}/${goal}</b></div></div>
      <div class="days" aria-hidden="true">${days.map((on, i) => `<i class="${on ? 'on' : ''}${i === wk.today ? ' now' : ''}" title="${letters[i]}"></i>`).join('')}</div>
    </div>`;
  const cm = cardioMinutes(state.cardio, weekStart(Date.now()), weekStart(Date.now()) + 7 * DAY);
  const cardio = `<div class="mini solid"><span class="label">${t('label.cardio')}</span>
      <span class="vol"><b><i class="n" data-count="${cm.minutes}">${cm.minutes}</i><small> / ${settings.cardioGoal} min</small></b>
      <span class="cbar"><i style="transform:scaleX(${Math.min(1, cm.minutes / settings.cardioGoal)})"></i></span>
      <span>${cm.minutes ? esc(t('cardio.zone2', { min: cm.zone2 })) : t('cardio.none')}</span></span></div>`;
  let html = `<div class="grid2">${week}${cardio}</div>`;

  const last = lastSessionSummary(state.history);
  const lastCardio = state.cardio[0];
  const cards = [];
  if (last) cards.push(`<button class="mini solid" data-act="detail" data-id="${esc(last.workout.id)}"><span class="label">${t('today.lastSession')}</span><strong>${esc(workoutTitle(last.workout))}</strong>
      <span class="vol"><b data-count="${Math.round(toDisplay(last.volume, unit))}">${total(last.volume, unit, lang)}</b><span>${esc(t('today.lastSessionSub', { volume: '', unit: u, min: last.minutes }).trim())}</span></span></button>`);
  if (lastCardio) {
    const pace = paceText(lastCardio, lang);
    cards.push(`<button class="mini solid" data-act="detail" data-kind="cardio" data-id="${esc(lastCardio.id)}"><span class="label">${esc(cardioName(lastCardio.type, lang))}</span><strong>${lastCardio.distanceKm ? esc(num(lastCardio.distanceKm, lang, 2)) + ' km' : esc(t('min', { n: Math.round(lastCardio.durationSec / 60) }))}</strong>
      <span class="vol"><b>${esc(clock(lastCardio.durationSec).replace(/^00:/, '0:'))}</b><span>${pace ? esc(pace) : lastCardio.zone ? t('cardio.zone', { n: lastCardio.zone }) : '&nbsp;'}</span></span></button>`);
  }
  if (cards.length) html += `<div class="grid2${cards.length === 1 ? ' one' : ''}">${cards.join('')}</div>`;

  const p = latestPR(state.history);
  if (p) {
    const name = state.catalog.name(p.pr.exerciseId, lang);
    const kgTxt = kg => `${weight(kg, unit, lang)} ${u}`;
    const headline = p.pr.kind === 'reps' ? `${p.pr.reps} × ${kgTxt(p.pr.kg)}` : `${kgTxt(p.pr.kg)} × ${p.pr.reps}`;
    const sub = p.pr.kind === 'weight' ? (p.deltaKg ? t('today.prUp', { name, kg: kgTxt(p.deltaKg) }) : t('today.prFirst', { name }))
      : p.pr.kind === 'e1rm' ? t('today.prE1rm', { name, v: kgTxt(p.pr.value) }) : t('today.prReps', { name, reps: p.pr.reps, kg: kgTxt(p.pr.kg) });
    const sp = sparkline(p.series);
    const chart = sp ? `<svg viewBox="0 0 120 56" aria-hidden="true"><path d="${sp.area}" fill="url(#sf)"/><polyline points="${sp.line}" fill="none" stroke="url(#sp)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${sp.last.x}" cy="${sp.last.y}" r="4.5" fill="#FFD9A8"/><circle class="pulse" cx="${sp.last.x}" cy="${sp.last.y}" r="9" fill="#FFD9A8" opacity=".18"/></svg>` : '';
    html += `<button class="pr solid" data-act="detail" data-id="${esc(p.workout.id)}"><span class="l"><span class="tag">${t('today.newPr')}</span><strong>${esc(headline)}</strong><span class="p">${esc(sub)}</span></span>${chart}</button>`;
  }
  return html;
}

// Sets per muscle group this week against a rough target. Bars grow in; the group most behind is named.
export function balanceHTML({ always = false } = {}) {
  const { t } = state;
  const recent = state.history.some(w => w.startedAt > Date.now() - 28 * DAY);
  if (!recent && !always) return '';
  const b = muscleBalance(state.history, state.catalog);
  const note = b.behind ? t('balance.behind', { group: t('group.' + b.behind.group), n: b.behind.sets, target: b.behind.target })
    : b.total ? t('balance.ok') : t('balance.none');
  return `<div class="mbal solid"><div class="rhead"><span class="label">${t('balance.title')}</span><span class="mnote${b.behind ? ' warn' : ''}">${esc(note)}</span></div>
    <div class="mrows">${b.rows.map((r, i) => `<div class="mrow${b.behind?.group === r.group ? ' behind' : ''}${r.pct >= 1 ? ' full' : ''}" style="--i:${i}"><span>${esc(t('group.' + r.group))}</span><i><b style="transform:scaleX(${r.pct.toFixed(3)})"></b></i><em>${num(r.sets, state.lang, r.sets % 1 ? 1 : 0)}<small>/${r.target}</small></em></div>`).join('')}</div>
  </div>`;
}

// Deload: offered after 6 steady weeks, shown while running.
function deloadHTML() {
  const { t, lang } = state;
  const d = deloadStatus(state.history, state.settings);
  if (!d) return '';
  if (d.state === 'active') {
    const until = new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : 'en-GB', { weekday: 'long' }).format(d.until - 1);
    return `<div class="dlcard solid on"><span class="dicon">${I.flame}</span><div class="l"><strong>${t('deload.activeTitle')}</strong><span>${esc(t('deload.activeSub', { day: until }))}</span></div><button class="textbtn" data-deload="end">${t('deload.end')}</button></div>`;
  }
  return `<div class="dlcard glass"><div class="l"><span class="label">${t('deload.label')}</span><strong>${esc(t('deload.dueTitle', { n: d.weeks }))}</strong><span>${t('deload.dueSub')}</span></div>
    <div class="row2"><button class="log" data-deload="start"><span>${t('deload.start')}</span></button><button class="btn2 solid" data-deload="later">${t('deload.later')}</button></div></div>`;
}

function bodyHTML() {
  const { t, lang, settings } = state;
  const unit = settings.unit, u = t(`unit.${unit}`);
  const tr = bodyTrend(state.bodyweight);
  const target = tr ? proteinTarget(tr.latest.kg, settings.proteinPerKg) : null;
  const today = state.nutrition.find(n => n.date === dateKey())?.protein || 0;
  const sp = tr ? sparkline(tr.series, 96, 40, 6) : null;
  const weightCard = `<button class="mini solid body" data-body="weight"><span class="label">${t('body.weight')}</span>
      ${tr ? `<strong>${esc(weight(tr.latest.kg, unit, lang))} <small>${u}</small></strong>
        <span class="bsub">${tr.change30 != null ? esc(t('body.change', { sign: tr.change30 > 0 ? '+' : tr.change30 < 0 ? '−' : '±', kg: `${weight(Math.abs(tr.change30), unit, lang)} ${u}` })) : esc(t('body.avg', { kg: `${weight(tr.avg, unit, lang)} ${u}` }))}</span>
        ${sp ? `<svg class="bspark" viewBox="0 0 96 40" aria-hidden="true"><polyline points="${sp.line}" fill="none" stroke="url(#sp)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${sp.last.x}" cy="${sp.last.y}" r="3" fill="#C6BBFA"/></svg>` : ''}`
      : `<span class="bsub">${t('body.noWeight')}</span><span class="bplus">${I.plus}</span>`}
    </button>`;
  const pct = target ? Math.min(1, today / target) : 0;
  const R = 2 * Math.PI * 21;
  const proteinCard = `<div class="mini solid protein"><span class="label">${t('body.protein')}</span>
      <div class="prow2"><div class="pring"><svg viewBox="0 0 52 52" aria-hidden="true"><circle class="bg" cx="26" cy="26" r="21"/><circle class="fg" cx="26" cy="26" r="21" style="stroke-dasharray:${R};stroke-dashoffset:${R * (1 - pct)}"/></svg><b>${today}</b></div>
      <span class="bsub">${target ? esc(t('body.proteinOf', { g: today, target })) : t('body.proteinNeedsBw')}</span></div>
      <div class="padd">${[20, 30, 40].map(g => `<button class="chip" data-body="protein" data-g="${g}">+${g}</button>`).join('')}</div>
    </div>`;
  const day = state.nutrition.find(n => n.date === dateKey());
  const meals = day?.meals?.length || 0;
  const mealRow = `<button class="mealrow solid" data-body="meal"><span class="mcam">${I.camera}</span>
      <span class="l"><strong>${t('meal.snap')}</strong><span>${meals ? esc(t('meal.todaySub', { n: meals, kcal: day.kcal || 0 })) : t('meal.snapSub')}</span></span>
      <span class="go">${I.fwd}</span></button>`;
  return `<div class="section"><span class="label">${t('label.body')}</span></div><div class="grid2">${weightCard}${proteinCard}</div>${mealRow}`;
}

function reviewHTML() {
  const { t, lang, settings } = state;
  const r = weekReview(state.history, state.cardio);
  if (!r) return '';
  const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '±');
  return `<div class="review solid">
      <div class="rhead"><span class="label">${t('review.title')}</span>${r.prs ? `<span class="tag sm">${t('review.prs', { n: r.prs })}</span>` : ''}</div>
      <div class="rstats">
        <div><b>${r.workouts + r.cardioSessions}</b><span>${esc(t('review.workouts', { n: r.workouts + r.cardioSessions }).replace(/^\d+\s*/, ''))}</span></div>
        <div><b data-count="${Math.round(toDisplay(r.volume, settings.unit))}">${total(r.volume, settings.unit, lang)}</b><span>${t('review.volume')}, ${t(`unit.${settings.unit}`)}${r.volumeChange != null ? ` · ${sign(r.volumeChange)}${Math.abs(r.volumeChange)}%` : ''}</span></div>
        <div><b data-count="${r.cardioMin}">${r.cardioMin}</b><span>${t('min', { n: '' }).trim()} ${t('label.cardio').toLowerCase()}${r.cardioChange != null ? ` · ${sign(r.cardioChange)}${Math.abs(r.cardioChange)}%` : ''}</span></div>
      </div>
      ${getKey('google') ? `<button class="btn2 soft" data-review="ask">${I.chat}<span>${t('review.ask')}</span></button>` : ''}
    </div>`;
}

function subline() {
  const { t, settings } = state;
  if (state.active || state.activeCardio) return t('today.inProgress');
  const s = weekStreak(state.history, state.cardio, settings.weeklyGoal);
  if (s.streak) return `${t('streak.weeks', { n: s.streak })} · ${t('streak.thisWeek', { n: s.thisWeek, goal: s.goal })}`;
  if (s.thisWeek) return t('streak.thisWeek', { n: s.thisWeek, goal: s.goal });
  return t('today.ready');
}

export function renderToday(root) {
  const { t } = state;
  const hour = new Date().getHours();
  const busy = state.active || state.activeCardio;
  root.innerHTML = `<header class="brand">
      <div><strong>Setline</strong><span>${t('app.tagline')}</span></div>
      <button class="iconbtn" data-act="open-settings" aria-label="${t('settings.title')}">${I.settings}</button>
    </header>
    <h1 class="greet">${t(greetingKey(hour)).split(' ').map((w, i) => `<span class="gw" style="--i:${i}">${esc(w)}</span>`).join(' ')}</h1>
    <p class="sub${!busy && weekStreak(state.history, state.cardio, state.settings.weeklyGoal).streak ? ' streak' : ''}">${esc(subline())}</p>
    ${busy ? '' : driveNudgeHTML({ stale: true })}
    ${busy ? '' : deloadHTML()}
    ${busy ? resumeHTML() : upNextHTML()}
    ${busy ? '' : cardioRowHTML()}
    <div class="section"><span class="label">${t('today.thisWeek')}</span><button class="textbtn" data-progress>${t('progress.link')} →</button></div>
    ${weekCardsHTML()}
    ${balanceHTML()}
    ${bodyHTML()}
    ${reviewHTML()}
    ${busy ? '' : routinesHTML()}`;
  const fg = root.querySelector('.week .fg');
  if (fg) {
    const to = fg.dataset.to;
    if (root.classList.contains('enter')) requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = to; }));
    else fg.style.strokeDashoffset = to;
  }
}

