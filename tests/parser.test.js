import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, wordsToNumbers, clean, detectLang } from '../js/parser.js';
import { createCatalog } from '../js/catalog.js';
import { starterRoutines } from '../js/routines.js';

const catalog = createCatalog();
const base = {
  lang: 'auto', unit: 'kg', catalog, usage: {}, routines: starterRoutines(),
  workoutExerciseIds: ['bench-press', 'overhead-press', 'incline-dumbbell-press', 'lateral-raise', 'triceps-pushdown'],
  current: { exerciseId: 'bench-press', lastSet: { kg: 80, reps: 8 }, planned: { kg: 80, reps: 8 } },
  restRunning: false
};
const P = (text, extra = {}) => parse(text, { ...base, ...extra });
const is = (text, expected, extra) => {
  const r = P(text, extra);
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(r[k], v, `"${text}" → ${k}: got ${JSON.stringify(r[k])} (${r.type})`);
  return r;
};
const fresh = { current: { exerciseId: 'bench-press', lastSet: null, planned: null } };

// ---------- numbers ----------

test('English number words', () => {
  assert.equal(wordsToNumbers('eighty two and a half', 'en'), '82.5');
  assert.equal(wordsToNumbers('one hundred and twenty', 'en'), '120');
  assert.equal(wordsToNumbers('a hundred', 'en'), '100');
  assert.equal(wordsToNumbers('eighty point five', 'en'), '80.5');
  assert.equal(wordsToNumbers('twelve', 'en'), '12');
  assert.equal(wordsToNumbers('swap to squat', 'en'), 'swap to squat', 'English "to" is not a number');
});

test('Danish number words and compounds', () => {
  assert.equal(wordsToNumbers('femogtyve', 'da'), '25');
  assert.equal(wordsToNumbers('tres', 'da'), '60');
  assert.equal(wordsToNumbers('halvfjerds', 'da'), '70');
  assert.equal(wordsToNumbers('firs', 'da'), '80');
  assert.equal(wordsToNumbers('halvfems', 'da'), '90');
  assert.equal(wordsToNumbers('to og firs', 'da'), '82');
  assert.equal(wordsToNumbers('toogfirs', 'da'), '82');
  assert.equal(wordsToNumbers('firs komma fem', 'da'), '80.5');
  assert.equal(wordsToNumbers('to og firs og en halv', 'da'), '82.5');
  assert.equal(wordsToNumbers('hundrede og tyve', 'da'), '120');
  assert.equal(wordsToNumbers('et hundrede', 'da'), '100');
  assert.equal(wordsToNumbers('to hundrede', 'da'), '200');
  assert.equal(wordsToNumbers('to', 'da'), '2', 'Danish "to" is two');
});

test('cleanup keeps decimals and splits units', () => {
  assert.equal(clean('Bænkpres 82,5 kilo, 8 gentagelser.'), 'bænkpres 82.5 kilo 8 gentagelser');
  assert.equal(clean('80kg x8'), '80 kg x 8');
  assert.equal(clean('3x8'), '3 x 8');
  assert.equal(clean('Pull-ups'), 'pull ups');
});

test('language detection', () => {
  assert.equal(detectLang('80 kilo 8 gentagelser'), 'da');
  assert.equal(detectLang('80 kilos for 8 reps'), 'en');
  assert.equal(detectLang('samme igen'), 'da');
  assert.equal(detectLang('same again'), 'en');
  assert.equal(detectLang('same again', 'da'), 'da', 'setting wins');
});

// ---------- log set: English ----------

