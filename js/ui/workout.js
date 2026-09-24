// Workout screen: steppers, log set, previous performance, set list, rest ring, sheets.
import { state, update, undo, finish, discard } from '../store.js';
import * as W from '../workout.js';
import { bestsFrom, livePRSets } from '../pr.js';
import { stepWeight, parseNumber, fromDisplay } from '../units.js';
import { weight, clock, mss, total } from '../format.js';
import { joinList } from '../i18n.js';
import { haptic } from '../haptics.js';
import { esc, $ } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { burst } from './fx.js';
import { openPlates } from './plates.js';
import { warmupRamp } from '../warmup.js';
import { getKey } from '../keys.js';
import { openSheet, closeTop } from './sheet.js';
import { openPicker } from './picker.js';
import { startCardsHTML, workoutTitle } from './today.js';
import { renderLiveCardio } from './cardio.js';
import { suggest, userStep } from '../progression.js';

// the − / + step for the exercise in front of you (Settings → Workout → Weight steps)
const curStep = () => { const w = state.active; const ex = w?.exercises[w.current]; return userStep(ex && state.catalog.get(ex.exerciseId)); };
import { usualMinutes, timeStatus } from '../insights.js';
import { handsFreeOn, hfPillHTML, toggleHandsFree } from './handsfree.js';
import { goalAimHTML } from './goals.js';
import { figureHTML } from './figure.js';

const C = 157.08; // ring circumference, r=25
const REST_LINGER = 4000; // keep the card up after rest ends

const ui = { restVisible: false, buzzed: 0, suppressClick: false, seenWorkout: null, seenDone: new Set(), lastCurrent: -1, tick: null, flash: false };
let nav = { go: () => {}, showDetail: () => {} };
export const setWorkoutNav = n => { nav = n; };

const exName = id => state.catalog.name(id, state.lang);
const unit = () => state.settings.unit;
const u = () => state.t(`unit.${unit()}`);
const isBodyweight = id => state.catalog.get(id)?.equipment === 'bodyweight';
const setText = (kg, reps) => `${weight(kg, unit(), state.lang)} ${u()} × ${reps}`;

function values(w = state.active) {
  const ex = w.exercises[w.current];
  return W.suggestNext(ex, W.lastSession(state.history, ex.exerciseId), isBodyweight(ex.exerciseId) ? 0 : 20);
}

// ---------- render ----------

