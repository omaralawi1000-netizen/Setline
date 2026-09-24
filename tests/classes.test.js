import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// A state class toggled onto an element ("msg ai live") must not also be a component class with
// its own rule (".live{…}"), or the element silently picks up that component's look.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = (read('css/app.css') + read('css/tokens.css')).replace(/\/\*[\s\S]*?\*\//g, '');
const standalone = new Set();
for (const [, sel] of css.matchAll(/([^{}]+)\{/g)) {
  for (const part of sel.split(',')) for (const comp of part.trim().split(/[\s>+~]+/)) {
    const m = /^\.([a-zA-Z][\w-]*)/.exec(comp);
    if (m) standalone.add(m[1]);
  }
}
const js = ['js', 'js/ui'].flatMap(d => readdirSync(new URL(`../${d}/`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => [`${d}/${f}`, read(`${d}/${f}`)]));
const ALLOWED = new Set(['pulse', 'slide-l', 'slide-r', 'js-press']); // standalone effect classes, meant to be added anywhere

test('state classes never collide with component classes', () => {
  const bad = [];
  for (const [f, src] of js) {
    for (const [, val] of src.matchAll(/class="([^"]*)"/g)) {
      for (const [, tok] of val.matchAll(/'\s*([a-zA-Z][\w-]*)'/g)) if (standalone.has(tok) && !ALLOWED.has(tok)) bad.push(`${f}: ${tok}`);
    }
    for (const [, args] of src.matchAll(/classList\.(?:add|toggle)\(([^)]*)\)/g)) {
      for (const [, tok] of args.matchAll(/'([a-zA-Z][\w-]*)'/g)) if (standalone.has(tok) && !ALLOWED.has(tok)) bad.push(`${f}: ${tok}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('suggestion reasons and coach states are not component classes', () => {
  for (const c of ['up', 'repeat', 'deload', 'reps', 'easy', 'is-streaming', 'is-err', 'stopped', 'fix', 'over', 'behind', 'full']) assert.ok(!standalone.has(c), c);
});