test('EN: 80 kg for 8 reps', () => is('80 kg for 8 reps', { type: 'LogSet', kg: 80, reps: 8, count: 1, exerciseId: null }));
test('EN: 80 for 8', () => is('80 for 8', { type: 'LogSet', kg: 80, reps: 8 }));
test('EN: eighty kilos eight reps', () => is('Eighty kilos, eight reps', { type: 'LogSet', kg: 80, reps: 8 }));
test('EN: 82.5 x 6', () => is('82.5 x 6', { type: 'LogSet', kg: 82.5, reps: 6 }));
test('EN: 8 reps at 80', () => is('8 reps at 80', { type: 'LogSet', kg: 80, reps: 8 }));
test('EN: bench press 80 kg for 8', () => is('Bench press 80 kg for 8.', { type: 'LogSet', kg: 80, reps: 8, exerciseId: 'bench-press' }));
test('EN: named other exercise', () => is('squat 100 kilos 5 reps', { type: 'LogSet', kg: 100, reps: 5, exerciseId: 'back-squat' }));
test('EN: "for" misheard as 4', () => is('80 4 8', { type: 'LogSet', kg: 80, reps: 8 }));
test('EN: "four" word as separator mishearing', () => is('eighty four eight', { type: 'LogSet', kg: 84, reps: 8 }));
test('EN: 10 reps keeps the last weight', () => is('10 reps', { type: 'LogSet', kg: 80, reps: 10 }));
test('EN: reps misheard as wraps', () => is('80 kilos 8 wraps', { type: 'LogSet', kg: 80, reps: 8 }));
test('EN: 3 x 8 is sets by reps', () => is('3 x 8', { type: 'LogSet', kg: 80, reps: 8, count: 3 }));
test('EN: 3 sets of 8 at 60', () => is('3 sets of 8 at 60 kg', { type: 'LogSet', kg: 60, reps: 8, count: 3 }));
test('EN: pounds are converted to kg', () => {
  const r = is('225 pounds for 5', { type: 'LogSet', reps: 5 });
  assert.ok(Math.abs(r.kg - 102.058) < 0.01);
});
test('EN: unit setting lb applies to bare numbers', () => {
  const r = is('135 for 10', { type: 'LogSet', reps: 10 }, { unit: 'lb' });
  assert.ok(Math.abs(r.kg - 61.235) < 0.01);
});
test('EN: bodyweight pull-ups', () => is('10 pull ups', { type: 'LogSet', kg: 0, reps: 10, exerciseId: 'pull-up' }));
test('EN: no last weight means ask', () => is('10 reps', { type: 'Ask', reason: 'weight' }, fresh));
test('EN: weight only uses the planned reps', () => is('82.5 kilos', { type: 'LogSet', kg: 82.5, reps: 8 }));
test('EN: weight only without a plan asks for reps', () => is('82.5 kilos', { type: 'Ask', reason: 'reps' }, fresh));
test('EN: a lone number is not guessed', () => is('8', { type: 'Unknown' }));
test('EN: 0 reps is rejected', () => is('80 kg 0 reps', { type: 'Unknown' }));

// ---------- log set: Danish ----------

test('DA: 80 kilo 8 gentagelser', () => is('80 kilo 8 gentagelser', { type: 'LogSet', kg: 80, reps: 8, lang: 'da' }));
test('DA: bænkpres 82,5 kilo 8 gentagelser', () => is('Bænkpres 82,5 kilo 8 gentagelser', { type: 'LogSet', kg: 82.5, reps: 8, exerciseId: 'bench-press' }));
test('DA: firs kilo otte gentagelser', () => is('firs kilo otte gentagelser', { type: 'LogSet', kg: 80, reps: 8 }));
test('DA: to og firs kilo og otte', () => is('to og firs kilo og otte', { type: 'LogSet', kg: 82, reps: 8 }));
test('DA: halvfjerds komma fem, ti gentagelser', () => is('halvfjerds komma fem ti gentagelser', { type: 'LogSet', kg: 70.5, reps: 10 }));
test('DA: 3 sæt af 8', () => is('3 sæt af 8', { type: 'LogSet', reps: 8, count: 3, kg: 80 }));
test('DA: to sæt af otte ("to" is two)', () => is('to sæt af otte', { type: 'LogSet', reps: 8, count: 2 }));
test('DA: 8 på 80', () => is('8 på 80', { type: 'LogSet', kg: 80, reps: 8 }));
test('DA: dødløft 140 kilo 5', () => is('dødløft 140 kilo 5', { type: 'LogSet', kg: 140, reps: 5, exerciseId: 'deadlift' }));
test('DA: "død løft" split by the recognizer', () => is('død løft 140 kilo 5 gentagelser', { type: 'LogSet', exerciseId: 'deadlift' }));
test('DA: "bænk pres" split by the recognizer', () => is('bænk pres 80 kilo 8', { type: 'LogSet', exerciseId: 'bench-press' }));
test('DA: knæbøj', () => is('knæbøj 100 kilo 5 gentagelser', { type: 'LogSet', exerciseId: 'back-squat', kg: 100, reps: 5 }));
test('DA: militærpres', () => is('militærpres 50 kilo 8', { type: 'LogSet', exerciseId: 'overhead-press' }));
test('DA: gentagelse singular mishearing', () => is('80 kilo 8 gentagelse', { type: 'LogSet', kg: 80, reps: 8 }));
test('DA: femogtyve kilo tolv gange', () => is('femogtyve kilo tolv gentagelser', { type: 'LogSet', kg: 25, reps: 12 }));

// ---------- repeat / adjust / edit ----------

