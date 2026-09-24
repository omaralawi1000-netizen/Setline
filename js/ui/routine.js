// Routine editor, starter programs, and the readiness check before a workout.
import * as store from '../store.js';
import { state } from '../store.js';
import * as R from '../routines.js';
import { planFromHistory } from '../workout.js';
import { suggest } from '../progression.js';
import { readiness, routineGroups } from '../checkin.js';
import { dateKey } from '../body.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';
import { openPicker } from './picker.js';

let nav = { go: () => {}, openRoutine: () => {}, back: () => {} };
export const setRoutineNav = n => { nav = n; };
const ui = { draft: null, isNew: false };

// ---------- starting a routine ----------

export function planFor(r) {
  const s = state.settings;
  const fn = s.suggestions ? (id, reps) => { const e = state.catalog.get(id); return e ? suggest(state.history, e, reps) : null; } : null;
  return planFromHistory(r, state.history, fn);
}

export function startRoutine(id) {
  const r = state.routines.find(x => x.id === id);
  if (!r) return;
  if (state.active || state.activeCardio) return nav.go('workout');
  if (!state.settings.readiness) { store.startWorkout(planFor(r)); haptic('success'); return nav.go('workout'); }
  // answered this morning: no need to ask again unless it says take it easy
  const c = state.daily.find(d => d.date === dateKey());
  const rd = c ? readiness(c, routineGroups(r, state.catalog)) : null;
  const note = rd?.soreHit.length ? state.t('checkin.soreHit', { what: rd.soreHit.map(g => state.t('group.' + g)).join(', ') }) : '';
  if (rd && rd.score >= 3) {
    store.startWorkout(planFor(r), { readiness: rd.score });
    haptic('success');
    nav.go('workout');
    if (note) toast({ title: esc(note) });
    return;
  }
  readinessSheet(r, rd ? { level: rd.score, easy: true, note } : {});
}