export function renderWorkout(root) {
  const { t } = state;
  const w = state.active;
  if (!w && state.activeCardio) { ui.restVisible = false; return renderLiveCardio(root); }
  if (!w) {
    ui.restVisible = false;
    root.innerHTML = `<div class="tabtop"></div>
      <div class="hhead"><h1 class="greet tabh">${t('workout.noneTitle')}</h1><button class="iconbtn" data-historyscreen aria-label="${t('history.title')}">${I.history}</button></div><p class="sub">${t('workout.noneSub')}</p>${startCardsHTML()}`;
    return;
  }

  const header = `<header class="top">
      <button class="iconbtn" data-act="go" data-to="today" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${esc(workoutTitle(w))}</strong><span><span data-elapsed>${clock(W.elapsedSec(w))}</span><span class="tgoal${goalOver(w, Date.now()) ? ' over' : ''}" data-tgoal>${goalText(w, Date.now())}</span>${w.deload ? ` · <em class="easy">${t('deload.badge')}</em>` : w.easy ? ` · <em class="easy">${t('ready.easyBadge')}</em>` : ''}</span></div>
      <div class="topacts"><button class="iconbtn hfbtn${handsFreeOn() ? ' is-on' : ''}" data-act="handsfree" aria-pressed="${handsFreeOn()}" aria-label="${t('hf.title')}">${I.headphones}</button>
      <button class="pillbtn" data-act="finish">${t('workout.finish')}</button></div>
    </header>${hfPillHTML()}`;

  if (!w.exercises.length) {
    ui.restVisible = false;
    root.innerHTML = header + `<div class="empty solid">
        <div class="emptyglyph">${I.workout}</div>
        <h2>${t('workout.emptyTitle')}</h2><p>${t('workout.emptySub')}</p>
        <button class="log" data-act="add-exercise">${I.plus}<span>${t('workout.addExercise')}</span></button>
      </div>
      ${quickAddHTML()}
      ${getKey('groq') ? `<p class="sayhint wsay">${I.mic}<span>${esc(t('workout.emptySay'))}</span></p>` : ''}`;
    return;
  }

  const i = w.current;
  const ex = w.exercises[i];
  const info = state.catalog.get(ex.exerciseId);
  const sub = info ? `${t('equip.' + info.equipment)}, ${joinList(info.muscles.slice(0, 2).map(m => t('muscle.' + m)), state.lang)}` : '';
  const v = values(w);
  const last = W.lastSession(state.history, ex.exerciseId);
  const pos = Math.max(0, W.nextSetNumber(ex) - 1);
  const lastSet = last?.sets[Math.min(pos, last.sets.length - 1)];
  const best = bestsFrom(state.prs, ex.exerciseId).e1rm;
  const ghost = lastSet || best
    ? `<span>${t('workout.lastTime')} <b>${lastSet ? esc(setText(lastSet.kg, lastSet.reps)) : '–'}</b></span><span>${t('workout.best')} <b>${best ? esc(setText(best.kg, best.reps)) : '–'}</b></span>`
    : `<span>${t('workout.firstTime')}</span>`;
  const bw = info?.equipment === 'bodyweight';

  root.innerHTML = header + `
    <div class="exhead">
      ${figureHTML(info || { id: ex.exerciseId }, { move: true, cls: 'exfig' })}
      <div class="txt">
        <p>${t('workout.exerciseOf', { i: i + 1, n: w.exercises.length })}</p>
        <h1><button data-act="overview">${esc(exName(ex.exerciseId))}</button></h1>
        <p>${esc(sub)}</p>
      </div>
      <div class="exnav">
        <button class="iconbtn" data-act="prev" aria-label="${t('workout.prev')}" ${i === 0 ? 'disabled' : ''}>${I.back}</button>
        <button class="iconbtn" data-act="next" aria-label="${t('workout.next')}" ${i === w.exercises.length - 1 ? 'disabled' : ''}>${I.fwd}</button>
      </div>
    </div>

    <div class="hero glass">
      <div class="cols">
        <div class="col"><span class="lab">${t(bw ? 'workout.addedWeight' : 'workout.weight', { unit: u() })}</span>
          <div class="row3"><button class="step" data-act="kg-" aria-label="${t('workout.lower')}">−</button><input class="num" id="in-kg" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="${t('workout.weight', { unit: u() })}" value="${esc(weight(v.kg, unit(), state.lang))}"><button class="step" data-act="kg+" aria-label="${t('workout.raise')}">+</button></div></div>
        <span class="times">×</span>
        <div class="col"><span class="lab">${t('workout.reps')}</span>
          <div class="row3"><button class="step" data-act="reps-" aria-label="${t('workout.fewer')}">−</button><input class="num" id="in-reps" inputmode="numeric" enterkeyhint="done" autocomplete="off" aria-label="${t('workout.reps')}" value="${v.reps}"><button class="step" data-act="reps+" aria-label="${t('workout.more')}">+</button></div></div>
      </div>
      <div class="ghost">${ghost}</div>
      ${suggestionHTML(ex)}
      ${goalAimHTML(ex.exerciseId)}
      <div class="tools">
        <button class="tool" data-act="plates">${I.plates}<span>${t('plates.title')}</span></button>
        ${!ex.sets.some(s => s.done) && !ex.sets.some(s => s.type === 'warmup') && v.kg > 20 && info?.equipment !== 'bodyweight' ? `<button class="tool" data-act="warmup">${I.flame}<span>${t('warmup.add')}</span></button>` : ''}
      </div>
      ${logButton(ex)}
    </div>

    <div id="restslot">${restHTML(w, Date.now())}</div>

    <ol class="sets" id="sets">${setsHTML(w, ex)}</ol>
    ${ex.sets.some(s => s.done) ? `<p class="hint">${t('workout.swipeHint')}</p>` : ''}

    <div class="row2">
      <button class="btn2 solid" data-act="overview">${I.list}<span>${t('workout.exercises')}</span></button>
      <button class="btn2 solid" data-act="add-exercise">${I.plus}<span>${t('workout.addExercise')}</span></button>
    </div>`;
  fitNums(root);
  // slide the exercise in when it changed (touch or voice)
  const moved = ui.seenWorkout === w.id && ui.lastCurrent !== -1 && ui.lastCurrent !== i;
  root.classList.remove('slide-l', 'slide-r');
  if (moved) { void root.offsetWidth; root.classList.add(i > ui.lastCurrent ? 'slide-r' : 'slide-l'); }
  if (ui.flash) { ui.flash = false; root.querySelector('.log')?.classList.add('flash'); }
  ui.lastCurrent = i;
  ui.seenWorkout = w.id;
  ui.seenDone = new Set(w.exercises.flatMap(e => e.sets.filter(x => x.done).map(x => x.id)));
}

// ---------- session length ----------

function usualFor(w) {
  if (ui.usual?.id !== w.id) {
    const r = state.routines.find(x => x.id === w.routineId) || null;
    ui.usual = { id: w.id, val: usualMinutes(state.history, w.routineId, r) };
  }
  return ui.usual.val;
}

function goalText(w, now) {
  const st = timeStatus(W.elapsedSec(w, now), usualFor(w));
  if (!st) return '';
  return st.state === 'over' ? ` · ${esc(state.t('workout.over', { over: st.over }))}` : ` / ${esc(state.t('workout.usual', { min: st.usual }))}`;
}

