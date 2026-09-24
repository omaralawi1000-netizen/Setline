// Turns a parsed intent into a command: what the card shows, what gets spoken, and what runs.
// Pure: reads a state snapshot, returns descriptors. The UI executes them.
//
// snap = { active, history, prs, routines, undoCount, settings: {unit, restSec, spoken}, catalog, now }
// t = translator for the reply language, lang = that language
//
// command = {
//   kind: 'auto' | 'confirm' | 'ask' | 'info' | 'error' | 'cancel',
//   title, value, sub,           // card text (plain strings)
//   say,                         // spoken reply (already per spoken-mode) or ''
//   run,                         // {op:'update', fn, nav} | {op:'start', template} | {op:'finish'} | {op:'discard'} | {op:'undo'} | null
//   choices,                     // [{label, intent}] for ask
//   icon                         // 'check' | 'ask' | 'alert' | 'info'
// }
import * as W from './workout.js';
import { bestsFrom, e1rm } from './pr.js';
import { routineName, estimateMinutes, nextRoutine } from './routines.js';
import { mergeCheckin, readiness, routineGroups } from './checkin.js';
import { weight as fmtW } from './format.js';
import { cardioName, validateCardio, makeCardioSession, paceText } from './cardio.js';
import { suggest } from './progression.js';
import { validBodyweight, proteinTarget, dateKey, bodyTrend } from './body.js';

export const AUTO_MS = 1500;

