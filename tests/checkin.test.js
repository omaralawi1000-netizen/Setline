import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/checkin.js';
import { createCatalog } from '../js/catalog.js';
import { starterRoutines, PROGRAMS } from '../js/routines.js';
import { parse } from '../js/parser.js';
import { resolve } from '../js/commands.js';
import { translator } from '../js/i18n.js';
import { validateBackup, BACKUP_KIND } from '../js/backup.js';

const cat = createCatalog();

test('speech → check-in (EN and DA)', () => {
  assert.deepEqual(C.parseCheckin('I slept 6 hours, legs are sore'), { sleepH: 6, addSore: ['legs'] });
  assert.deepEqual(C.parseCheckin('sov 7 timer og er øm i benene'), { sleepH: 7, addSore: ['legs'] });
  assert.deepEqual(C.parseCheckin('slept seven and a half hours'), { sleepH: 7.5 });
  assert.deepEqual(C.parseCheckin('energy 4'), { energy: 4 });
  assert.equal(C.parseCheckin('jeg føler mig træt').energy, 2);
  assert.deepEqual(C.parseCheckin('ondt i ryggen'), { addSore: ['back'] });
  assert.equal(C.parseCheckin('80 kilo 8 reps'), null);
  assert.equal(C.parseCheckin('bench press'), null);
});

test('merging answers through the morning', () => {
  let c = C.mergeCheckin(null, { sleepH: 6.3 }, '2026-09-24', 1);
  assert.equal(c.sleepH, 6.5);
  c = C.mergeCheckin(c, { addSore: ['legs', 'nope'] }, '2026-09-24', 2);
  c = C.mergeCheckin(c, { energy: 4, addSore: ['back'] }, '2026-09-24', 3);
  assert.deepEqual([c.sleepH, c.energy, c.sore], [6.5, 4, ['legs', 'back']]);
  assert.deepEqual(C.mergeCheckin(c, { sore: [] }, '2026-09-24').sore, []);
});

test('readiness: sleep, energy, and soreness where it matters today', () => {
  assert.equal(C.readiness({ sleepH: 8, energy: 5, sore: [] }).score, 5);
  assert.equal(C.readiness({ sleepH: 8, energy: 5, sore: [] }).advice, 'push');
  assert.equal(C.readiness({ sleepH: 4.5, energy: 2, sore: [] }).advice, 'easy');
  const legs = C.readiness({ sleepH: 7, energy: 4, sore: ['legs'] }, ['legs']);
  const push = C.readiness({ sleepH: 7, energy: 4, sore: ['legs'] }, ['chest', 'shoulders']);
  assert.deepEqual(legs.soreHit, ['legs']);
  assert.ok(legs.score <= push.score);
  assert.equal(C.readiness(null), null);
  assert.equal(C.readiness({ sleepH: null, energy: null, sore: [] }), null);
});

test('routine groups from primary muscles', () => {
  const legs = PROGRAMS.find(p => p.id === 'ppl').routines.find(r => r.key === 'legs');
  assert.deepEqual(C.routineGroups(legs, cat), ['legs']);
  assert.ok(C.routineGroups(starterRoutines()[0], cat).includes('chest'));
});

test('voice check-in resolves to a card with readiness', () => {
  const intent = parse('slept 5 hours and legs are sore', { lang: 'auto', unit: 'kg', catalog: cat, usage: {}, routines: [], workoutExerciseIds: [], current: null, restRunning: false });
  assert.equal(intent.type, 'CheckIn');
  const cmd = resolve(intent, { active: null, history: [], prs: [], routines: starterRoutines(), daily: [], undoCount: 0, settings: { unit: 'kg', restSec: 90, spoken: 'minimal' }, catalog: cat, now: Date.now() }, translator('en'), 'en');
  assert.equal(cmd.kind, 'auto');
  assert.match(cmd.value, /5 h sleep · legs sore/);
  assert.equal(cmd.run.op, 'checkin');
});

test('sleep trend and backups', () => {
  const list = [{ date: '2026-09-22', sleepH: 6, sore: [] }, { date: '2026-09-23', sleepH: 8, sore: [] }, { date: '2026-09-24', energy: 3, sore: [] }];
  assert.deepEqual(C.sleepTrend(list), { avg: 7, series: [{ date: '2026-09-22', v: 6 }, { date: '2026-09-23', v: 8 }] });
  const b = { kind: BACKUP_KIND, version: 1, data: { daily: list, measures: [{ date: '2026-09-24', waist: 82 }] } };
  assert.equal(validateBackup(b).ok, true);
  assert.equal(validateBackup({ ...b, data: { daily: [{ date: 'x', sore: [] }] } }).ok, false);
});
