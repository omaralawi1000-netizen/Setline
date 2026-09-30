// Onboarding: a few quick questions, one per screen, so the Coach knows who it's coaching.
// Shown once on first open (skippable), editable from Settings.
import * as store from '../store.js';
import { state } from '../store.js';
import { sanitizeProfile, derivedSettings, programFor, planRequest, LEVELS, GOALS, EQUIPMENT, INJURIES, MINUTES, CARDIO } from '../profile.js';
import { PROGRAMS, programRoutines } from '../routines.js';
import { bodyTrend, validBodyweight } from '../body.js';
import { toDisplay, fromDisplay } from '../units.js';
import { weight as fmtW } from '../format.js';
import { getKey } from '../keys.js';
import { mountInterview } from './interview.js';
import { validatePlan, planToRoutines } from '../coach.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';

let nav = { go: () => {}, ask: () => {} };
export const setOnboardNav = n => { nav = n; };

const year = () => new Date().getFullYear();

function steps(edit) {
  const list = [
    !edit && { id: 'welcome', kind: 'welcome' },
    getKey('google') && { id: 'chat', kind: 'chat' },
    { id: 'name', kind: 'text' },
    { id: 'age', kind: 'number', min: 13, max: 90, step: 1 },
    { id: 'sex', kind: 'choice', options: ['male', 'female', 'other'] },
    { id: 'height', kind: 'number', min: 140, max: 220, step: 1 },
    { id: 'weight', kind: 'number', min: 35, max: 200, step: 0.5 },
    { id: 'level', kind: 'choice', options: LEVELS, sub: true },
    { id: 'goal', kind: 'choice', options: GOALS, sub: true },
    { id: 'days', kind: 'choice', options: [2, 3, 4, 5, 6], row: true },
    { id: 'minutes', kind: 'choice', options: MINUTES, row: true },
    { id: 'equipment', kind: 'choice', options: EQUIPMENT },
    { id: 'injuries', kind: 'multi', options: INJURIES },
    { id: 'cardio', kind: 'choice', options: CARDIO, sub: true },
    { id: 'plan', kind: 'plan' },
    { id: 'done', kind: 'done' }
  ];
  return list.filter(Boolean);
}

