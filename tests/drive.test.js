import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/drive.js';

test('client ids are recognised', () => {
  assert.ok(D.validClientId('1234567890-abc123def456.apps.googleusercontent.com'));
  assert.ok(!D.validClientId('AIzaSyXXXX'));
  assert.ok(!D.validClientId(''));
});

test('file names carry the date; only the newest 14 are kept', () => {
  assert.equal(D.fileName('2026-09-24'), 'setline-2026-09-24.json');
  assert.equal(D.dateOfFile('setline-2026-09-24.json'), '2026-09-24');
  assert.equal(D.dateOfFile('other.json'), null);
  const files = Array.from({ length: 20 }, (_, i) => ({ id: 'f' + i, name: D.fileName(`2026-09-${String(i + 1).padStart(2, '0')}`) }));
  files.push({ id: 'x', name: 'notes.txt' });
  const gone = D.toPrune(files);
  assert.equal(gone.length, 6);
  assert.deepEqual(gone.map(f => f.id).sort(), ['f0', 'f1', 'f2', 'f3', 'f4', 'f5']);
});

test('backup is due once a day, never twice in an hour', () => {
  const now = Date.parse('2026-09-24T18:00:00');
  assert.equal(D.backupDue(null, now, '2026-09-24'), true);
  assert.equal(D.backupDue({ at: now - 2 * 3600_000, date: '2026-09-24' }, now, '2026-09-24'), false);
  assert.equal(D.backupDue({ at: now - 20 * 3600_000, date: '2026-09-23' }, now, '2026-09-24'), true);
  assert.equal(D.backupDue({ at: now - 600_000, date: '2026-09-23' }, now, '2026-09-24'), false);
});

test('multipart body has metadata then content', () => {
  const m = D.multipart({ name: 'a.json', parents: ['appDataFolder'] }, '{"x":1}', 'B');
  assert.equal(m.type, 'multipart/related; boundary=B');
  assert.match(m.body, /--B\r\nContent-Type: application\/json; charset=UTF-8\r\n\r\n\{"name":"a.json","parents":\["appDataFolder"\]\}\r\n--B\r\nContent-Type: application\/json\r\n\r\n\{"x":1\}\r\n--B--/);
});
