// Risk check: reads what changed and says the minimum task class and which checks are required.
// Deterministic on purpose: the agent may raise the class, never lower it.
//   npm run risk                     changes on this branch + uncommitted work, against main
//   npm run risk -- --base HEAD~1    against any commit
//   npm run risk -- --ci             also writes the result to the GitHub Actions summary
// Classes (see AGENTS.md): A tiny · B local · C feature · D sensitive · E structural
import { execSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const CI = argv.includes('--ci');
const sh = cmd => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).trim(); } catch { return ''; } };
const baseArg = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;
function findBase() {
  for (const ref of ['origin/main', 'main']) {
    if (sh(`git rev-parse --verify --quiet ${ref}`)) { const mb = sh(`git merge-base HEAD ${ref}`); if (mb) return mb; }
  }
  return 'HEAD';
}
const base = baseArg || findBase();

// ---- what changed ----
const lines = s => s.split('\n').filter(Boolean);
const tracked = lines(sh(`git diff --name-only ${base}`));
const untracked = lines(sh('git ls-files --others --exclude-standard'));
const files = [...new Set([...tracked, ...untracked])].filter(f => !f.startsWith('visual/') && !f.startsWith('screenshots/'));
// added lines per file; tests, scripts and docs don't count as app code
const addedBy = new Map();
let cur = null;
for (const l of sh(`git diff -U0 ${base}`).split('\n')) {
  if (l.startsWith('+++ ')) { cur = l.startsWith('+++ b/') ? l.slice(6) : null; continue; }
  if (cur && l.startsWith('+')) (addedBy.get(cur) || addedBy.set(cur, []).get(cur)).push(l.slice(1));
}
for (const f of untracked) if (/\.(js|mjs|css|html|json|webmanifest)$/.test(f) && existsSync(f)) addedBy.set(f, readFileSync(f, 'utf8').split('\n'));
const isApp = f => !/^(tests|scripts|docs|\.claude)\//.test(f) && !/\.md$/.test(f);
const added = [...addedBy].filter(([f]) => isApp(f)).flatMap(([, ls]) => ls);
const addedCode = added.join('\n');

