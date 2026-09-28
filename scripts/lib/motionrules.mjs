// Motion & performance rules, checked (see CLAUDE.md). Run by tests/motion-rules.test.js and by
//   node scripts/lib/motionrules.mjs          (prints every violation)
// 1. CSS transitions and @keyframes animate only transform (incl. translate/scale/rotate), opacity, filter and clip-path.
// 2. (backdrop-filter rule removed by Omar's decision: blur is allowed anywhere.)
// 3. Element.animate() keyframes in the app's JS animate only transform/opacity/filter/clip-path.
// (`visibility` is allowed in keyframes: it switches, it isn't interpolated or repainted per frame.)
// The one exception: small SVG progress rings and check marks draw their stroke (stroke-dashoffset on
// `.fg` and the draw keyframes below), and the exercise figures morph their SVG path (`d`, figure.js).
// They're small, off the voice and chat paths, and turning them into transforms would mean rebuilding
// working components.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set(['transform', 'opacity', 'filter', 'clip-path', 'translate', 'scale', 'rotate', 'visibility', 'animation-timing-function', 'none']);
const SVG_KF = new Set(['draw', 'drawline', 'ckdraw', 'ringfill', 'dringdraw']);
const JS_OK = { 'js/ui/figure.js': new Set(['d']), 'js/ui/workout.js': new Set(['stroke-dashoffset']) };
export const GLASS = /(^|[\s,>])(\.dcap|\.obub|\.composer|#composer)\b/;

// a small CSS walker: yields {selector, body, at} for every rule, and {keyframes, name, body}
function* rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const stack = [];
  let start = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const head = css.slice(start, i).trim();
      if (/^@(-webkit-)?keyframes/.test(head)) {
        // take the whole block
        let depth = 1, j = i + 1;
        while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
        yield { keyframes: true, name: head.split(/\s+/)[1], body: css.slice(i + 1, j - 1) };
        i = j; start = j; continue;
      }
      if (head.startsWith('@')) { stack.push(head); i++; start = i; continue; }
      let j = i + 1;
      while (j < css.length && css[j] !== '}') j++;
      yield { selector: head, body: css.slice(i + 1, j), at: stack.join(' ') };
      i = j + 1; start = i; continue;
    }
    if (c === '}') { stack.pop(); i++; start = i; continue; }
    i++;
  }
}
const decls = body => body.split(';').map(d => d.trim()).filter(Boolean).map(d => { const k = d.indexOf(':'); return [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]; });
const splitTop = s => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()).filter(Boolean); };
const TIME = /^-?[\d.]+m?s$|^var\(|^calc\(/;
const EASE = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier\(|steps\(|var\()/;
function transitionProps(value) {
  if (/^none\b/.test(value)) return [];
  return splitTop(value).map(part => part.split(/\s+(?![^(]*\))/).find(t => t && !TIME.test(t) && !EASE.test(t)) || 'all');
}

export function checkCss(css, file = 'css') {
  const bad = [];
  for (const r of rules(css)) {
    if (r.keyframes) {
      for (const block of r.body.split('}')) {
        const k = block.indexOf('{');
        if (k < 0) continue;
        for (const [p] of decls(block.slice(k + 1))) if (p && !ALLOWED.has(p) && !(p === 'stroke-dashoffset' && SVG_KF.has(r.name))) bad.push(`${file}: @keyframes ${r.name} animates ${p}`);
      }
      continue;
    }
    for (const [p, v] of decls(r.body)) {
      if (p === 'transition' || p === 'transition-property') {
        for (const t of transitionProps(v)) if (!ALLOWED.has(t) && !(t === 'stroke-dashoffset' && r.selector.includes('.fg'))) bad.push(`${file}: ${r.selector} transitions ${t}`);
      }
    }
  }
  return bad;
}

// Element.animate([...]) keyframes in JS: the property names used in the first argument
export function checkJs(src, file = 'js') {
  const bad = [];
  let at = 0;
  while ((at = src.indexOf('.animate(', at)) >= 0) {
    let i = at + 9;
    while (/\s/.test(src[i])) i++;
    if (src[i] !== '[') { at = i; continue; }
    let depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === '[') depth++; else if (src[j] === ']') { depth--; if (!depth) break; } }
    const frames = src.slice(i, j + 1);
    for (const m of frames.matchAll(/([a-zA-Z]+)\s*:/g)) {
      const k = m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase());
      if (!ALLOWED.has(k) && k !== 'offset' && k !== 'easing' && k !== 'composite' && !JS_OK[file]?.has(k)) bad.push(`${file}: .animate() keyframes use ${m[1]}`);
    }
    at = j;
  }
  return bad;
}

export function checkAll(root) {
  const bad = [];
  for (const f of ['css/tokens.css', 'css/app.css']) bad.push(...checkCss(readFileSync(join(root, f), 'utf8'), f));
  const walk = d => readdirSync(join(root, d)).flatMap(n => { const p = join(d, n); return statSync(join(root, p)).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
  for (const f of walk('js')) bad.push(...checkJs(readFileSync(join(root, f), 'utf8'), f));
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = checkAll(process.cwd());
  for (const b of bad) console.log(b);
  console.log(`\n${bad.length} violation(s)`);
}
