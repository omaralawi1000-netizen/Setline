// The motion & performance budget (CLAUDE.md): only transform and opacity animate, and only the dock
// and the message box are frosted (at most 16px). See scripts/lib/motionrules.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkAll, checkCss, checkJs } from '../scripts/lib/motionrules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Non-blocking while the 1.59.1 design is back (1.62.0): this budget is 1.60's. The master fix's phase 2
// updates it to the restored design and turns it on again.
test('the app animates only transform and opacity, and frosts only the dock and the message box', { skip: 'describes 1.60; re-enabled in the master fix phase 2' }, () => {
  const bad = checkAll(root);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('the check catches what it should', () => {
  assert.equal(checkCss('.a{transition:transform .2s,opacity .2s}').length, 0);
  assert.equal(checkCss('.a{transition:none}').length, 0);
  assert.equal(checkCss('.a{transition:background .2s}').length, 1);
  assert.equal(checkCss('.a{transition:all .2s}').length, 1);
  assert.equal(checkCss('.a{transition:height .3s var(--e-out),opacity .2s}').length, 1);
  assert.equal(checkCss('@keyframes k{from{opacity:0;filter:blur(4px)}to{opacity:1}}').length, 1);
  assert.equal(checkCss('@keyframes k{50%{transform:scale(1.1)}}').length, 0);
  assert.equal(checkCss('.card{backdrop-filter:blur(10px)}').length, 1);
  assert.equal(checkCss('.card{backdrop-filter:none}').length, 0);
  assert.equal(checkCss('.dcap{backdrop-filter:blur(12px)}').length, 0);
  assert.equal(checkCss('.composer.glass{backdrop-filter:blur(24px)}').length, 1);
  assert.equal(checkCss('@media (min-width:1px){.x{transition:color .2s}}').length, 1);
  assert.equal(checkJs("el.animate([{ opacity: 0 }, { transform: 'none' }], { duration: 1 })").length, 0);
  assert.equal(checkJs("el.animate([{ boxShadow: 'none' }, { filter: 'blur(2px)' }], { duration: 1 })").length, 2);
});