const goalOver = (w, now) => timeStatus(W.elapsedSec(w, now), usualFor(w))?.state === 'over';

// One gentle nudge per workout, 10 minutes past the usual length.
function checkOvertime(w, now) {
  const st = timeStatus(W.elapsedSec(w, now), usualFor(w));
  if (!st || st.state !== 'over' || st.over < 10 || ui.overToast === w.id) return;
  ui.overToast = w.id;
  haptic('tap');
  toast({ title: esc(state.t('toast.overTime', { over: st.over, usual: st.usual })), sub: esc(state.t('toast.overTimeSub')) });
}

// Why the planned weight is what it is: shown until the first set of the exercise is logged.
function suggestionHTML(ex) {
  const { t } = state;
  if (ex.sets.some(s => s.done)) return '';
  if (state.active?.deload) return `<p class="sug easy"><span class="sbadge">−15%</span><span>${esc(t('deload.sub'))}</span></p>`;
  let sg = ex.suggestion;
  if (!sg && state.settings.suggestions) {
    const e = state.catalog.get(ex.exerciseId);
    const s = e && suggest(state.history, e, ex.sets.find(x => !x.done)?.reps ?? null);
    if (s) sg = { reason: s.reason, from: s.from, kg: s.kg };
  }
  if (!sg) return '';
  if (state.active?.easy) return `<p class="sug easy"><span class="sbadge">−10%</span><span>${esc(t('ready.easySub'))}</span></p>`;
  const step = sg.reason === 'up' && sg.kg != null ? sg.kg - sg.from.kg : null;
  const badge = sg.reason === 'up' ? `↑ ${step != null ? weight(step, unit(), state.lang) + ' ' + u() : ''}`.trim()
    : sg.reason === 'deload' ? t('suggest.badge.deload') : sg.reason === 'reps' ? t('suggest.badge.reps') : '=';
  return `<p class="sug ${sg.reason}"><span class="sbadge">${esc(badge)}</span><span>${esc(t('suggest.' + sg.reason, { from: setText(sg.from.kg, sg.from.reps) }))}</span></p>`;
}

function logButton(ex) {
  const { t } = state;
  const label = `<span>${t('workout.logSet', { n: W.nextSetNumber(ex) })}</span>`;
  if (!getKey('groq')) return `<button class="log" data-act="log">${label}</button>`;
  const planned = ex.sets[W.firstPlannedIndex(ex)];
  const hint = t(planned?.kg != null ? 'voice.hint.planned' : ex.sets.some(s => s.done) ? 'voice.hint.same' : 'voice.hint.log');
  return `<button class="log split" data-act="log">${label}<small>${micSvg}${esc(t('workout.orSay', { text: hint.toLowerCase() }))}</small></button>`;
}

const micSvg = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.6 11.5a6.4 6.4 0 0 0 12.8 0M12 18v3"/></svg>';

// Shrink big numbers so "102.5" fits between the steppers.
let measure = null;
function fitNums(root) {
  measure ||= document.createElement('canvas').getContext('2d');
  for (const el of root.querySelectorAll('.num')) {
    const avail = el.clientWidth - 6;
    if (avail <= 0) continue;
    const cs = getComputedStyle(el);
    measure.font = `800 50px ${cs.fontFamily}`;
    const text = el.value || '0';
    const w = measure.measureText(text).width - 2 * text.length; // letter-spacing -.04em
    el.style.fontSize = Math.max(22, Math.min(50, (50 * avail) / Math.max(1, w))) + 'px';
  }
}

function setsHTML(w, ex) {
  const { t } = state;
  const prs = livePRSets(state.prs, w);
  return ex.sets.map((s, k) => {
    const warm = s.type === 'warmup';
    const n = W.setNumberAt(ex, k);
    if (warm) {
      return `<li class="sw" data-set="${s.id}"><span class="del" aria-hidden="true">${I.trash}${t('common.delete')}</span>
        <button class="set warm ${s.done ? 'done' : 'planned'}" data-act="warmup-done" data-id="${s.id}" aria-label="${t('warmup.row')}"><span class="idx">W</span><span class="val"><b>${weight(s.kg, unit(), state.lang)}</b> ${u()} × <b>${s.reps}</b></span>${s.done ? `<span class="ck soft">${I.check}</span>` : `<span class="later">${t('warmup.tap')}</span>`}</button></li>`;
    }
    const val = s.done || s.kg != null
      ? `<b>${weight(s.kg, unit(), state.lang)}</b> ${u()} × <b>${s.reps}</b>`
      : t('workout.repsOnly', { reps: s.reps });
    const end = s.done
      ? `<span class="end">${prs.has(s.id) ? `<span class="tag sm">${t('workout.pr')}</span>` : ''}<span class="ck">${I.check}</span></span>`
      : `<span class="later">${t('workout.planned')}</span>`;
    const cls = s.done ? 'done' : 'planned';
    return `<li class="sw" data-set="${s.id}"><span class="del" aria-hidden="true">${I.trash}${t('common.delete')}</span>
      <button class="set ${cls}${s.done && ui.seenWorkout === w.id && !ui.seenDone.has(s.id) ? ' fresh' : ''}" data-act="${s.done ? 'edit-set' : 'noop'}" data-id="${s.id}" aria-label="${t('workout.editSet', { n })}"><span class="idx">${n}</span><span class="val">${val}</span>${end}</button></li>`;
  }).join('');
}