// ---- the rules (paths are Setline's real files) ----
const SECURITY_FILES = [
  [/^js\/keys\.js$|^js\/endpoint\.js$/, 'API keys / provider endpoints'],
  [/^js\/(ui\/)?drive\.js$/, 'Google Drive / OAuth'],
  [/^js\/backup\.js$/, 'backup / import validation'],
  [/^js\/(appedit|planedit)\.js$|^js\/ui\/coach\.js$|^js\/coach\.js$/, 'Coach actions (CHANGE / ACTION / REMEMBER)'],
  [/^js\/(ai|stt|tts)\.js$/, 'data sent to Groq / Gemini'],
  [/^js\/db\.js$|^js\/store\.js$/, 'storage schema / migrations'],
  [/^js\/ui\/report\.js$/, 'bug reports leaving the phone'],
  [/^package(-lock)?\.json$/, 'dependencies (supply chain)'],
  [/^\.github\/workflows\//, 'CI permissions']
];
const SECURITY_CODE = [
  [/\beval\(|new Function\(|document\.write/, 'code built from strings'],
  [/setKey\(|clearKeys\(|Authorization|Bearer |x-goog-api-key|[?&]key=/i, 'credential handling'],
  [/indexedDB\.open|createObjectStore|onupgradeneeded|SCHEMA_VERSION|deleteDatabase/, 'stored data / schema'],
  [/CHANGE:|ACTION:|REMEMBER:|SETTABLE|PAGES\b/, 'what the Coach is allowed to do'],
  [/api\.groq\.com|generativelanguage\.googleapis|googleapis\.com\/(drive|upload)|api\.github\.com/, 'a request leaving the phone']
];
const DEVICE_FILES = /^sw\.js$|^manifest\.webmanifest$|^js\/(audio|voice|stt|tts|vad|wakelock|haptics|tap-worklet)\.js$|^js\/ui\/(voice|listen|handsfree|scan)\.js$/;
const DEVICE_CODE = /getUserMedia|MediaRecorder|AudioContext|audioWorklet|speechSynthesis|serviceWorker|skipWaiting|clients\.claim|caches\.|wakeLock|navigator\.vibrate|showNotification|BarcodeDetector/;
const MOTION_CODE = /@keyframes|animation\s*:|transition\s*:|\.animate\(|startViewTransition|--m-|--e-|requestAnimationFrame/;
const UI_FILES = /^css\/|^index\.html$|^js\/ui\/|^icons\//;
const RELEASE_FILES = /^sw\.js$|^js\/version\.js$/;

const reasons = { security: new Set(), device: new Set() };
const XSS = /\binnerHTML\b|outerHTML|insertAdjacentHTML/;
const xss = [...addedBy].filter(([f]) => isApp(f) && ls(addedBy.get(f))).map(([f]) => f);
function ls(lines) { return lines.some(l => XSS.test(l) || /\$\{(?!\s*(esc|t|I|icon)\b)/.test(l) && /<\w/.test(l)); }
for (const f of files) {
  for (const [re, why] of SECURITY_FILES) if (re.test(f)) reasons.security.add(`${why} — ${f}`);
  if (DEVICE_FILES.test(f)) reasons.device.add(`phone-only behaviour — ${f}`);
}
for (const [re, why] of SECURITY_CODE) if (re.test(addedCode)) reasons.security.add(`${why} — in added lines`);
if (DEVICE_CODE.test(addedCode)) reasons.device.add('mic / audio / service worker / sensors — in added lines');

const code = files.filter(f => /\.(js|mjs|css|html)$/.test(f) && isApp(f));
const ui = files.some(f => UI_FILES.test(f));
const motion = MOTION_CODE.test(addedCode);
const release = files.some(f => RELEASE_FILES.test(f));
const onlyDocs = files.length > 0 && files.every(f => /\.md$/.test(f));

let cls = 'A', why = 'tiny or docs-only';
if (code.length) { cls = 'B'; why = 'app code changed'; }
if (code.length >= 4 || added.length > 150) { cls = 'C'; why = `${code.length} app files / ${added.length} added lines`; }
if (reasons.security.size) { cls = 'D'; why = 'touches a security boundary'; }
if (code.length >= 12 || (files.includes('js/db.js') && /SCHEMA_VERSION|onupgradeneeded/.test((addedBy.get('js/db.js') || []).join('\n')))) { cls = 'E'; why = code.length >= 12 ? `${code.length} app files: structural` : 'storage schema change'; }

const gates = [];
if (!onlyDocs && files.length) gates.push(['npm run verify', 'always']);
if (cls >= 'C' || reasons.device.size || release) gates.push(['npm run golden', 'user journeys']);
if (ui) gates.push(['npm run visual', 'UI files changed: explain every CHANGED picture']);
if (xss.length) gates.push(['XSS check', `new HTML in ${xss.join(', ')}: every \${…} is esc()'d, a number, or a fixed i18n/icon string`]);
if (motion) gates.push(['npm run motion', 'motion changed: compare with motion/previous/']);
if (reasons.security.size) gates.push(['security gate', 'docs/SECURITY_MODEL.md checklist, written in the report']);
if (reasons.device.size) gates.push(['device check', 'docs/DEVICE_CHECKLIST.md on Omar\'s phone before calling it known-good']);
if (release) gates.push(['release', 'js/version.js = sw.js VERSION, PLAN.md, docs/HISTORY.md']);

// ---- report ----
const out = [];
out.push(`Setline risk check (base ${base === 'HEAD' ? 'HEAD' : base.slice(0, 8)}, ${files.length} files changed)`);
if (!files.length) out.push('Nothing changed.');
else {
  out.push(`Minimum class: ${cls} (${why}). Raise it if you know more; never lower it.`);
  out.push('Required:');
  for (const [g, w] of gates) out.push(`  - ${g}  (${w})`);
  for (const [k, set] of Object.entries(reasons)) if (set.size) { out.push(`Why ${k}:`); for (const r of set) out.push(`  - ${r}`); }
}
console.log(out.join('\n'));
if (CI && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Risk check\n```\n' + out.join('\n') + '\n```\n');
