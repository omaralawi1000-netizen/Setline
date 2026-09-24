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