test('EN: same again', () => is('same again', { type: 'RepeatLast', count: 1 }));
test('EN: same again misheard', () => is('same game', { type: 'RepeatLast' }));
test('EN: one more set', () => is('one more set', { type: 'RepeatLast' }));
test('EN: same, 2 more sets', () => is('same 2 more sets', { type: 'RepeatLast', count: 2 }));
test('DA: samme igen', () => is('samme igen', { type: 'RepeatLast', lang: 'da' }));
test('DA: en gang til', () => is('en gang til', { type: 'RepeatLast' }));
test('DA: samme som sidst', () => is('samme som sidst', { type: 'RepeatLast' }));
test('EN: add 2.5', () => is('add 2.5', { type: 'AdjustLast', kgDelta: 2.5 }));
test('EN: add five kilos', () => is('add five kilos', { type: 'AdjustLast', kgDelta: 5 }));
test('EN: take off 10', () => is('take off 10', { type: 'AdjustLast', kgDelta: -10 }));
test('DA: læg 2,5 til', () => is('læg 2,5 til', { type: 'AdjustLast', kgDelta: 2.5 }));
test('DA: læg to komma fem til', () => is('læg to komma fem til', { type: 'AdjustLast', kgDelta: 2.5 }));
test('DA: 5 kilo mere', () => is('5 kilo mere', { type: 'AdjustLast', kgDelta: 5 }));
test('DA: træk 5 fra', () => is('træk 5 fra', { type: 'AdjustLast', kgDelta: -5 }));
test('EN: one more rep', () => is('one more rep', { type: 'AdjustLast', repsDelta: 1 }));
test('EN: two fewer reps', () => is('two fewer reps', { type: 'AdjustLast', repsDelta: -2 }));
test('DA: en rep mere', () => is('en rep mere', { type: 'AdjustLast', repsDelta: 1 }));
test('DA: en gentagelse mindre', () => is('en gentagelse mindre', { type: 'AdjustLast', repsDelta: -1 }));
test('EN: correct, 7 reps', () => is('correct 7 reps', { type: 'EditLast', reps: 7, kg: null }));
test('EN: actually 82.5 for 8', () => is('actually 82.5 for 8', { type: 'EditLast', kg: 82.5, reps: 8 }));
test('EN: last set was 6', () => is('last set was 6', { type: 'EditLast', reps: 6, kg: null }));
test('DA: ret til 7 gentagelser', () => is('ret til 7 gentagelser', { type: 'EditLast', reps: 7 }));
test('DA: det var 85 kilo', () => is('det var 85 kilo', { type: 'EditLast', kg: 85 }));
test('EN: delete last set', () => is('delete the last set', { type: 'DeleteLast' }));
test('DA: slet sidste sæt', () => is('slet sidste sæt', { type: 'DeleteLast' }));
test('EN/DA: undo', () => { is('undo', { type: 'Undo' }); is('fortryd', { type: 'Undo' }); });

// ---------- rest ----------

test('EN: skip rest and mishearing', () => { is('skip rest', { type: 'SkipRest' }); is('skip the rest', { type: 'SkipRest' }); is('skip breast', { type: 'SkipRest' }); });
test('DA: spring pausen over', () => { is('spring pausen over', { type: 'SkipRest' }); is('spring over', { type: 'SkipRest' }); });
test('EN: add 30 seconds', () => is('add 30 seconds', { type: 'AdjustRest', sec: 30 }));
test('EN: minus fifteen seconds', () => is('minus fifteen seconds', { type: 'AdjustRest', sec: -15 }));
test('DA: læg 30 sekunder til', () => is('læg 30 sekunder til', { type: 'AdjustRest', sec: 30 }));
test('DA: tredive sekunder mere', () => is('tredive sekunder mere', { type: 'AdjustRest', sec: 30 }));
test('plus 15 means rest only while resting', () => {
  is('plus 15', { type: 'AdjustRest', sec: 15 }, { restRunning: true });
  is('plus 15', { type: 'AdjustLast', kgDelta: 15 });
});
test('EN: rest 2 minutes', () => is('rest 2 minutes', { type: 'StartRest', sec: 120 }));
test('EN: start rest', () => is('start rest', { type: 'StartRest', sec: null }));
test('DA: pause halvandet minut', () => is('pause halvandet minut', { type: 'StartRest', sec: 90 }));
test('EN: 90 seconds rest', () => is('90 seconds rest', { type: 'StartRest', sec: 90 }));
test('bare duration starts a rest of that length', () => { is('two minutes', { type: 'StartRest', sec: 120 }); is('90 sekunder', { type: 'StartRest', sec: 90 }); });

// ---------- navigation and exercises ----------

