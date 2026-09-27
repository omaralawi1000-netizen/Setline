import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/parser.js';
import { createCatalog, wordScore } from '../js/catalog.js';
import { firstSentence } from '../js/tts.js';
import { VOICES, VOICE_FEEL } from '../js/settings.js';
import { translator } from '../js/i18n.js';

const catalog = createCatalog();
const ctx = { catalog, lang: 'auto', unit: 'kg', usage: {}, screen: 'workout', active: true,
  workoutExerciseIds: ['bench-press', 'incline-dumbbell-press', 'pec-deck', 'machine-preacher-curl', 'hammer-curl'],
  current: { exerciseId: 'hammer-curl', planned: { kg: 16, reps: 10 } } };
const p = s => parse(s, ctx);

test('a full gym: machines and cables are in the library', () => {
  for (const id of ['machine-preacher-curl', 'reverse-pec-deck', 'machine-shoulder-press', 'chest-supported-row', 'pendulum-squat', 'rope-pushdown', 'hip-thrust-machine', 'ab-crunch-machine'])
    assert.ok(catalog.get(id), id);
  assert.ok(catalog.all.length >= 140);
});

test('a named set goes on that exercise, even misheard', () => {
  assert.equal(p('machine preacher curl 68 kg 7 reps').exerciseId, 'machine-preacher-curl');
  assert.equal(p('Machine preacher kill 68 kilograms 7 reps').exerciseId, 'machine-preacher-curl', '"curl" heard as "kill"');
  assert.equal(p('preacher kill 73 kg 7 reps').exerciseId, 'machine-preacher-curl', 'the preacher curl in this workout');
  assert.equal(p('scottcurl i maskine 68 kilo 7 gentagelser').exerciseId, 'machine-preacher-curl');
  assert.equal(p('hammer girls 20 kg 10').exerciseId, 'hammer-curl');
  assert.equal(p('lateral rays 12 kg 15 reps').exerciseId, 'lateral-raise');
  assert.equal(p('incline dumbbell press 30 kg 8 reps').exerciseId, 'incline-dumbbell-press', 'never the incline bench press');
  assert.equal(p('tricep machine 50 kg 12 reps').exerciseId, 'triceps-extension-machine');
  const r = p('machine preacher curl 68 kg 7 reps');
  assert.deepEqual([r.type, r.kg, r.reps], ['LogSet', 68, 7]);
});

test('a name the library does not have is asked about, never guessed', () => {
  const r = p('zottman curl 15 kg 10');
  assert.equal(r.type, 'Ask');
  assert.equal(r.reason, 'newExercise');
  assert.equal(r.name, 'Zottman curl');
  assert.deepEqual(r.then, { type: 'LogSet', kg: 15, reps: 10, count: 1 });
});

test('no name: the exercise you are on, with the planned weight', () => {
  for (const s of ['next set was only nine reps', 'only 9 reps', 'sættet var kun 9 gentagelser']) {
    const r = p(s);
    assert.equal(r.type, 'LogSet', s);
    assert.equal(r.reps, 9, s);
    assert.equal(r.kg, 16, s);
    assert.ok(!r.exerciseId, s);
  }
  assert.equal(p('last set was 6').type, 'EditLast', 'a correction stays a correction');
});

test('word scores: the kit word costs a little, an unknown word rules a name out', () => {
  assert.equal(wordScore(['preacher', 'curl'], ['preacher', 'curl']), 100);
  assert.ok(wordScore(['preacher', 'curl'], ['machine', 'preacher', 'curl']) > 80);
  assert.equal(wordScore(['curl'], ['zottman', 'curl']), 0);
  assert.equal(wordScore(['machine', 'chest', 'press'], ['machine']), 0, 'a kit word alone picks nothing');
});

test('speaking starts from the first sentence', () => {
  assert.equal(firstSentence('Nice work today. Your bench moved up 2.5 kg.'), 'Nice work today.');
  assert.equal(firstSentence('Short'), null);
});

test('every voice has a feel in both languages', () => {
  assert.equal(VOICES.length, 30);
  for (const lang of ['en', 'da']) { const t = translator(lang); for (const v of VOICES) assert.notEqual(t('feel.' + VOICE_FEEL[v]), 'feel.' + VOICE_FEEL[v], `${lang} ${v}`); }
});