export function openOnboarding({ edit = false } = {}) {
  const { t } = state;
  const p = state.settings.profile || {};
  const bw = bodyTrend(state.bodyweight)?.latest.kg ?? null;
  const a = {
    name: p.name || '', age: p.birthYear ? year() - p.birthYear : 25, sex: p.sex || null, height: p.heightCm || 178,
    weight: bw ?? 80, weightTouched: false, level: p.level || null, goal: p.goal || null, days: p.days || null, minutes: p.minutes || null,
    equipment: p.equipment || null, injuries: [...(p.injuries || [])], cardio: p.cardio || null, plan: null, notes: p.notes || '', asked: {}
  };
  let list = steps(edit);
  let chat = null; // the getting-to-know-you conversation, kept across back/next
  const chatEl = document.createElement('div');
  chatEl.className = 'ivmount';
  let i = 0, saved = false;

  const profile = () => sanitizeProfile({ name: a.name, birthYear: year() - a.age, sex: a.sex, heightCm: a.height, level: a.level, goal: a.goal, days: a.days, minutes: a.minutes, equipment: a.equipment, injuries: a.injuries, cardio: a.cardio, notes: a.notes });
  const save = async () => {
    if (saved) return;
    saved = true;
    const pr = profile();
    store.setSettings({ profile: pr, profileAsked: Date.now(), ...derivedSettings(pr) });
    if (a.weightTouched && validBodyweight(a.weight)) await store.logBodyweight(a.weight);
  };

  const api = openSheet(box => {
    const render = (dir = 1) => {
      const st = list[i];
      const progress = (i + 1) / list.length;
      box.innerHTML = `<div class="ob">
        <div class="obtop">
          <button class="iconbtn" data-ob="back" aria-label="${esc(t('common.back'))}" ${i === 0 ? 'hidden' : ''}>${I.back}</button>
          <div class="obbar"><i style="transform:scaleX(${progress.toFixed(3)})"></i></div>
          ${st.kind === 'done' ? '<span class="obsp"></span>' : `<button class="textbtn" data-ob="skip">${t(st.kind === 'welcome' ? 'ob.later' : 'ob.skip')}</button>`}
        </div>
        <div class="obstep ${dir > 0 ? 'in-r' : dir < 0 ? 'in-l' : ''}">${stepHTML(st)}</div>
      </div>`;
      box.querySelector('.obstep input[type=text]')?.focus({ preventScroll: true });
      if (st.kind === 'chat') placeChat();
    };

    function stepHTML(st) {
      const q = `<h1>${esc(t(`ob.${st.id}.q`, { name: a.name }))}</h1>${t(`ob.${st.id}.sub`) !== `ob.${st.id}.sub` ? `<p class="obsub">${esc(t(`ob.${st.id}.sub`))}</p>` : ''}`;
      const next = (label = t('ob.next'), dis = false) => `<button class="log obnext" data-ob="next" ${dis ? 'disabled' : ''}><span>${label}</span>${I.fwd}</button>`;
      if (st.kind === 'welcome') {
        return `<div class="obhero"><span class="orb big obglow"><i class="core"><b></b><b></b><b></b></i></span></div>${q}
          <ul class="obwhy"><li>${I.check}<span>${t('ob.why1')}</span></li><li>${I.check}<span>${t('ob.why2')}</span></li><li>${I.check}<span>${t('ob.why3')}</span></li></ul>
          ${next(t('ob.start'))}`;
      }
      if (st.kind === 'chat') {
        return `<h1>${esc(t('iv.title'))}</h1><div class="ivslot"></div>${next(chat?.finished ? t('ob.next') : t('iv.enough'))}`;
      }
      if (st.kind === 'text') {
        return `${q}<input type="text" class="obinput" data-ob-input="name" value="${esc(a.name)}" maxlength="30" autocomplete="given-name" placeholder="${esc(t('ob.name.ph'))}" enterkeyhint="next">${next()}`;
      }
      if (st.kind === 'number') {
        const v = st.id === 'weight' ? toDisplay(a.weight, state.settings.unit) : a[st.id];
        const unit = st.id === 'age' ? t('ob.years') : st.id === 'height' ? 'cm' : t(`unit.${state.settings.unit}`);
        const [min, max] = st.id === 'weight' && state.settings.unit === 'lb' ? [80, 440] : [st.min, st.max];
        return `${q}<div class="obnum"><button class="step" data-ob="minus" aria-label="−">−</button><b id="obv">${esc(st.id === 'weight' ? fmtW(a.weight, state.settings.unit, state.lang) : String(v))}</b><span>${esc(unit)}</span><button class="step" data-ob="plus" aria-label="+">+</button></div>
          <input type="range" class="obrange" data-ob-range="${st.id}" min="${min}" max="${max}" step="${st.step}" value="${v}" aria-label="${esc(t(`ob.${st.id}.q`, { name: '' }))}">${next()}`;
      }
      if (st.kind === 'choice') {
        return `${q}<div class="obopts${st.row ? ' row' : ''}">${st.options.map((o, k) => `<button class="obopt${a[st.id] === o ? ' on' : ''}" data-ob="pick" data-v="${o}" style="--i:${k}"><strong>${esc(t(`ob.${st.id}.${o}`))}</strong>${st.sub ? `<small>${esc(t(`ob.${st.id}.${o}.sub`))}</small>` : ''}<span class="obck">${I.check}</span></button>`).join('')}</div>`;
      }
      if (st.kind === 'multi') {
        return `${q}<div class="obchips"><button class="chip" data-ob="none" aria-pressed="${!a.injuries.length}">${t('ob.injuries.none')}</button>${st.options.map(o => `<button class="chip" data-ob="multi" data-v="${o}" aria-pressed="${a.injuries.includes(o)}">${esc(t(`ob.injuries.${o}`))}</button>`).join('')}</div>${next()}`;
      }
      if (st.kind === 'plan') {
        const pr = PROGRAMS.find(x => x.id === programFor(profile()));
        const mine = a.routines?.length ? validatePlan({ name: t('ob.plan.mineName'), days: a.routines }, state.catalog) : null;
        const opts = [mine && ['mine', t('ob.plan.mine'), mine.days.map(d => d.name).join(' · ')], getKey('google') && ['coach', t('ob.plan.coach'), t('ob.plan.coach.sub')], ['program', t('ob.plan.program', { name: state.lang === 'da' ? pr.da : pr.en }), t('ob.plan.program.sub', { n: pr.perWeek })], ['keep', t('ob.plan.keep'), t('ob.plan.keep.sub')]].filter(Boolean);
        return `${q}<div class="obopts">${opts.map(([v, l, sub], k) => `<button class="obopt${a.plan === v ? ' on' : ''}" data-ob="plan" data-v="${v}" style="--i:${k}"><strong>${esc(l)}</strong><small>${esc(sub)}</small><span class="obck">${I.check}</span></button>`).join('')}</div>`;
      }
      // done
      const chips = [a.age && `${a.age} ${t('ob.years')}`, a.goal && t(`ob.goal.${a.goal}`), a.days && t('ob.daysShort', { n: a.days }), a.minutes && `${a.minutes} min`, a.equipment && t(`ob.equipment.${a.equipment}`)].filter(Boolean);
      return `<div class="obhero done"><span class="obdone">${I.check}</span></div>${q}<div class="obsum">${chips.map((c, k) => `<span style="--i:${k}">${esc(c)}</span>`).join('')}</div>${next(t('ob.finish'))}`;
    }

    const go = async (d) => {
      const cur = box.querySelector('.obstep');
      cur?.classList.add(d > 0 ? 'out-l' : 'out-r');
      await new Promise(r => setTimeout(r, 160));
      i = Math.max(0, Math.min(list.length - 1, i + d));
      render(d);
    };

    // ---- the conversation: mounted once, moved into its step whenever that step shows ----
    const skipHeard = heard => {
      const done = new Set(heard);
      if (a.asked.injuries) done.add('injuries');
      if (a.asked.age) done.add('age');
      if (a.asked.body) { done.add('height'); done.add('weight'); }
      if (a.asked.cardio) done.add('cardio');
      list = list.filter((x, k) => k <= i || !done.has(x.id)); // only ask what the chat didn't cover
    };
    const placeChat = () => {
      const slot = box.querySelector('.ivslot');
      if (!slot) return;
      if (!chat) chat = mountInterview(chatEl, a, {
        onChange: heard => skipHeard(heard),
        onDone: () => { chat.finished = true; const b = box.querySelector('.obnext span'); if (b) b.textContent = t('ob.next'); box.querySelector('.obnext')?.classList.add('ready'); }
      });
      slot.replaceWith(chatEl);
    };

    async function finish() {
      await save();
      await closeTop();
      haptic('success');
      if (a.plan === 'mine') {
        const plan = validatePlan({ name: t('ob.plan.mineName'), days: a.routines }, state.catalog);
        if (plan) {
          await store.replaceRoutines(planToRoutines(plan));
          toast({ title: esc(t('ob.plan.mineSaved', { n: plan.days.length })) });
        }
      } else if (a.plan === 'coach') {
        const split = a.routines?.length ? ` ${state.lang === 'da' ? 'Min nuværende split' : 'My current split'}: ${a.routines.map(r => `${r.name}: ${r.exercises.map(x => `${x.exercise} ${x.sets}x${x.reps}`).join(', ')}`).join('; ')}.` : '';
        nav.go('coach'); setTimeout(() => nav.ask(planRequest(profile(), state.lang) + split), 300);
      }
      else if (a.plan === 'program') {
        const id = programFor(profile());
        const pr = PROGRAMS.find(x => x.id === id);
        await store.saveRoutines(programRoutines(id, state.lang));
        toast({ title: esc(t('routine.programAdded', { name: state.lang === 'da' ? pr.da : pr.en })) });
      } else toast({ title: esc(t('ob.saved')) });
    }

    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-ob]');
      if (!b || b.disabled) return;
      const k = b.dataset.ob, st = list[i];
      if (k === 'back') { haptic('tap'); return go(-1); }
      if (k === 'skip') {
        haptic('tap');
        if (st.kind === 'welcome' || st.kind === 'plan') { if (st.kind === 'welcome') { store.setSettings({ profileAsked: Date.now() }); saved = true; return closeTop(); } return go(1); }
        return go(1);
      }
      if (k === 'next') {
        if (st.kind === 'chat') chat?.pause();
        if (st.kind === 'done') return finish();
        haptic('tap');
        return go(1);
      }
      if (k === 'pick' || k === 'plan') {
        const v = st.options?.some(o => typeof o === 'number') ? Number(b.dataset.v) : b.dataset.v;
        a[k === 'plan' ? 'plan' : st.id] = v;
        for (const o of box.querySelectorAll('.obopt')) o.classList.toggle('on', o === b);
        haptic('tap');
        setTimeout(() => go(1), 260); // a beat to see the tick, then on
        return;
      }
      if (k === 'multi' || k === 'none') {
        if (k === 'none') a.injuries = [];
        else a.injuries = a.injuries.includes(b.dataset.v) ? a.injuries.filter(x => x !== b.dataset.v) : [...a.injuries, b.dataset.v];
        box.querySelector('[data-ob=none]').setAttribute('aria-pressed', String(!a.injuries.length));
        for (const c of box.querySelectorAll('[data-ob=multi]')) c.setAttribute('aria-pressed', String(a.injuries.includes(c.dataset.v)));
        haptic('tap');
        return;
      }
      if (k === 'minus' || k === 'plus') {
        const r = box.querySelector('.obrange');
        r.value = String(Number(r.value) + (k === 'plus' ? 1 : -1) * Number(r.step));
        r.dispatchEvent(new Event('input', { bubbles: true }));
        haptic('tap');
      }
    });
    box.addEventListener('input', e => {
      const n = e.target.dataset.obInput;
      if (n) { a[n] = e.target.value; return; }
      const r = e.target.dataset.obRange;
      if (!r) return;
      const v = Number(e.target.value);
      if (r === 'weight') { a.weight = fromDisplay(v, state.settings.unit); a.weightTouched = true; }
      else a[r] = v;
      const out = box.querySelector('#obv');
      out.textContent = r === 'weight' ? fmtW(a.weight, state.settings.unit, state.lang) : String(v);
      out.classList.remove('tick'); void out.offsetWidth; out.classList.add('tick');
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.obinput')) { e.preventDefault(); go(1); } });
    render(1);
  }, { label: t('ob.title'), onClose: () => { chat?.destroy(); if (!saved) { saved = true; const pr = profile(); store.setSettings({ profile: i > (edit ? 0 : 1) ? pr : state.settings.profile, profileAsked: Date.now(), ...(i > 1 ? derivedSettings(pr) : {}) }); } } });
  api.sheet.classList.add('obsheet');
}

// First open (or first open after this update): ask once, unless something's in progress.
export function maybeOnboard() {
  const s = state.settings;
  if (s.profile || s.profileAsked || state.active || state.activeCardio || navigator.webdriver) return; // not for test automation
  setTimeout(() => { if (!state.settings.profileAsked && !document.querySelector('.sheet.show')) openOnboarding(); }, 700);
}