test('EN/DA: next and previous exercise', () => {
  is('next exercise', { type: 'NextExercise' });
  is('next exercises', { type: 'NextExercise' });
  is('næste øvelse', { type: 'NextExercise' });
  is('previous exercise', { type: 'PrevExercise' });
  is('forrige øvelse', { type: 'PrevExercise' });
});
test('EN: add exercise', () => is('add deadlift', { type: 'AddExercise', exerciseId: 'deadlift' }));
test('DA: tilføj roning', () => is('tilføj roning', { type: 'AddExercise', exerciseId: 'barbell-row' }));
test('EN: swap to incline dumbbell press ("to" is a word)', () => is('swap to incline dumbbell press', { type: 'SwapExercise', exerciseId: 'incline-dumbbell-press' }));
test('DA: skift til pull-ups', () => is('skift til pull-ups', { type: 'SwapExercise', exerciseId: 'pull-up' }));
test('bare exercise name jumps to it', () => is('overhead press', { type: 'AddExercise', exerciseId: 'overhead-press' }));
test('close matches ask with chips', () => {
  const r = is('raise', { type: 'Ask', reason: 'exercise' });
  assert.ok(r.choices.length >= 2);
});

// ---------- start / finish ----------

test('EN: start push day', () => is('start push day', { type: 'StartRoutine', routineId: 'push-day' }));
test('DA: start push dag', () => is('start push-dag', { type: 'StartRoutine', routineId: 'push-day' }));
test('EN/DA: start empty workout', () => { is('start a new workout', { type: 'StartEmpty' }); is('start en ny træning', { type: 'StartEmpty' }); });
test('EN: finish workout', () => { is('finish workout', { type: 'Finish' }); is("I'm done", { type: 'Finish' }); });
test('DA: afslut træningen', () => { is('afslut træningen', { type: 'Finish' }); is('jeg er færdig', { type: 'Finish' }); });
test('EN/DA: discard', () => { is('discard workout', { type: 'Discard' }); is('kassér træningen', { type: 'Discard' }); });
test('cancel and help', () => { is('never mind', { type: 'Cancel' }); is('annuller', { type: 'Cancel' }); is('help', { type: 'Help' }); });

// ---------- queries ----------

test('EN: what did I do last time?', () => is('What did I do last time?', { type: 'Query', what: 'last', exerciseId: null }));
test('EN: last time on squat', () => is('what did i do on squat last time', { type: 'Query', what: 'last', exerciseId: 'back-squat' }));
test('DA: hvad lavede jeg sidst', () => is('hvad lavede jeg sidst', { type: 'Query', what: 'last' }));
test('EN: what is my bench PR', () => is("what's my bench pr", { type: 'Query', what: 'pr' }));
test('EN: my PR on deadlift', () => is('my pr on deadlift', { type: 'Query', what: 'pr', exerciseId: 'deadlift' }));
test('DA: hvad er min rekord i dødløft', () => is('hvad er min rekord i dødløft', { type: 'Query', what: 'pr', exerciseId: 'deadlift' }));
test('EN: how many sets left', () => is('how many sets are left', { type: 'Query', what: 'setsLeft' }));
test('DA: hvor mange sæt er der tilbage', () => is('hvor mange sæt er der tilbage', { type: 'Query', what: 'setsLeft' }));
test('EN: how much rest is left', () => is('how much rest is left', { type: 'Query', what: 'restLeft' }));
test('DA: hvor lang pause er der tilbage', () => is('hvor lang pause er der tilbage', { type: 'Query', what: 'restLeft' }));

// ---------- unknown ----------

test('chatter is unknown, not guessed', () => {
  is('how is the weather', { type: 'Unknown' });
  is('should I deload next week', { type: 'Unknown' });
  is('', { type: 'Unknown' });
});

test('several sets at once: reps list with a weight', () => {
  const r = is('9, 8 and 8 reps at 100 kg', { type: 'LogSets' });
  assert.deepEqual(r.sets, [{ kg: 100, reps: 9 }, { kg: 100, reps: 8 }, { kg: 100, reps: 8 }]);
  const d = is('tre sæt 9 8 og 8 gentagelser med 100 kilo', { type: 'LogSets' });
  assert.deepEqual(d.sets.map(s => s.reps), [9, 8, 8]);
  assert.equal(d.sets[0].kg, 100);
  const bench = is('bench press 10 10 and 8 reps at 60', { type: 'LogSets', exerciseId: 'bench-press' });
  assert.equal(bench.sets.length, 3);
  const ctxKg = is('10, 9 and 8 reps', { type: 'LogSets' });
  assert.equal(ctxKg.sets[0].kg, 80, 'weight from the last set');
  is('3 sets 9 and 8 reps at 100', { type: 'Unknown' }, undefined);
});