function readinessSheet(r, preset = {}) {
  const { t, lang } = state;
  let level = preset.level ?? null, easy = !!preset.easy;
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<h2>${t('ready.title')}</h2><p class="lead">${esc(R.routineName(r, lang))} · ${t('ready.sub')}</p>
      <div class="rgrid" role="group">${[1, 2, 3, 4, 5].map(n => `<button class="rdy r${n}" data-l="${n}" aria-pressed="false"><b>${n}</b><span>${t('ready.' + n)}</span></button>`).join('')}</div>
      <div class="srow easyrow" hidden><span class="l"><strong>${t('ready.easy')}</strong><small>${t('ready.easySub')}</small></span><button class="toggle" role="switch" aria-checked="false" data-k="easy" aria-label="${t('ready.easy')}"></button></div>
      <div class="acts"><button class="log" data-k="go">${I.play}<span>${t('ready.start')}</span></button><button class="linkbtn muted" data-k="skip">${t('ready.skip')}</button></div>`);
    const row = el.querySelector('.easyrow'), tog = el.querySelector('[data-k=easy]');
    if (level != null) {
      for (const b of el.querySelectorAll('[data-l]')) b.setAttribute('aria-pressed', String(Number(b.dataset.l) === level));
      row.hidden = false;
      tog.setAttribute('aria-checked', String(easy));
      if (preset.note) el.querySelector('.lead').insertAdjacentHTML('afterend', `<p class="ckwarn">${esc(preset.note)}</p>`);
    }
    const go = async () => {
      await closeTop();
      store.startWorkout(planFor(r), { readiness: level, easy });
      haptic('success');
      nav.go('workout');
    };
    el.addEventListener('click', e => {
      const l = e.target.closest('[data-l]');
      if (l) {
        level = Number(l.dataset.l);
        for (const b of el.querySelectorAll('[data-l]')) b.setAttribute('aria-pressed', String(b === l));
        easy = level <= 2;
        row.hidden = false;
        tog.setAttribute('aria-checked', String(easy));
        haptic('tap');
        return;
      }
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === 'easy') { easy = !easy; tog.setAttribute('aria-checked', String(easy)); haptic('tap'); }
      else if (k === 'go') go();
      else if (k === 'skip') { level = null; easy = false; go(); }
    });
  }, { label: t('ready.title') });
}

// ---------- programs ----------

export function programsSheet() {
  const { t, lang } = state;
  openSheet(el => {
    el.insertAdjacentHTML('beforeend', `<div class="shead"><h2>${t('routine.program')}</h2></div>
      <ul class="plist">${R.PROGRAMS.map(p => `<li><button class="prow" data-p="${p.id}"><span class="l"><strong>${esc(lang === 'da' ? p.da : p.en)}</strong>
        <small>${t('routine.programSub', { n: p.routines.length, w: p.perWeek })} · ${esc(p.routines.map(r => lang === 'da' ? r.da : r.en).join(', '))}</small></span><span class="plus">${I.plus}</span></button></li>`).join('')}</ul>`);
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const p = R.PROGRAMS.find(x => x.id === b.dataset.p);
      b.disabled = true;
      await closeTop();
      await store.saveRoutines(R.programRoutines(p.id, lang));
      if (state.settings.weeklyGoal < p.perWeek) store.setSettings({ weeklyGoal: p.perWeek });
      haptic('success');
      toast({ title: esc(t('routine.programAdded', { name: lang === 'da' ? p.da : p.en })) });
    });
  }, { label: t('routine.program') });
}

// ---------- editor ----------

export function editRoutine(id) {
  const r = id && state.routines.find(x => x.id === id);
  ui.isNew = !r;
  ui.draft = r ? structuredClone(r) : R.newRoutine('');
  nav.openRoutine();
}

export function renderRoutine(root) {
  const { t, lang } = state;
  const d = ui.draft;
  if (!d) { root.innerHTML = ''; return; }
  root.innerHTML = `<header class="top">
      <button class="iconbtn" data-act="back" aria-label="${t('common.back')}">${I.back}</button>
      <div class="ttl"><strong>${t(ui.isNew ? 'routine.new' : 'routine.edit')}</strong></div>
      <button class="pillbtn" data-r="save">${t('routine.save')}</button>
    </header>
    <input class="rname" id="rname" value="${esc(R.routineName(d, lang))}" placeholder="${esc(t('routine.namePh'))}" maxlength="${R.LIMITS.name}" autocomplete="off" aria-label="${t('routine.name')}">
    <p class="sub">${t('routine.exercises', { n: d.exercises.length })} · ${t('min', { n: R.estimateMinutes(d) })}</p>
    <ol class="redit" id="redit">${d.exercises.map((e, i) => `<li class="reitem solid" data-i="${i}">
        <span class="grip" data-grip aria-label="${t('routine.drag')}"><svg class="i" viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></span>
        <div class="rei"><strong>${esc(state.catalog.name(e.exerciseId, lang))}</strong>
          <div class="rsr">
            <span class="ms"><button data-r="sets" data-d="-1" data-i="${i}" aria-label="−">−</button><b>${e.sets.length}</b><small>${t('routine.sets')}</small><button data-r="sets" data-d="1" data-i="${i}" aria-label="+">+</button></span>
            <span class="ms"><button data-r="reps" data-d="-1" data-i="${i}" aria-label="−">−</button><b>${e.sets[0]?.reps ?? 8}</b><small>${t('routine.reps')}</small><button data-r="reps" data-d="1" data-i="${i}" aria-label="+">+</button></span>
          </div></div>
        <button class="iconbtn x" data-r="remove" data-i="${i}" aria-label="${t('workout.remove')}">${I.close}</button>
      </li>`).join('')}</ol>
    <div class="row2" style="grid-template-columns:1fr"><button class="btn2 solid" data-r="add">${I.plus}<span>${t('routine.add')}</span></button></div>
    <p class="err" id="rerr"></p>
    ${ui.isNew ? '' : `<div class="row2"><button class="btn2 solid" data-r="start">${I.play}<span>${t('routine.start')}</span></button><button class="btn2 solid" data-r="dup">${t('routine.duplicate')}</button></div>
      <button class="linkbtn wide" data-r="delete">${t('routine.delete')}</button>`}`;
}

function readName(root) {
  const v = root.querySelector('#rname')?.value ?? '';
  if (v.trim() !== R.routineName(ui.draft, state.lang)) ui.draft = R.renameRoutine(ui.draft, v);
}

async function save(root, { quiet = false } = {}) {
  const { t } = state;
  readName(root);
  const err = root.querySelector('#rerr');
  if (!ui.draft.name.trim() && !ui.draft.names) { err.textContent = t('routine.emptyName'); haptic('error'); return false; }
  if (!ui.draft.exercises.length) { err.textContent = t('routine.emptyEx'); haptic('error'); return false; }
  await store.saveRoutine(ui.draft);
  ui.isNew = false;
  if (!quiet) { haptic('success'); toast({ title: esc(t('routine.saved')) }); }
  return true;
}

export function initRoutine(root) {
  root.addEventListener('input', e => { if (e.target.id === 'rname') root.querySelector('#rerr').textContent = ''; });
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-r]');
    if (!b || !ui.draft) return;
    const k = b.dataset.r, i = Number(b.dataset.i);
    const { t, lang } = state;
    readName(root);
    if (k === 'sets' || k === 'reps') {
      const ex = ui.draft.exercises[i];
      const n = ex.sets.length + (k === 'sets' ? Number(b.dataset.d) : 0);
      const reps = (ex.sets[0]?.reps ?? 8) + (k === 'reps' ? Number(b.dataset.d) : 0);
      ui.draft = R.setRoutineSets(ui.draft, i, n, reps);
      haptic('tap');
      const li = root.querySelector(`.reitem[data-i="${i}"]`);
      const e2 = ui.draft.exercises[i];
      const [sb, rb] = li.querySelectorAll('.ms b');
      sb.textContent = e2.sets.length; rb.textContent = e2.sets[0].reps;
      (k === 'sets' ? sb : rb).animate([{ transform: `translateY(${Number(b.dataset.d) > 0 ? 6 : -6}px)`, opacity: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
      root.querySelector('.sub').textContent = `${t('routine.exercises', { n: ui.draft.exercises.length })} · ${t('min', { n: R.estimateMinutes(ui.draft) })}`;
    } else if (k === 'remove') {
      const li = root.querySelector(`.reitem[data-i="${i}"]`);
      li.classList.add('gone');
      haptic('tap');
      setTimeout(() => { ui.draft = R.removeRoutineExercise(ui.draft, i); renderRoutine(root); }, 220);
    } else if (k === 'add') {
      openPicker({ onPick: id => { ui.draft = R.addRoutineExercise(ui.draft, id, 3, 10); renderRoutine(root); haptic('success'); requestAnimationFrame(() => root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' })); } });
    } else if (k === 'save') {
      if (await save(root)) nav.back();
    } else if (k === 'start') {
      if (await save(root, { quiet: true })) { const id = ui.draft.id; nav.back(); setTimeout(() => startRoutine(id), 350); }
    } else if (k === 'dup') {
      if (!(await save(root, { quiet: true }))) return;
      const copy = R.duplicateRoutine(ui.draft, lang);
      await store.saveRoutine(copy);
      ui.draft = structuredClone(copy);
      renderRoutine(root);
      haptic('success');
      toast({ title: esc(t('routine.saved')), sub: R.routineName(copy, lang) });
    } else if (k === 'delete') {
      openSheet(el => {
        el.insertAdjacentHTML('beforeend', `<h2>${esc(t('routine.deleteTitle', { name: R.routineName(ui.draft, lang) }))}</h2><p class="lead">${t('routine.deleteBody')}</p>
          <div class="acts"><button class="btn2 solid danger" data-d="yes">${I.trash}<span>${t('routine.delete')}</span></button><button class="btn2 solid" data-d="no">${t('common.cancel')}</button></div>`);
        el.querySelector('[data-d=no]').onclick = () => closeTop();
        el.querySelector('[data-d=yes]').onclick = async () => {
          await closeTop();
          await store.deleteRoutine(ui.draft.id);
          toast({ title: esc(t('routine.deleted')) });
          nav.back();
        };
      });
    }
  });

  // drag to reorder by the grip
  let drag = null;
  root.addEventListener('pointerdown', e => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    e.preventDefault();
    const li = grip.closest('.reitem');
    const items = [...root.querySelectorAll('.reitem')];
    const rects = items.map(x => x.getBoundingClientRect());
    drag = { li, items, rects, from: Number(li.dataset.i), to: Number(li.dataset.i), y: e.clientY, id: e.pointerId };
    grip.setPointerCapture(e.pointerId);
    li.classList.add('lifted');
    haptic('tap');
  });
  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    drag.li.style.transform = `translateY(${dy}px) scale(1.02)`;
    const r = drag.rects[drag.from];
    const center = r.top + r.height / 2 + dy;
    let to = drag.from;
    drag.rects.forEach((q, k) => { if (k < drag.from && center < q.top + q.height / 2) to = Math.min(to, k); if (k > drag.from && center > q.top + q.height / 2) to = Math.max(to, k); });
    if (to !== drag.to) {
      drag.to = to;
      const h = r.height + 8;
      drag.items.forEach((x, k) => {
        if (x === drag.li) return;
        const shift = drag.from < to && k > drag.from && k <= to ? -h : drag.from > to && k < drag.from && k >= to ? h : 0;
        x.style.transform = shift ? `translateY(${shift}px)` : '';
      });
      haptic('tap');
    }
  });
  const end = e => {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    readName(root);
    if (d.to !== d.from) ui.draft = R.moveRoutineExercise(ui.draft, d.from, d.to);
    renderRoutine(root);
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
}

export const hasDraft = () => !!ui.draft;