function restState(w, now) {
  if (!w.rest) return 'none';
  if (now < w.rest.endsAt) return 'running';
  if (now < w.rest.endsAt + REST_LINGER) return 'done';
  return 'none';
}

function restNext(w) {
  const { t } = state;
  const ex = w.exercises[w.current];
  if (!ex) return '';
  if (!ex.sets.some(s => s.done) && Number.isInteger(w.advancedFrom)) return t('workout.nextUp', { name: exName(ex.exerciseId) });
  const nextEx = w.exercises[w.current + 1];
  if (W.firstPlannedIndex(ex) === -1 && ex.sets.length && nextEx) return t('workout.nextUp', { name: exName(nextEx.exerciseId) });
  return t('workout.setNext', { n: W.nextSetNumber(ex) });
}

function restHTML(w, now) {
  const st = restState(w, now);
  ui.restVisible = st !== 'none';
  if (!ui.restVisible) return '';
  const { t } = state;
  const left = W.restRemaining(w.rest, now);
  const off = C * (1 - W.restProgress(w.rest, now));
  const running = st === 'running';
  // the entrance plays once per rest, not on every re-render
  const fresh = ui.restAnimated !== w.rest.startedAt;
  ui.restAnimated = w.rest.startedAt;
  return `<div class="rest solid${fresh ? ' in' : ''}" id="rest">
    <div class="ring${running && left <= 3 ? ' hot' : ''}" id="ring"><svg viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="25"/><circle class="fg" id="fg" cx="30" cy="30" r="25" style="stroke-dashoffset:${off}"/></svg><b id="rtime">${mss(left)}</b></div>
    <div class="rtxt"><strong id="rtitle">${t(running ? 'workout.rest' : 'workout.restDone')}</strong><span>${esc(running ? restNext(w) : t('workout.goTime'))}</span></div>
    <div class="chips" id="rchips"${running ? '' : ' hidden'}><button class="chip" data-act="rest-" aria-label="−15 s">−15</button><button class="chip" data-act="rest+" aria-label="+15 s">+15</button><button class="chip" data-act="rest-skip">${t('workout.skip')}</button></div>
  </div>`;
}

// Called by the app clock. Updates the ring in place; swaps the card when its state changes.
export function tickWorkout(root, now) {
  const w = state.active;
  if (!w) return;
  const tg = root.querySelector('[data-tgoal]');
  if (tg) {
    const txt = goalText(w, now);
    if (tg.innerHTML !== txt) { tg.innerHTML = txt; tg.classList.toggle('over', goalOver(w, now)); }
    checkOvertime(w, now);
  }
  if (!w.exercises.length) return;
  const st = restState(w, now);
  const slot = root.querySelector('#restslot');
  if (!slot) return;
  if (w.rest && st !== 'running' && ui.buzzed !== w.rest.endsAt && now - w.rest.endsAt < 2000) {
    ui.buzzed = w.rest.endsAt;
    haptic('success');
  }
  const card = slot.querySelector('#rest');
  const want = st === 'none' ? null : st;
  const have = card ? (card.querySelector('#rchips').hidden ? 'done' : 'running') : null;
  if (want !== have) {
    if (!want && card) {
      card.classList.add('out');
      setTimeout(() => { if (restState(state.active || {}, Date.now()) === 'none') slot.innerHTML = ''; }, 340);
      ui.restVisible = false;
    } else {
      slot.innerHTML = restHTML(w, now);
    }
    return;
  }
  if (st !== 'running') return;
  const left = W.restRemaining(w.rest, now);
  $('#fg', slot).style.strokeDashoffset = C * (1 - W.restProgress(w.rest, now));
  $('#rtime', slot).textContent = mss(left);
  $('#ring', slot).classList.toggle('hot', left <= 3);
}

// Update only the stepper inputs (draft changes), so focus and animations survive.
export function syncNums(root) {
  const w = state.active;
  if (!w || !w.exercises.length) return;
  const v = values(w);
  const kg = root.querySelector('#in-kg'), reps = root.querySelector('#in-reps');
  if (kg && document.activeElement !== kg) kg.value = weight(v.kg, unit(), state.lang);
  if (reps && document.activeElement !== reps) reps.value = v.reps;
  fitNums(root);
  const tk = ui.tick;
  ui.tick = null;
  const target = tk && (tk.field === 'kg' ? kg : reps);
  if (target) {
    target.classList.remove('tick-up', 'tick-down');
    void target.offsetWidth;
    target.classList.add(tk.dir > 0 ? 'tick-up' : 'tick-down');
  }
}

