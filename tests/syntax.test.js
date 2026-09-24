import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Every module parses: DOM modules can't be imported under Node, but a syntax slip would stop the app booting.
const files = ['js', 'js/ui'].flatMap(d => readdirSync(new URL(`../${d}/`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`));

test('every module parses', () => {
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', new URL(`../${f}`, import.meta.url).pathname], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f}: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
  }
  assert.ok(files.length > 40);
});
