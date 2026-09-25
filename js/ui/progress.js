// Progress: weekly volume and cardio, bodyweight, lifts, records. Exercise detail with its e1RM curve.
import { state } from '../store.js';
import { weeklySeries, prTimeline, liftSummaries } from '../stats.js';
import { sessionsFor, suggest } from '../progression.js';
import { bodyTrend } from '../body.js';
import { bestsFrom } from '../pr.js';
import { weight, day } from '../format.js';
import { joinList } from '../i18n.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { barChart, lineChart } from './charts.js';
import { sparkline } from '../stats.js';
import { balanceHTML } from './today.js';
import { sleepTrend } from '../checkin.js';
import { figureHTML } from './figure.js';

let range = 12;
export const setRange = r => { range = r; };

const u = () => state.t(`unit.${state.settings.unit}`);
const kg = v => weight(v, state.settings.unit, state.lang);
const short = t => new Intl.DateTimeFormat(state.lang === 'da' ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'short' }).format(t);

export function renderProgress(root) {
  const { t, lang } = state;
  const weeks = weeklySeries(state.history, state.cardio, range);
  const vol = weeks.reduce((a, w) => a + w.volume, 0);
  const cmin = weeks.reduce((a, w) => a + w.cardioMin, 0);
  const axis = [{ x: 'start', text: short(weeks[0].t) }, { x: 'end', text: t('progress.thisWeek') }];
  const bw = bodyTrend(state.bodyweight);
  const lifts = liftSummaries(state.history).slice(0, 8);
  const prs = prTimeline(state.history).slice(0, 12);
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : 0);
  const none = !state.history.length && !state.cardio.length; // nothing yet: one calm card, no empty charts
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${t('progress.title')}</strong></div><span class="spacer"></span>
    </header>
    <h1 class="h1">${t('progress.title')}</h1>
    ${none ? `<div class="empty solid"><div class="emptyglyph">${I.chart}</div><h2>${t('progress.empty')}</h2><p>${t('progress.emptySub')}</p>
      <button class="log" data-act="go" data-to="workout">${t('progress.startFirst')}</button></div>` : `
    <div class="seg hseg" role="group">${[4, 12, 52].map(n => `<button data-prange="${n}" aria-pressed="${range === n}">${t('progress.weeks', { n })}</button>`).join('')}</div>

    <div class="chartcard solid">
      <div class="chead"><span class="label">${t('progress.volume')}</span><span class="cval"><b data-count="${Math.round(vol)}">0</b> ${u()}</span></div>
      ${barChart(weeks.map((w, i) => ({ v: w.volume, label: short(w.t), hot: i === weeks.length - 1 })), { axis, fmt: v => `${Math.round(v)} ${u()}` })}
    </div>
    <div class="chartcard solid">
      <div class="chead"><span class="label">${t('label.cardio')}</span><span class="cval"><b data-count="${cmin}">0</b> min</span></div>
      ${barChart(weeks.map((w, i) => ({ v: w.cardioMin, label: short(w.t), hot: i === weeks.length - 1 })), { axis, color: 'blue', fmt: v => `${Math.round(v)} min` })}
    </div>`}
    ${bw && bw.series.length >= 2 ? `<div class="chartcard solid">
      <div class="chead"><span class="label">${t('body.weight')}</span><span class="cval"><b>${kg(bw.latest.kg)}</b> ${u()}</span></div>
      ${lineChart(bw.series, { h: 110, fmt: v => kg(v) })}</div>` : ''}

    ${state.history.length ? balanceHTML({ always: true }) : ''}
    ${sleepHTML()}

    ${lifts.length ? `<div class="section"><span class="label">${t('progress.lifts')}</span></div>
    <ul class="lifts">${lifts.map(l => {
      const sp = sparkline(l.series.slice(-10), 84, 34, 5);
      const ch = pct(l.last, l.first);
      return `<li><button class="lift solid" data-ex="${esc(l.id)}">
        <span class="l"><strong>${esc(state.catalog.name(l.id, lang))}</strong><span>${t('progress.best')} ${esc(`${kg(l.best.kg)} ${u()} × ${l.best.reps}`)} · ${t('progress.sessions', { n: l.sessions })}</span></span>
        ${sp ? `<svg class="lspark" viewBox="0 0 84 34" aria-hidden="true"><polyline points="${sp.line}" fill="none" stroke="url(#sp)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        <span class="delta ${ch > 0 ? 'up' : ch < 0 ? 'down' : ''}">${ch > 0 ? '+' : ''}${ch}%</span>
      </button></li>`;
    }).join('')}</ul>` : ''}

    ${prs.length ? `<div class="section"><span class="label">${t('progress.records')}</span></div>
    <ol class="timeline">${prs.map((p, i) => `<li style="--i:${i}"><span class="tdot"></span><div>
      <strong>${esc(state.catalog.name(p.pr.exerciseId, lang))}</strong>
      <span>${esc(prText(p.pr))} · ${esc(day(p.t, lang))}</span></div></li>`).join('')}</ol>` : ''}
`;
}