// ---------- actions ----------

function setDraft(kg, reps) {
  update(w => W.setDraft(w, w.current, { kg, reps }), { reason: 'draft' });
}

function stepKg(dir) {
  const v = values();
  const kg = Math.min(W.LIMITS.kgMax, stepWeight(v.kg, dir, unit(), curStep()));
  haptic('tap');
  if (kg !== v.kg) ui.tick = { field: 'kg', dir };
  setDraft(kg, v.reps);
}

function stepReps(dir) {
  const v = values();
  const reps = Math.max(W.LIMITS.repsMin, Math.min(W.LIMITS.repsMax, v.reps + dir));
  haptic('tap');
  if (reps !== v.reps) ui.tick = { field: 'reps', dir };
  setDraft(v.kg, reps);
}

function readInputs(root) {
  const v = values();
  const kgIn = root.querySelector('#in-kg'), repsIn = root.querySelector('#in-reps');
  const kgShown = parseNumber(kgIn?.value ?? '');
  const reps = parseNumber(repsIn?.value ?? '');
  return {
    kg: kgShown == null ? null : fromDisplay(kgShown, unit()),
    reps: reps == null ? null : reps,
    changed: kgIn && (kgIn.value !== weight(v.kg, unit(), state.lang) || repsIn.value !== String(v.reps))
  };
}

function invalid(which) {
  const { t } = state;
  haptic('error');
  const max = weight(W.LIMITS.kgMax, unit(), state.lang);
  toast({ title: esc(which === 'kg' ? t('invalid.kg', { max, unit: u() }) : t('invalid.reps')), error: true, ms: 3000 });
}

// Commit what's typed in an input on blur/enter.
function commitInput(root, el) {
  const r = readInputs(root);
  const v = values();
  if (el.id === 'in-kg') {
    if (r.kg == null || r.kg > W.LIMITS.kgMax) { invalid('kg'); el.value = weight(v.kg, unit(), state.lang); return; }
    setDraft(r.kg, v.reps);
  } else {
    if (!Number.isInteger(r.reps) || r.reps < 1 || r.reps > W.LIMITS.repsMax) { invalid('reps'); el.value = v.reps; return; }
    setDraft(v.kg, r.reps);
  }
}

function confirmHeavy(kg, reps, confirm, then) {
  const { t } = state;
  const lines = [];
  if (confirm.includes('kg')) lines.push(t('confirm.heavyKg', { kg: setText(kg, reps).split(' × ')[0] }));
  if (confirm.includes('reps')) lines.push(t('confirm.heavyReps', { reps }));
  openSheet((el, api) => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('confirm.heavyTitle')}</h2>${lines.map(l => `<p class="lead">${esc(l)}</p>`).join('')}
      <div class="acts"><button class="log" data-k="ok">${t('confirm.log')}</button><button class="btn2 solid" data-k="no">${t('common.cancel')}</button></div>`);
    el.querySelector('[data-k=ok]').onclick = () => { closeTop(); then(); };
    el.querySelector('[data-k=no]').onclick = () => closeTop();
  });
}

function logCurrent(root) {
  const w = state.active;
  if (!w?.exercises.length) return;
  const typed = readInputs(root);
  const v = values();
  const kg = typed.kg ?? v.kg;
  const reps = typed.reps ?? v.reps;
  const check = W.validateSet(kg, reps);
  if (!check.ok) return invalid(check.error);
  const go = () => doLog(kg, reps);
  if (check.confirm.length) confirmHeavy(kg, reps, check.confirm, go);
  else go();
}

function doLog(kg, reps) {
  const { t } = state;
  const w = state.active;
  const idx = w.current;
  const ex = w.exercises[idx];
  const n = W.nextSetNumber(ex);
  let set;
  try {
    update(cur => { const r = W.logSet(cur, idx, { kg, reps }, Date.now(), W.restFor(cur.exercises[idx], state.settings.restByEx, state.settings.restSec)); set = r.set; return state.settings.autoAdvance ? W.advanceAfterLog(cur, r.workout, idx) : r.workout; }, { undo: 'log', reason: 'log' });
  } catch (e) {
    haptic('error');
    return toast({ title: esc(t('toast.limit')), error: true });
  }
  ui.buzzed = 0;
  ui.flash = true;
  haptic('success');
  const pr = livePRSets(state.prs, state.active).has(set.id);
  // the new row lands, then sparks fly from its check (warm for a record)
  requestAnimationFrame(() => {
    const ck = document.querySelector(`#sets [data-id="${set.id}"] .ck`);
    burst(ck, { warm: pr, count: pr ? 18 : 10, spread: pr ? 74 : 48 });
    if (pr) document.querySelector(`#sets [data-id="${set.id}"]`)?.classList.add('prflash');
  });
  toast({
    title: `${pr ? `<span class="tag sm">${t('workout.pr')}</span> ` : ''}${esc(exName(ex.exerciseId))} <span class="v">${esc(setText(kg, reps))}</span>`,
    sub: state.active.current !== idx ? `${t('toast.logged', { n })} · ${t('workout.nextUp', { name: exName(state.active.exercises[state.active.current].exerciseId) })}` : t('toast.logged', { n }),
    action: t('common.undo'),
    onAction: () => { undo(); haptic('tap'); }
  });
  rerender();
}