export function resolve(intent, snap, t, lang) {
  const { active: w, settings } = snap;
  const unit = settings.unit;
  const u = t(`unit.${unit}`);
  const sayUnit = t(`say.${unit}`);
  const name = id => snap.catalog.name(id, snap.nameLang || lang);     // on the card
  const sayName = id => snap.catalog.name(id, lang);                  // spoken
  const kgTxt = kg => fmtW(kg, unit, lang);
  const setTxt = (kg, reps) => `${kgTxt(kg)} ${u} × ${reps}`;
  const heard = intent.heard || '';
  const full = settings.spoken === 'full';
  const say = (minimal, fullText = minimal) => (settings.spoken === 'off' ? '' : full ? fullText : minimal);
  const restWords = sec => {
    if (sec < 60 || (sec < 120 && sec % 60)) return t('say.sec', { n: sec });
    return t('say.min', { m: Math.floor(sec / 60), s: sec % 60 });
  };
  const cmd = (kind, fields) => ({ kind, icon: kind === 'error' ? 'alert' : kind === 'ask' || kind === 'confirm' ? 'ask' : kind === 'info' ? 'info' : 'check', title: '', value: null, sub: '', say: '', run: null, choices: null, intent, ...fields });
  const err = (key, subKey, extra = {}) => cmd('error', { title: t(key), sub: subKey ? t(subKey) : '', say: say(t(key)), ...extra });

  const needWorkout = () => {
    if (w) return null;
    const choices = snap.routines.map(r => ({ label: routineName(r, lang), intent: { type: 'StartRoutine', routineId: r.id, then: intent } }));
    choices.push({ label: t('today.startEmpty'), intent: { type: 'StartEmpty', then: intent } });
    return cmd('ask', { title: t('voice.noWorkout'), sub: t('voice.noWorkoutSub'), choices, say: say(t('voice.noWorkout')) });
  };
  const cur = () => (w && w.exercises[w.current]) || null;
  // "same again", "correct that", "delete that" right after an auto-advance mean the exercise just finished
  const tIdx = () => {
    if (!w) return -1;
    const c = w.exercises[w.current], a = w.advancedFrom;
    return c && !c.sets.some(s => s.done) && Number.isInteger(a) && w.exercises[a]?.sets.some(s => s.done) ? a : w.current;
  };
  const tgt = () => (w && w.exercises[tIdx()]) || null;
  const lastDone = ex => { const i = ex ? W.lastDoneIndex(ex) : -1; return i === -1 ? null : { i, set: ex.sets[i] }; };

  // one or more sets on an exercise (adds the exercise if it isn't in the workout)
  const logCommand = (kg, reps, count, exerciseId, subText) => {
    const check = W.validateSet(kg, reps);
    if (!check.ok) return err(check.error === 'kg' ? 'invalid.kg' : 'invalid.reps', null, { title: t(check.error === 'kg' ? 'invalid.kg' : 'invalid.reps', { max: kgTxt(W.LIMITS.kgMax), unit: u }) });
    const idx = exerciseId ? w.exercises.findIndex(e => e.exerciseId === exerciseId) : w.current;
    const exId = exerciseId || cur()?.exerciseId;
    if (!exId) return err('voice.noExercise');
    const ex = idx >= 0 ? w.exercises[idx] : { sets: [] };
    const n = W.nextSetNumber(ex);
    count = Math.max(1, Math.min(10, count || 1));
    const fn = (cw, now) => {
      let x = cw, i = exerciseId ? cw.exercises.findIndex(e => e.exerciseId === exerciseId) : cw.current;
      if (i === -1) { x = W.addExercise(x, exId); i = x.exercises.length - 1; }
      const b = x;
      for (let k = 0; k < count; k++) x = W.logSet(x, i, { kg, reps }, now, W.restFor(x.exercises[i], settings.restByEx, settings.restSec)).workout;
      return settings.autoAdvance ? W.advanceAfterLog(b, x, i) : x;
    };
    const value = count > 1 ? `${count} × ${setTxt(kg, reps)}` : setTxt(kg, reps);
    const sub = subText ?? (count > 1 ? t('voice.heardSets', { text: heard, from: n, to: n + count - 1 }) : t('voice.heardSet', { text: heard, n }));
    const spoken = count > 1
      ? t('say.logMany', { count, reps, kg: kgTxt(kg), unit: sayUnit })
      : say(t('say.log.minimal', { kg: kgTxt(kg), reps }), t('say.log.full', { name: sayName(exId), kg: kgTxt(kg), unit: sayUnit, reps, n, rest: restWords(W.restFor(idx >= 0 ? w.exercises[idx] : { exerciseId: exId }, settings.restByEx, settings.restSec)) }));
    return cmd(check.confirm.length ? 'confirm' : 'auto', {
      title: name(exId), value, sub: check.confirm.length ? t('voice.checkNumbers') : sub,
      say: settings.spoken === 'off' ? '' : spoken, run: { op: 'update', fn, nav: 'workout' }
    });
  };

  // several different sets at once: "9, 8 and 8 reps at 100 kg"
  const logManyCommand = (sets, exerciseId) => {
    for (const s of sets) {
      const check = W.validateSet(s.kg, s.reps);
      if (!check.ok) return err('voice.didntCatch', null, { title: t(check.error === 'kg' ? 'invalid.kg' : 'invalid.reps', { max: kgTxt(W.LIMITS.kgMax), unit: u }) });
    }
    const exId = exerciseId || cur()?.exerciseId;
    if (!exId) return err('voice.noExercise');
    const idx = exerciseId ? w.exercises.findIndex(e => e.exerciseId === exerciseId) : w.current;
    const n = W.nextSetNumber(idx >= 0 ? w.exercises[idx] : { sets: [] });
    const heavy = sets.some(s => W.validateSet(s.kg, s.reps).confirm.length);
    const fn = (cw, now) => {
      let x = cw, i = exerciseId ? cw.exercises.findIndex(e => e.exerciseId === exerciseId) : cw.current;
      if (i === -1) { x = W.addExercise(x, exId); i = x.exercises.length - 1; }
      const b = x;
      for (const s of sets) x = W.logSet(x, i, s, now, W.restFor(x.exercises[i], settings.restByEx, settings.restSec)).workout;
      return settings.autoAdvance ? W.advanceAfterLog(b, x, i) : x;
    };
    const same = sets.every(s => s.kg === sets[0].kg);
    const value = same ? `${kgTxt(sets[0].kg)} ${u} × ${sets.map(s => s.reps).join(', ')}` : sets.map(s => setTxt(s.kg, s.reps)).join(', ');
    return cmd(heavy ? 'confirm' : 'auto', {
      title: name(exId), value, sub: heavy ? t('voice.checkNumbers') : t('voice.heardSets', { text: heard, from: n, to: n + sets.length - 1 }),
      say: say(t('say.logList', { n: sets.length, kg: kgTxt(sets[0].kg), unit: sayUnit, reps: sets.map(s => s.reps).join(', ') })),
      run: { op: 'update', fn, nav: 'workout' }
    });
  };

  // change the last done set of the current exercise
  const editCommand = (kg, reps) => {
    const ex = tgt(), ti = tIdx();
    const last = lastDone(ex);
    if (!last) return err('voice.noSetYet');
    const check = W.validateSet(kg, reps);
    if (!check.ok) return err('voice.didntCatch', null, { title: t(check.error === 'kg' ? 'invalid.kg' : 'invalid.reps', { max: kgTxt(W.LIMITS.kgMax), unit: u }) });
    const setId = last.set.id;
    const fn = cw => W.editSet(cw, ti, setId, { kg, reps });
    return cmd(check.confirm.length ? 'confirm' : 'auto', {
      title: name(ex.exerciseId), value: setTxt(kg, reps),
      sub: t('voice.was', { n: last.i + 1, old: setTxt(last.set.kg, last.set.reps) }),
      say: say(t('say.edit', { n: last.i + 1, kg: kgTxt(kg), unit: sayUnit, reps })),
      run: { op: 'update', fn, nav: 'workout' }
    });
  };

  const exerciseCtx = id => id || cur()?.exerciseId || null;

  switch (intent.type) {
    case 'LogSet': {
      const need = needWorkout(); if (need) return need;
      return logCommand(intent.kg, intent.reps, intent.count, intent.exerciseId || null);
    }
    case 'LogSets': {
      const need = needWorkout(); if (need) return need;
      return logManyCommand(intent.sets, intent.exerciseId || null);
    }
    case 'RepeatLast': {
      const need = needWorkout(); if (need) return need;
      const ex = tgt();
      const last = lastDone(ex);
      if (!last) return err('voice.nothingRepeat');
      return logCommand(last.set.kg, last.set.reps, intent.count || 1, tIdx() !== w.current ? ex.exerciseId : null);
    }
    case 'AdjustLast': {
      const need = needWorkout(); if (need) return need;
      const last = lastDone(tgt());
      if (!last) return err('voice.noSetYet');
      const kg = Math.max(0, Math.round((last.set.kg + (intent.kgDelta || 0)) * 1000) / 1000);
      const reps = last.set.reps + (intent.repsDelta || 0);
      return editCommand(kg, reps);
    }
    case 'EditLast': {
      const need = needWorkout(); if (need) return need;
      const last = lastDone(tgt());
      if (!last) return err('voice.noSetYet');
      return editCommand(intent.kg ?? last.set.kg, intent.reps ?? last.set.reps);
    }
    case 'DeleteLast': {
      const need = needWorkout(); if (need) return need;
      const ex = tgt(), ti = tIdx();
      const last = lastDone(ex);
      if (!last) return err('voice.noSetYet');
      const setId = last.set.id;
      return cmd('confirm', {
        title: t('voice.deleteLast'), value: null, sub: `${name(ex.exerciseId)}, ${t('workout.editSet', { n: last.i + 1 })}: ${setTxt(last.set.kg, last.set.reps)}`,
        say: say(t('voice.deleteLast')), run: { op: 'update', fn: cw => W.deleteSet(cw, ti, setId), nav: 'workout', done: t('say.deleted') }
      });
    }
    case 'Undo':
      if (!snap.undoCount) return err('voice.nothingUndo');
      return cmd('auto', { title: t('voice.undoLast'), sub: t('voice.heard', { text: heard }), say: say(t('say.undo')), run: { op: 'undo' } });
    case 'NextExercise':
    case 'PrevExercise': {
      const need = needWorkout(); if (need) return need;
      if (!w.exercises.length) return err('voice.noExercise');
      const to = w.current + (intent.type === 'NextExercise' ? 1 : -1);
      if (to >= w.exercises.length) return err('voice.lastExercise');
      if (to < 0) return err('voice.firstExercise');
      const exId = w.exercises[to].exerciseId;
      return cmd('auto', {
        title: t('voice.nowOn'), value: name(exId), sub: t('workout.exerciseOf', { i: to + 1, n: w.exercises.length }),
        say: say(t('say.next', { name: sayName(exId) })), run: { op: 'update', fn: cw => W.setCurrent(cw, to), nav: 'workout' }
      });
    }
    case 'AddExercise': {
      const need = needWorkout(); if (need) return need;
      const at = w.exercises.findIndex(e => e.exerciseId === intent.exerciseId);
      if (at >= 0) {
        return cmd('auto', {
          title: t('voice.nowOn'), value: name(intent.exerciseId), sub: t('workout.exerciseOf', { i: at + 1, n: w.exercises.length }),
          say: say(t('say.next', { name: sayName(intent.exerciseId) })), run: { op: 'update', fn: cw => W.setCurrent(cw, at), nav: 'workout' }
        });
      }
      if (w.exercises.length >= W.LIMITS.exercisesPerWorkout) return err('toast.limit');
      return cmd('auto', {
        title: t('voice.added'), value: name(intent.exerciseId), sub: t('voice.heard', { text: heard }),
        say: say(t('say.added', { name: sayName(intent.exerciseId) })), run: { op: 'update', fn: cw => W.addExercise(cw, intent.exerciseId), nav: 'workout' }
      });
    }
    case 'SwapExercise': {
      const need = needWorkout(); if (need) return need;
      const ex = cur();
      if (!ex) return err('voice.noExercise');
      if (ex.exerciseId === intent.exerciseId) return cmd('info', { title: t('voice.nowOn'), value: name(ex.exerciseId), say: '' });
      return cmd('auto', {
        title: name(intent.exerciseId), value: null, sub: t('voice.swapped', { name: name(ex.exerciseId) }),
        say: say(t('say.next', { name: sayName(intent.exerciseId) })), run: { op: 'update', fn: cw => W.swapExercise(cw, cw.current, intent.exerciseId), nav: 'workout' }
      });
    }
    case 'StartRoutine': {
      if (w) return err('voice.alreadyRunning');
      const r = snap.routines.find(x => x.id === intent.routineId);
      if (!r) return err('voice.didntCatch');
      const template = snap.planFor ? snap.planFor(r) : W.planFromHistory(r, snap.history);
      return cmd('auto', {
        title: t('voice.starting'), value: routineName(r, lang), sub: t('today.exercisesAbout', { n: r.exercises.length, min: estimateMinutes(r) }),
        say: say(t('say.start', { name: routineName(r, lang) })), run: { op: 'start', template, then: intent.then || null }
      });
    }
    case 'StartEmpty':
      if (w) return err('voice.alreadyRunning');
      return cmd('auto', { title: t('voice.starting'), value: t('voice.emptyWorkout'), sub: t('voice.heard', { text: heard }), say: say(t('say.start', { name: t('voice.emptyWorkout') })), run: { op: 'start', template: {}, then: intent.then || null } });
    case 'Finish': {
      if (snap.activeCardio && !w) return cmd('confirm', { title: t('cardio.finishTitle'), sub: cardioName(snap.activeCardio.type, snap.nameLang || lang), say: say(t('cardio.finishTitle')), run: { op: 'cardio-finish' } });
      const need = needWorkout(); if (need) return need;
      const sets = W.doneSetCount(w);
      if (!sets) return cmd('confirm', { title: t('discard.title'), sub: t('finish.nothing'), say: say(t('finish.nothing')), run: { op: 'discard' } });
      return cmd('confirm', {
        title: t('finish.title'),
        sub: t('finish.summary', { time: `${Math.max(1, Math.round(W.elapsedSec(w, snap.now) / 60))} min`, sets, volume: fmtW(Math.round(W.volume(w)), unit, lang), unit: u }),
        say: say(t('say.confirmFinish')), run: { op: 'finish' }
      });
    }
    case 'Discard': {
      if (snap.activeCardio && !w) return cmd('confirm', { title: t('cardio.discardTitle'), sub: t('discard.body'), say: say(t('cardio.discardTitle')), run: { op: 'cardio-discard' } });
      const need = needWorkout(); if (need) return need;
      return cmd('confirm', { title: t('discard.title'), sub: t('discard.body'), say: say(t('discard.title')), run: { op: 'discard' } });
    }
    case 'StartRest': {
      const need = needWorkout(); if (need) return need;
      const sec = Math.max(10, Math.min(900, intent.sec || settings.restSec));
      return cmd('auto', {
        title: t('voice.rest'), value: restClock(sec), sub: t('voice.heard', { text: heard }),
        say: say(t('say.rest', { time: restWords(sec) })), run: { op: 'update', fn: (cw, now) => W.startRest(cw, sec, now), nav: 'workout' }
      });
    }
    case 'AdjustRest': {
      const need = needWorkout(); if (need) return need;
      const left = W.restRemaining(w.rest, snap.now);
      if (!left) return err('voice.noRest');
      const next = Math.max(0, left + intent.sec);
      return cmd('auto', {
        title: t('voice.rest'), value: restClock(next), sub: `${intent.sec > 0 ? '+' : '−'}${Math.abs(intent.sec)} s`,
        say: say(t('say.restLeft', { time: restWords(next) })), run: { op: 'update', fn: (cw, now) => W.adjustRest(cw, intent.sec, now), nav: 'workout' }
      });
    }
    case 'SkipRest': {
      const need = needWorkout(); if (need) return need;
      if (!W.restRemaining(w.rest, snap.now)) return err('voice.noRest');
      return cmd('auto', { title: t('voice.restSkipped'), sub: t('voice.heard', { text: heard }), say: say(t('say.skip')), run: { op: 'update', fn: cw => W.skipRest(cw), nav: 'workout' } });
    }
    case 'LogCardio': {
      if (!intent.durationSec) return cmd('ask', { title: t('voice.askDuration'), sub: t('voice.askSub'), say: say(t('voice.askDuration')), choices: [] });
      const v = validateCardio({ type: intent.cardioType, durationSec: intent.durationSec, distanceKm: intent.distanceKm ?? null, zone: intent.zone ?? null });
      if (!v.ok) return err('voice.cardioInvalid');
      const session = makeCardioSession({ type: intent.cardioType, startedAt: (snap.now ?? Date.now()) - intent.durationSec * 1000, durationSec: intent.durationSec, distanceKm: intent.distanceKm ?? null, zone: intent.zone ?? null, source: 'voice' });
      const parts = [durTxt(intent.durationSec)];
      if (session.distanceKm) parts.unshift(`${fmtW(session.distanceKm, 'kg', lang)} km`);
      const pace = paceText(session, lang);
      return cmd('auto', {
        title: cardioName(session.type, snap.nameLang || lang), value: parts.join(' · '),
        sub: [pace, intent.zone ? t('cardio.zone', { n: intent.zone }) : '', t('voice.heard', { text: heard })].filter(Boolean).join(' · '),
        say: say(t('say.cardio', { name: cardioName(session.type, lang), time: durWords(intent.durationSec) })),
        run: { op: 'cardio-log', session }
      });
    }
    case 'StartCardio': {
      if (snap.activeCardio) return err('voice.cardioRunning');
      if (w) return cmd('info', { title: t('voice.cardioAfter'), sub: t('voice.cardioAfterSub'), say: say(t('voice.cardioAfter')) });
      return cmd('auto', { title: t('voice.starting'), value: cardioName(intent.cardioType, snap.nameLang || lang), sub: t('voice.heard', { text: heard }), say: say(t('say.start', { name: cardioName(intent.cardioType, lang) })), run: { op: 'cardio-start', type: intent.cardioType } });
    }
    case 'LogBodyweight': {
      if (!validBodyweight(intent.kg)) return err('voice.bwInvalid');
      return cmd('auto', { title: t('body.weight'), value: `${kgTxt(intent.kg)} ${u}`, sub: t('voice.heard', { text: heard }), say: say(t('say.bw', { kg: kgTxt(intent.kg), unit: sayUnit })), run: { op: 'bodyweight', kg: intent.kg } });
    }
    case 'CheckIn': {
      const date = dateKey(snap.now);
      const prev = (snap.daily || []).find(d => d.date === date) || null;
      const next = mergeCheckin(prev, intent, date, snap.now);
      const r = readiness(next, routineGroups(nextRoutine(snap.routines || [], snap.history || []), snap.catalog));
      return cmd('auto', {
        title: t('checkin.title'), value: checkinText(next, t, lang), sub: r ? t('checkin.advice.' + r.advice, { score: r.score }) : t('voice.heard', { text: heard }),
        say: say(r ? t('say.checkin', { score: r.score, advice: t('say.checkin.' + r.advice) }) : t('checkin.saved')), run: { op: 'checkin', patch: intent }
      });
    }
    case 'LogMeal':
      return cmd('auto', { title: t('meal.title'), value: intent.text, sub: t('meal.reading'), say: '', run: { op: 'meal', text: intent.text } });
    case 'LogProtein': {
      if (!(intent.grams > 0 && intent.grams <= 300)) return err('voice.didntCatch');
      const today = (snap.nutrition || []).find(n => n.date === dateKey(snap.now))?.protein || 0;
      const bw = bodyTrend(snap.bodyweight || [])?.latest.kg;
      const target = proteinTarget(bw, settings.proteinPerKg);
      const total = today + intent.grams;
      return cmd('auto', {
        title: t('body.protein'), value: `+${intent.grams} g`, sub: target ? t('body.proteinOf', { g: total, target }) : t('body.proteinToday', { g: total }),
        say: say(target ? t('say.protein', { g: total, left: Math.max(0, target - total) }) : t('say.proteinNoTarget', { g: total })), run: { op: 'protein', grams: intent.grams }
      });
    }
    case 'Query': return query();
    case 'Cancel': return cmd('cancel', { title: t('voice.cancelled'), say: '' });
    case 'Help': return cmd('info', { title: t('voice.help'), sub: ['voice.hint.log', 'voice.hint.same', 'voice.hint.add', 'voice.hint.skip', 'voice.hint.next', 'voice.hint.last'].map(k => t(k)).join(' · '), say: '' });
    case 'Ask': {
      if (intent.reason === 'exercise' && intent.choices?.length) {
        return cmd('ask', {
          title: t('voice.askExercise'), sub: t('voice.heard', { text: heard }), say: say(t('say.askExercise')),
          choices: intent.choices.map(id => ({ label: name(id), intent: { ...intent.then, exerciseId: id, heard } }))
        });
      }
      if (intent.reason === 'duration') return cmd('ask', { title: t('voice.askDuration'), sub: t('voice.askSub'), say: say(t('voice.askDuration')), choices: [] });
      const key = intent.reason === 'weight' ? 'askWeight' : 'askReps';
      return cmd('ask', { title: t(`voice.${key}`), sub: t('voice.askSub'), say: say(t(`say.${key}`)), choices: [] });
    }
    default:
      return cmd('error', { title: t('voice.didntCatch'), sub: heard ? t('voice.heard', { text: heard }) : '', say: say(t('say.didnt')), retry: true });
  }

  function durTxt(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function durWords(sec) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h ? t('say.hm', { h, m }) : t('say.min', { m, s: 0 });
  }

  function restClock(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

  function query() {
    const exId = exerciseCtx(intent.exerciseId);
    if (intent.what === 'restLeft') {
      const left = w ? W.restRemaining(w.rest, snap.now) : 0;
      if (!left) return cmd('info', { title: t('voice.noRest'), say: say(t('voice.noRest')) });
      return cmd('info', { title: t('q.restLeft', { time: restClock(left) }), say: say(t('say.restLeft', { time: restWords(left) })) });
    }
    if (intent.what === 'setsLeft') {
      const need = needWorkout(); if (need) return need;
      const ex = cur();
      if (!ex) return err('voice.noExercise');
      const exLeft = ex.sets.filter(s => !s.done).length;
      const total = w.exercises.reduce((a, e) => a + e.sets.filter(s => !s.done).length, 0);
      const setsWord = n => t('say.setsWord', { n });
      return cmd('info', {
        title: t('q.setsLeft', { ex: setsWord(exLeft), name: name(ex.exerciseId) }), sub: t('q.setsLeftSub', { total: setsWord(total) }),
        say: say(t('say.setsLeft', { ex: setsWord(exLeft), name: sayName(ex.exerciseId), total: setsWord(total) }))
      });
    }
    if (!exId) return err('voice.noExercise');
    if (intent.what === 'suggest') {
      const e = snap.catalog.get(exId);
      const ex = cur();
      const target = ex?.sets.find(s => !s.done)?.reps ?? null;
      const sg = e ? suggest(snap.history, e, target) : null;
      if (!sg) return cmd('info', { title: t('q.noHistory', { name: name(exId) }), say: say(t('q.noHistory', { name: name(exId) })) });
      return cmd('info', {
        title: name(exId), value: setTxt(sg.kg, sg.reps), sub: t(`suggest.${sg.reason}`, { from: setTxt(sg.from.kg, sg.from.reps) }),
        say: say(t('say.suggest', { kg: kgTxt(sg.kg), unit: sayUnit, reps: sg.reps, why: t(`suggest.${sg.reason}`, { from: `${kgTxt(sg.from.kg)} ${sayUnit} ${t('say.for')} ${sg.from.reps}` }) }))
      });
    }
    if (intent.what === 'pr') {
      const b = bestsFrom(snap.prs, exId);
      if (!b.e1rm) return cmd('info', { title: t('q.noPr', { name: name(exId) }), say: say(t('q.noPr', { name: name(exId) })) });
      const best = setTxt(b.e1rm.kg, b.e1rm.reps);
      return cmd('info', {
        title: t('q.best', { name: name(exId) }), value: best,
        sub: t('q.bestSub', { heavy: `${kgTxt(b.weight.kg)} ${u} × ${b.weight.reps}`, e1rm: `${kgTxt(b.e1rm.value)} ${u}` }),
        say: say(t('say.pr', { name: sayName(exId), best: `${kgTxt(b.e1rm.kg)} ${sayUnit} ${t('say.for')} ${b.e1rm.reps}`, e1rm: kgTxt(e1rm(b.e1rm.kg, b.e1rm.reps)), unit: sayUnit }))
      });
    }
    // last time
    const last = W.lastSession(snap.history, exId);
    if (!last) return cmd('info', { title: t('q.noHistory', { name: name(exId) }), say: say(t('q.noHistory', { name: name(exId) })) });
    const groups = [];
    for (const s of last.sets) {
      const g = groups[groups.length - 1];
      if (g && g.kg === s.kg && g.reps === s.reps) g.n++; else groups.push({ kg: s.kg, reps: s.reps, n: 1 });
    }
    const shown = groups.map(g => `${g.n > 1 ? `${g.n} × ` : ''}${setTxt(g.kg, g.reps)}`).join(', ');
    const spoken = groups.map(g => `${g.n > 1 ? `${t('say.setsWord', { n: g.n })}, ` : ''}${kgTxt(g.kg)} ${sayUnit} ${t('say.for')} ${g.reps}`).join('; ');
    return cmd('info', { title: `${t('q.last')}: ${name(exId)}`, value: null, sub: shown, say: say(t('say.last', { sets: spoken })) });
  }
}

// "7 h sleep · energy 4 · legs sore"
export function checkinText(c, t, lang = 'en') {
  const parts = [];
  if (c.sleepH != null) parts.push(t('checkin.sleepShort', { h: String(c.sleepH).replace('.', lang === 'da' ? ',' : '.') }));
  if (c.energy != null) parts.push(t('checkin.energyShort', { n: c.energy }));
  if (c.sore?.length) parts.push(t('checkin.soreShort', { what: c.sore.map(g => t('group.' + g).toLowerCase()).join(', ') }));
  return parts.join(' · ');
}
