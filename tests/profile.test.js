import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/profile.js';
import { sanitize } from '../js/settings.js';
import { isPlanRequest } from '../js/coach.js';

const now = Date.parse('2026-09-24T12:00:00Z');
const me = { name: '  Omar ', birthYear: 2001, sex: 'male', heightCm: 181, level: 'some', goal: 'muscle', days: 4, minutes: 60, equipment: 'gym', injuries: ['shoulder', 'bogus'], cardio: 'some' };

test('profile is tidied and kept in settings', () => {
  const p = P.sanitizeProfile(me, now);
  assert.equal(p.name, 'Omar');
  assert.deepEqual(p.injuries, ['shoulder']);
  assert.equal(P.ageOf(p, now), 25);
  assert.equal(P.sanitizeProfile({ heightCm: 400, days: 9, minutes: 50 }, now).heightCm, null);
  assert.equal(sanitize({ profile: me }).profile.goal, 'muscle');
  assert.equal(sanitize({}).profile, null);
});

test('answers set the weekly goal, protein and cardio', () => {
  assert.deepEqual(P.derivedSettings(P.sanitizeProfile(me, now)), { weeklyGoal: 4, proteinPerKg: 1.8, cardioGoal: 150 });
  assert.equal(P.derivedSettings({ goal: 'fatloss' }).proteinPerKg, 2.2);
});

test('a program without a key, a plan request with one', () => {
  assert.equal(P.programFor({ days: 4 }), 'ul');
  assert.equal(P.programFor({ days: 6 }), 'ppl');
  assert.equal(P.programFor({ days: 2 }), 'fb3');
  const q = P.planRequest(P.sanitizeProfile(me, now));
  assert.ok(isPlanRequest(q), q);
  assert.ok(isPlanRequest(P.planRequest(P.sanitizeProfile(me, now), 'da')));
  assert.match(P.profileText(P.sanitizeProfile(me, now), now), /25 years old.*build muscle.*4 days/);
  assert.equal(P.profileText(null), 'PROFILE: not filled in.');
});

import { mergeHeard, PROFILE_SCHEMA } from '../js/profile.js';
test('what you said fills the questions it answers, and only those', () => {
  const a = { name: '', age: 25, sex: null, height: 178, weight: 80, level: null, goal: null, days: null, minutes: null, equipment: null, injuries: [], cardio: null };
  const got = mergeHeard(a, { name: 'Omar', age: 27, heightCm: 183, weightKg: 84.3, goal: 'muscle', days: 5, minutes: 70, equipment: 'gym', injuries: ['knee', 'nope'], sex: null, level: 'bogus', notes: 'Loves deadlifts, plays football on Sundays.' });
  assert.deepEqual([...got].sort(), ['age', 'days', 'equipment', 'goal', 'height', 'injuries', 'minutes', 'name', 'notes', 'weight']);
  assert.equal(a.minutes, 75, 'rounded to an offered length');
  assert.equal(a.weight, 84.5);
  assert.deepEqual(a.injuries, ['knee']);
  assert.equal(a.level, null, 'unknown values are ignored');
  assert.match(a.notes, /football/);
  assert.equal(mergeHeard(a, null).size, 0);
  assert.ok(PROFILE_SCHEMA.properties.goal.enum.includes('fatloss'));
});

import { missingTopics, interviewPrompt, INTERVIEW_SCHEMA, firstQuestion } from '../js/profile.js';
test('the interview asks only for what is still missing', () => {
  const a = { name: '', age: 25, height: 178, weight: 80, level: null, goal: null, days: null, minutes: null, equipment: null, injuries: [], cardio: null, asked: {} };
  assert.equal(missingTopics(a)[0], 'their name');
  mergeHeard(a, { name: 'Omar', goal: 'muscle', days: 5, level: 'some', injuries: [] });
  const m = missingTopics(a);
  assert.ok(!m.includes('their name') && !m.includes('their main goal') && m.includes('how long a session can be'));
  const p = interviewPrompt(a, [{ who: 'ai', text: firstQuestion('en') }, { who: 'me', text: 'Omar, muscle' }]);
  assert.match(p, /KNOWN SO FAR: .*"name":"Omar"/);
  assert.match(p, /"age":null/, 'the default age is not passed off as an answer');
  assert.match(p, /USER: Omar, muscle/);
  assert.ok(INTERVIEW_SCHEMA.required.includes('reply') && INTERVIEW_SCHEMA.properties.goal.enum);
});