function rerender() {
  const root = $('#s-workout');
  if (root) renderWorkout(root);
}

function editSetSheet(setId) {
  const { t } = state;
  const w = state.active;
  const idx = w.current;
  const ex = w.exercises[idx];
  const k = ex.sets.findIndex(s => s.id === setId);
  if (k === -1) return;
  let { kg, reps } = ex.sets[k];
  openSheet((el) => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('workout.editSet', { n: k + 1 })}</h2><p class="lead">${esc(exName(ex.exerciseId))}</p>
      <div class="editnums solid"><div class="cols">
        <div class="col"><span class="lab">${t('workout.weight', { unit: u() })}</span><div class="row3"><button class="step" data-k="kg-" aria-label="${t('workout.lower')}">−</button><input class="num" data-k="kg" inputmode="decimal" enterkeyhint="done" aria-label="${t('workout.weight', { unit: u() })}"><button class="step" data-k="kg+" aria-label="${t('workout.raise')}">+</button></div></div>
        <span class="times">×</span>
        <div class="col"><span class="lab">${t('workout.reps')}</span><div class="row3"><button class="step" data-k="reps-" aria-label="${t('workout.fewer')}">−</button><input class="num" data-k="reps" inputmode="numeric" enterkeyhint="done" aria-label="${t('workout.reps')}"><button class="step" data-k="reps+" aria-label="${t('workout.more')}">+</button></div></div>
      </div></div>
      <div class="acts"><button class="log" data-k="save">${t('common.save')}</button><button class="btn2 solid danger" data-k="del">${I.trash}<span>${t('workout.deleteSet')}</span></button></div>`);
    const kgIn = el.querySelector('[data-k=kg]'), repsIn = el.querySelector('[data-k=reps]');
    const paint = () => { kgIn.value = weight(kg, unit(), state.lang); repsIn.value = reps; fitNums(el); };
    paint();
    const readKg = () => { const n = parseNumber(kgIn.value); if (n != null) kg = fromDisplay(n, unit()); };
    const readReps = () => { const n = parseNumber(repsIn.value); if (n != null) reps = n; };
    kgIn.onchange = () => { readKg(); paint(); };
    repsIn.onchange = () => { readReps(); paint(); };
    el.querySelector('[data-k="kg-"]').onclick = () => { readKg(); kg = stepWeight(kg, -1, unit(), curStep()); haptic('tap'); paint(); };
    el.querySelector('[data-k="kg+"]').onclick = () => { readKg(); kg = Math.min(W.LIMITS.kgMax, stepWeight(kg, 1, unit(), curStep())); haptic('tap'); paint(); };
    el.querySelector('[data-k="reps-"]').onclick = () => { readReps(); reps = Math.max(1, reps - 1); haptic('tap'); paint(); };
    el.querySelector('[data-k="reps+"]').onclick = () => { readReps(); reps = Math.min(W.LIMITS.repsMax, reps + 1); haptic('tap'); paint(); };
    el.querySelector('[data-k=save]').onclick = () => {
      readKg(); readReps();
      const check = W.validateSet(kg, reps);
      if (!check.ok) return invalid(check.error);
      const save = () => {
        update(cur => W.editSet(cur, idx, setId, { kg, reps }), { undo: 'edit' });
        haptic('success');
        toast({ title: `${esc(exName(ex.exerciseId))} <span class="v">${esc(setText(kg, reps))}</span>`, sub: t('toast.edited', { n: k + 1 }), action: t('common.undo'), onAction: () => undo() });
      };
      closeTop().then(() => (check.confirm.length ? confirmHeavy(kg, reps, check.confirm, save) : save()));
    };
    el.querySelector('[data-k=del]').onclick = () => { closeTop(); removeSet(setId); };
  }, { label: t('workout.editSet', { n: k + 1 }) });
}

function removeSet(setId) {
  const { t } = state;
  update(w => W.deleteSet(w, w.current, setId), { undo: 'delete' });
  haptic('tap');
  toast({ title: esc(t('toast.deleted')), action: t('common.undo'), onAction: () => undo() });
}

function overviewSheet() {
  const { t } = state;
  openSheet((el, api) => {
    const paint = () => {
      const w = state.active;
      if (!w) return closeTop();
      el.querySelector('.sbody')?.remove();
      el.insertAdjacentHTML('beforeend', `<div class="sbody"><div class="shead"><h2>${t('workout.exercises')}</h2></div>
        <ul class="plist">${w.exercises.map((ex, k) => {
          const done = ex.sets.filter(s => s.done).length;
          return `<li><div class="prow${k === w.current ? ' cur' : ''}">
            <span class="n">${k + 1}</span>
            <button class="l" data-k="pick" data-i="${k}" style="text-align:left"><strong>${esc(exName(ex.exerciseId))}</strong><small>${t('workout.setsDone', { done, total: Math.max(done, ex.sets.length) })}</small></button>
            <button class="plus" data-k="rm" data-i="${k}" aria-label="${t('workout.remove')}">${I.close}</button>
          </div></li>`;
        }).join('')}</ul>
        <div class="acts"><button class="btn2 solid" data-k="add">${I.plus}<span>${t('workout.addExercise')}</span></button></div></div>`);
    };
    paint();
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const k = Number(b.dataset.i);
      if (b.dataset.k === 'pick') {
        update(w => W.setCurrent(w, k), { reason: 'nav' });
        haptic('tap');
        closeTop();
      } else if (b.dataset.k === 'add') {
        closeTop().then(addExerciseFlow);
      } else if (b.dataset.k === 'rm') {
        const ex = state.active.exercises[k];
        const n = ex.sets.filter(s => s.done).length;
        const doRemove = () => {
          const name = exName(ex.exerciseId);
          update(w => W.removeExercise(w, k), { undo: 'remove' });
          toast({ title: esc(t('toast.removed', { name })), action: t('common.undo'), onAction: () => undo() });
        };
        if (!n) { doRemove(); paint(); return; }
        api.replace(inner => {
          inner.insertAdjacentHTML('beforeend', `<h2>${esc(t('workout.removeTitle', { name: exName(ex.exerciseId) }))}</h2><p class="lead">${t('workout.removeBody', { n })}</p>
            <div class="acts"><button class="btn2 solid danger" data-c="ok">${I.trash}<span>${t('workout.remove')}</span></button><button class="btn2 solid" data-c="no">${t('common.cancel')}</button></div>`);
          inner.querySelector('[data-c=ok]').onclick = () => { closeTop(); doRemove(); };
          inner.querySelector('[data-c=no]').onclick = () => closeTop();
        });
      }
    });
  }, { label: t('workout.exercises') });
}

// Your most-trained lifts as one-tap starts for an empty workout.
function quickAddHTML() {
  const { t, lang } = state;
  const ids = Object.keys(state.usage || {}).sort((a, b) => state.usage[b] - state.usage[a]).filter(id => state.catalog.get(id)).slice(0, 8);
  if (!ids.length) return '';
  return `<div class="section"><span class="label">${t('workout.yourLifts')}</span></div>
    <div class="qlifts">${ids.map((id, i) => `<button class="qlift solid" data-act="quick-exercise" data-id="${esc(id)}" style="--i:${i}">${figureHTML(state.catalog.get(id), { cls: 'qfig' })}<span>${esc(state.catalog.name(id, lang))}</span></button>`).join('')}</div>`;
}

function addExerciseFlow() {
  openPicker({
    onPick: id => {
      const { t } = state;
      try {
        update(w => W.addExercise(w, id), { undo: 'add', reason: 'add' });
        haptic('success');
        toast({ title: esc(t('toast.added', { name: exName(id) })), action: t('common.undo'), onAction: () => undo() });
      } catch {
        toast({ title: esc(t('toast.limit')), error: true });
      }
    }
  });
}

function finishSheet() {
  const { t } = state;
  const w = state.active;
  if (!w) return;
  const sets = W.doneSetCount(w);
  const planned = w.exercises.reduce((n, ex) => n + ex.sets.filter(s => !s.done).length, 0);
  const discardSheet = api => api.replace(el => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('discard.title')}</h2><p class="lead">${t('discard.body')}</p>
      <div class="acts"><button class="btn2 solid danger" data-k="yes">${I.trash}<span>${t('discard.confirm')}</span></button><button class="btn2 solid" data-k="no">${t('finish.keepGoing')}</button></div>`);
    el.querySelector('[data-k=yes]').onclick = async () => {
      await closeTop();
      await discard();
      haptic('tap');
      toast({ title: esc(t('toast.discarded')) });
      nav.go('today');
    };
    el.querySelector('[data-k=no]').onclick = () => closeTop();
  });

  openSheet((el, api) => {
    if (!sets) {
      el.insertAdjacentHTML('beforeend', `<h2>${t('finish.title')}</h2><p class="lead">${t('finish.nothing')}</p>
        <div class="acts"><button class="btn2 solid danger" data-k="discard">${I.trash}<span>${t('finish.discard')}</span></button><button class="btn2 solid" data-k="keep">${t('finish.keepGoing')}</button></div>`);
    } else {
      el.insertAdjacentHTML('beforeend', `<h2>${t('finish.title')}</h2>
        <p class="lead">${esc(t('finish.summary', { time: clock(W.elapsedSec(w)), sets, volume: total(W.volume(w), unit(), state.lang), unit: u() }))}</p>
        ${planned ? `<p class="lead">${t('finish.plannedLeft', { n: planned })}</p>` : ''}
        <div class="acts"><button class="log" data-k="finish">${I.check}<span>${t('finish.confirm')}</span></button><button class="btn2 solid" data-k="keep">${t('finish.keepGoing')}</button>
        <button class="linkbtn" data-k="discard">${t('finish.discard')}</button></div>`);
    }
    el.addEventListener('click', async e => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === 'keep') closeTop();
      else if (k === 'discard') discardSheet(api);
      else if (k === 'finish') {
        e.target.closest('button').disabled = true;
        await closeTop();
        try {
          const done = await finish();
          haptic('success');
          toast({ title: esc(t('toast.saved')), sub: done?.prs?.length ? t('history.prs', { n: done.prs.length }) : '' });
          if (done) nav.showDetail(done.id, { fromFinish: true });
          else nav.go('today');
        } catch (err) {
          console.error('finish failed', err?.name);
          toast({ title: esc(t('toast.storageError')), error: true });
        }
      }
    });
  }, { label: t('finish.title') });
}