function prText(p) {
  const { t } = state;
  if (p.kind === 'weight') return `${t('pr.weight')} ${kg(p.kg)} ${u()} × ${p.reps}`;
  if (p.kind === 'e1rm') return `${t('pr.e1rm')} ${kg(p.value)} ${u()}`;
  return `${t('pr.reps', { kg: `${kg(p.kg)} ${u()}` })}: ${p.reps}`;
}

// ---------- one exercise ----------

export function renderExercise(root, id) {
  const { t, lang } = state;
  const e = state.catalog.get(id);
  const name = state.catalog.name(id, lang);
  const lift = liftSummaries(state.history).find(l => l.id === id);
  const b = bestsFrom(state.prs, id);
  const sessions = sessionsFor(state.history, id, 12);
  const sg = e ? suggest(state.history, e, null) : null;
  const sub = e ? `${t('equip.' + e.equipment)}, ${joinList(e.muscles.slice(0, 3).map(m => t('muscle.' + m)), lang)}` : '';
  const change = lift ? Math.round(((lift.last - lift.first) / lift.first) * 100) : 0;
  const lastIsBest = lift && lift.series.length > 1 && lift.series[lift.series.length - 1].v >= lift.best.v;
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${esc(name)}</strong></div><span class="spacer"></span>
    </header>
    <div class="exhero">${figureHTML(e || { id }, { move: true, cls: 'herofig' })}<div><h1 class="h1">${esc(name)}</h1><p class="detail-date">${esc(sub)}</p></div></div>
    ${lift ? `<div class="exhero glass">
      <span class="label">${t('progress.e1rm')}</span>
      <div class="exbig"><b data-count="${Math.round(lift.last * 10) / 10}" data-dp="${lift.last % 1 ? 1 : 0}">0</b><span>${u()}</span>
        ${lift.series.length > 1 ? `<span class="delta ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change > 0 ? '+' : ''}${change}%</span>` : ''}</div>
      ${lineChart(lift.series.map(p => ({ t: p.t, v: p.v })), { h: 150, warmLast: lastIsBest, fmt: v => `${kg(v)}` })}
    </div>
    <div class="summary solid">
      <div><b>${b.e1rm ? esc(`${kg(b.e1rm.kg)}×${b.e1rm.reps}`) : '–'}</b><span>${t('progress.bestSet')}</span></div>
      <div><b>${b.weight ? esc(kg(b.weight.kg)) : '–'}</b><span>${t('pr.weight')}, ${u()}</span></div>
      <div><b>${lift.sessions}</b><span>${t('progress.sessionsLabel')}</span></div>
    </div>` : `<div class="empty solid"><h2>${t('progress.noLift')}</h2></div>`}
    ${e ? `<button class="btn2 solid goalbtn" data-goal="${(state.settings.goals || []).find(g => g.exerciseId === id) ? 'open' : 'new'}" data-ex="${esc(id)}" data-id="${esc((state.settings.goals || []).find(g => g.exerciseId === id)?.id || '')}">${I.flame}<span>${(state.settings.goals || []).some(g => g.exerciseId === id) ? state.t('goal.view') : state.t('goal.set')}</span></button>` : ''}
    ${sg ? `<div class="card solid sugcard"><span class="label">${t('progress.next')}</span><strong>${esc(`${kg(sg.kg)} ${u()} × ${sg.reps}`)}</strong><span>${esc(t('suggest.' + sg.reason, { from: `${kg(sg.from.kg)} ${u()} × ${sg.from.reps}` }))}</span></div>` : ''}
    ${sessions.length ? `<div class="section"><span class="label">${t('progress.historyLabel')}</span></div>
    <ul class="sesslist">${sessions.map(s => `<li class="solid"><span class="d">${esc(day(s.t, lang))}</span><span class="v">${esc(groupSets(s.sets))}</span></li>`).join('')}</ul>` : ''}`;
}

function groupSets(sets) {
  const out = [];
  for (const s of sets) {
    const g = out[out.length - 1];
    if (g && g.kg === s.kg && g.reps === s.reps) g.n++; else out.push({ ...s, n: 1 });
  }
  return out.map(g => `${g.n > 1 ? `${g.n}×` : ''}${kg(g.kg)}×${g.reps}`).join('  ');
}


function sleepHTML() {
  const { t, lang } = state;
  const tr = sleepTrend(state.daily, 14);
  if (!tr || tr.series.length < 2) return '';
  const fmt = h => `${String(h).replace('.', lang === 'da' ? ',' : '.')} ${lang === 'da' ? 't' : 'h'}`;
  return `<div class="chartcard solid">
    <div class="chead"><span class="label">${t('checkin.sleepTitle')}</span><span class="cval"><b>${esc(fmt(tr.avg))}</b> ${esc(t('checkin.sleepAvg', { h: '' }).trim())}</span></div>
    ${barChart(tr.series.map((p, i) => ({ v: p.v, label: p.date, hot: i === tr.series.length - 1 })), { color: 'blue', fmt })}
  </div>`;
}