// ---------- cardio, body, protein ----------
const noWorkout = { current: null, workoutExerciseIds: [] };
test('EN cardio: zone 2 bike, 5k with time, rowing meters', () => {
  is('30 minutes zone 2 on the bike', { type: 'LogCardio', cardioType: 'bike', durationSec: 1800, zone: 2 }, noWorkout);
  is('5k run in 24:30', { type: 'LogCardio', cardioType: 'run', durationSec: 1470, distanceKm: 5 }, noWorkout);
  is('I rowed 2000 meters in 8 minutes', { type: 'LogCardio', cardioType: 'row', durationSec: 480, distanceKm: 2 }, noWorkout);
  is('ran a half marathon 21.1 km in 1:52:30', { type: 'LogCardio', durationSec: 6750, distanceKm: 21.1 }, noWorkout);
  is('easy walk for an hour', { type: 'LogCardio', cardioType: 'walk', durationSec: 3600, zone: 2 }, noWorkout);
  is('3 miles run 27 minutes', { type: 'LogCardio', durationSec: 1620 }, noWorkout);
});
test('DA cardio: løb, cykling, motionscykel', () => {
  is('løb 5 km på 25 minutter', { type: 'LogCardio', cardioType: 'run', durationSec: 1500, distanceKm: 5, lang: 'da' }, noWorkout);
  is('halvanden time cykling', { type: 'LogCardio', cardioType: 'bike', durationSec: 5400 }, noWorkout);
  is('en time på motionscykel', { type: 'LogCardio', cardioType: 'spin', durationSec: 3600 }, noWorkout);
  is('svømning 1 km 30 min', { type: 'LogCardio', cardioType: 'swim', distanceKm: 1 }, noWorkout);
});
test('cardio start, missing time, and no clash with barbell row', () => {
  is('start a run', { type: 'StartCardio', cardioType: 'run' }, noWorkout);
  is('start løbetur', { type: 'StartCardio', cardioType: 'run' }, noWorkout);
  is('run 5 km', { type: 'Ask', reason: 'duration' }, noWorkout);
  is('barbell row 60 for 8', { type: 'LogSet', exerciseId: 'barbell-row', kg: 60 });
  is('row 60 kg 8 reps', { type: 'LogSet', exerciseId: 'barbell-row' });
});
test('bodyweight, protein and what to lift', () => {
  is('I weigh 82.5', { type: 'LogBodyweight', kg: 82.5 });
  is('jeg vejer 82,5 kilo', { type: 'LogBodyweight', kg: 82.5 });
  is('40 grams of protein', { type: 'LogProtein', grams: 40 });
  is('30 gram protein', { type: 'LogProtein', grams: 30 });
  is('what should I lift', { type: 'Query', what: 'suggest' });
  is('hvad skal jeg løfte', { type: 'Query', what: 'suggest' });
});

test('a long, natural sentence gives the gist', () => {
  const catalog = createCatalog();
  const r = parse('Just started my batch workout. I am on C bar row. I have 80 kilos on. I did 9 reps. Istit Sivarong.', { catalog, lang: 'en', routines: [] });
  assert.equal(r.type, 'LogSet');
  assert.deepEqual([r.kg, r.reps, r.exerciseId], [80, 9, 't-bar-row']);
  const s = parse('start my back workout', { catalog, lang: 'en', routines: [{ id: 'r1', name: 'Back day' }] });
  assert.deepEqual([s.type, s.routineId], ['StartRoutine', 'r1']);
  assert.equal(parse('Jeg er i gang med bænkpres. 60 kilo. Jeg lavede 8 gentagelser.', { catalog, lang: 'da' }).exerciseId, 'bench-press');
  assert.equal(parse('The weather is nice. See you soon.', { catalog, lang: 'en' }).type, 'Unknown', 'chat stays unknown');
});

test('past-tense lifts and "sets of <weight>"', () => {
  const catalog = createCatalog();
  const p = t => parse(t, { catalog, lang: 'en', routines: [] });
  const a = p('I benched 3 sets of 100 kilos for 8 reps.');
  assert.deepEqual([a.type, a.count, a.kg, a.reps, a.exerciseId], ['LogSet', 3, 100, 8, 'bench-press']);
  assert.equal(p('I squatted 140 for 5').exerciseId, 'back-squat');
  assert.equal(p('deadlifted 180 kilos for 3 reps').exerciseId, 'deadlift');
  assert.equal(p('rowing 20 minutes').type === 'LogSet', false, 'rowing stays cardio');
});
