// The one command that proves a change didn't break Setline's logic:
//   npm run verify
// 1. no secrets in any file git would commit   2. release bookkeeping is consistent
// 3. every unit test passes (node --test)
// Fast and browser-free, so it also runs in CI. Browser checks are npm run golden / visual / motion.
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

let failed = 0;
const fail = msg => { failed++; console.error('  ✗ ' + msg); };
const ok = msg => console.log('  ✓ ' + msg);
const sh = cmd => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// 1. secrets: real key shapes only (Groq, Google, GitHub, OpenAI, Anthropic, private keys)
const SECRET = [
  [/gsk_[A-Za-z0-9]{20,}/, 'Groq key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/sk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/, 'OpenAI/Anthropic key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/ya29\.[0-9A-Za-z_-]{20,}/, 'Google OAuth access token']
];
const files = [...new Set([
  ...sh('git ls-files').split('\n'),
  ...sh('git ls-files --others --exclude-standard').split('\n')
])].filter(f => f && existsSync(f) && statSync(f).size < 5e6 && !/\.(png|jpg|jpeg|webp|ico|woff2?)$/i.test(f));
let hits = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [re, what] of SECRET) {
    const m = text.match(re);
    if (m) { hits++; fail(`${what} in ${f} (starts ${m[0].slice(0, 6)}…). Remove it and rotate the key.`); }
  }
}
if (!hits) ok(`no secrets in ${files.length} files`);

// 2. release bookkeeping
const version = readFileSync('js/version.js', 'utf8').match(/VERSION = '([^']+)'/)?.[1];
const swVersion = readFileSync('sw.js', 'utf8').match(/const VERSION = '([^']+)'/)?.[1];
if (!version || version !== swVersion) fail(`js/version.js (${version}) and sw.js (${swVersion}) disagree`);
else ok(`version ${version} in js/version.js and sw.js`);
const esc = version.replace(/\./g, '\\.');
if (!new RegExp(`^## ${esc}\\b`, 'm').test(readFileSync('docs/HISTORY.md', 'utf8'))) fail(`docs/HISTORY.md has no "## ${version}" entry`);
else ok(`docs/HISTORY.md has the ${version} entry`);
if (!readFileSync('PLAN.md', 'utf8').includes(version)) fail(`PLAN.md doesn't mention the current version ${version}`);
else ok('PLAN.md names the current version');

// 3. unit tests
console.log('  … unit tests (node --test)');
const t = spawnSync(process.execPath, ['--test', '--test-reporter=dot'], { stdio: 'inherit' });
if (t.status !== 0) fail('unit tests failed');
else ok('unit tests pass');

if (failed) { console.error(`verify: ${failed} problem(s)`); process.exit(1); }
console.log('verify: all good');