// ---------- wiring ----------

export function initWorkout(root, actions) {
  Object.assign(actions, {
    handsfree: () => toggleHandsFree(),
    'kg-': () => stepKg(-1),
    'kg+': () => stepKg(1),
    'reps-': () => stepReps(-1),
    'reps+': () => stepReps(1),
    log: () => logCurrent(root),
    prev: () => { update(w => W.setCurrent(w, w.current - 1), { reason: 'nav' }); haptic('tap'); },
    next: () => { update(w => W.setCurrent(w, w.current + 1), { reason: 'nav' }); haptic('tap'); },
    'rest-': () => { update(w => W.adjustRest(w, -15)); haptic('tap'); },
    'rest+': () => { update(w => W.adjustRest(w, 15)); haptic('tap'); },
    'rest-skip': () => { update(w => W.skipRest(w)); haptic('tap'); },
    'edit-set': el => { if (ui.suppressClick) return; editSetSheet(el.dataset.id); },
    noop: () => {},
    plates: () => { const w = state.active; if (w) openPlates(readInputs(root).kg ?? values(w).kg); },
    warmup: () => {
      const w = state.active;
      const kg = values(w).kg;
      update(cur => W.addWarmups(cur, cur.current, warmupRamp(kg)), { undo: 'warmup' });
      haptic('success');
      toast({ title: esc(state.t('warmup.added')), action: state.t('common.undo'), onAction: () => undo() });
    },
    'warmup-done': el => {
      if (ui.suppressClick) return;
      update(w => W.completeWarmup(w, w.current, el.dataset.id), { reason: 'warmup' });
      haptic('tap');
    },
    overview: () => overviewSheet(),
    'add-exercise': () => addExerciseFlow(),
    'quick-exercise': el => {
      try { update(w => W.addExercise(w, el.dataset.id), { undo: 'add', reason: 'add' }); haptic('success'); }
      catch { toast({ title: esc(state.t('toast.limit')), error: true }); }
    },
    finish: () => finishSheet()
  });

  // typed numbers
  root.addEventListener('focusin', e => { if (e.target.classList?.contains('num')) setTimeout(() => e.target.select(), 0); });
  root.addEventListener('change', e => { if (e.target.id === 'in-kg' || e.target.id === 'in-reps') commitInput(root, e.target); });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList?.contains('num')) e.target.blur(); });
  root.addEventListener('input', e => { if (e.target.classList?.contains('num')) fitNums(root); });

  // swipe left to delete a set
  let drag = null;
  root.addEventListener('pointerdown', e => {
    const row = e.target.closest('.sw');
    if (!row || e.button > 0) return;
    drag = { row, btn: row.querySelector('.set'), x: e.clientX, y: e.clientY, dx: 0, on: false, id: e.pointerId };
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.3) { drag.on = true; drag.row.classList.add('dragging'); }
      else return;
    }
    drag.dx = Math.min(0, dx);
    drag.btn.style.transform = `translateX(${drag.dx}px)`;
  });
  const end = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    if (!d.on) return;
    ui.suppressClick = true;
    setTimeout(() => { ui.suppressClick = false; }, 50);
    const limit = Math.min(110, d.row.offsetWidth * 0.3);
    if (e.type !== 'pointercancel' && d.dx < -limit) {
      d.btn.style.transform = `translateX(-${d.row.offsetWidth}px)`;
      d.row.classList.add('gone');
      haptic('tap');
      setTimeout(() => removeSet(d.row.dataset.set), 220);
    } else {
      d.row.classList.remove('dragging');
      d.btn.style.transform = '';
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

