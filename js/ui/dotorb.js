// The Orb, drawn as a sphere of lit dots turning slowly in 3D (in the spirit of the dotted
// thinking-orbs from Libraries.dev). Dots near you are bigger and brighter, the far side fades, and
// the theme's colours run across it. It breathes when idle, swells and ripples with your voice while
// listening, a bright meridian sweeps it while it thinks, and it pulses with the Coach's voice.
//
// Every `.orb` in the app becomes one of these on its own (a watcher mounts a canvas in each one as
// it appears, the flying stand-ins included). They all turn together, on one clock and one spin, so
// whenever one orb hands over to another (the dock's to the voice screen's, the dock's to the message
// box's) the two are in exactly the same pose, and handOrb() passes on how swollen or lit it is:
// nothing jumps. One animation frame paints every orb; an orb at rest is painted at half rate (it
// turns too slowly for more to show) and one that's hidden only now and then, to stay in step.
//
//   setOrb(orbEl, { state: 'listening' | 'thinking' | 'speaking' | 'idle', level, bands: [lo, mid, hi] })

import { onFrame } from './frame.js';
import { bands8 } from '../voice.js';

const TAU = Math.PI * 2;
const RM = matchMedia('(prefers-reduced-motion: reduce)'); // (a live query: asked every frame, made once)
const still = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && RM.matches);

// ---------- colours: the theme's accent, blue and violet ----------
function rgbOf(cs, name, fallback) {
  const v = cs.getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1], n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
  return r ? [+r[1], +r[2], +r[3]] : fallback;
}
let pal = null;
function palette() {
  if (pal) return pal;
  const cs = getComputedStyle(document.documentElement);
  pal = { a: rgbOf(cs, '--accent-hi', [120, 240, 220]), b: rgbOf(cs, '--blue', [90, 140, 255]), v: rgbOf(cs, '--violet', [160, 120, 255]) };
  return pal;
}
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// evenly spread points on a sphere (a Fibonacci lattice), each with a fixed random phase
const lattices = new Map();
function lattice(n) {
  if (lattices.has(n)) return lattices.get(n);
  const g = Math.PI * (3 - Math.sqrt(5)), pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * g;
    const h = Math.sin(i * 12.9898) * 43758.5453;
    const ph = (h - Math.floor(h)) * TAU;
    pts.push({ x: r * Math.cos(a), y, z: r * Math.sin(a), lon: Math.atan2(Math.sin(a), Math.cos(a)), ph, ph2: ph * 1.7, lowW: 1 - Math.abs(y), highW: Math.abs(y), band: 2 + (((h - Math.floor(h)) * 97) | 0) % 4 });
  }
  lattices.set(n, pts);
  return pts;
}

// ---------- the orbs ----------
const orbs = new Set();
const byEl = new WeakMap();
const G = { extra: 0, busy: 0 }; // the spin every orb shares on top of the clock's, and how busy the busiest is
const follow = (x, to, dt, up, down) => x + (to - x) * (1 - Math.exp(-dt / (to > x ? up : down)));

function mount(orb) {
  if (byEl.has(orb)) return byEl.get(orb);
  for (const o of orbs) if (!o.orb.isConnected) { orbs.delete(o); io?.unobserve(o.canvas); byEl.delete(o.orb); } // redrawn away
  for (const c of orb.querySelectorAll(':scope > canvas.dots')) c.remove(); // a copy's blank canvas
  const size = parseFloat(orb.style.getPropertyValue('--s')) || parseFloat(getComputedStyle(orb).getPropertyValue('--s')) || orb.offsetWidth || 60;
  const box = Math.round(size * 1.3); // room to swell past the orb's own edge
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.className = 'dots';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = canvas.height = Math.round(box * dpr);
  const off = (box - size) / 2;
  Object.assign(canvas.style, { width: `${box}px`, height: `${box}px`, left: `${-off}px`, top: `${-off}px` });
  orb.prepend(canvas);
  orb.classList.add('dotted');
  const n = Math.round(Math.min(size > 150 ? 340 : 280, Math.max(56, size * size * 0.034)));
  const o = {
    orb, canvas, ctx: canvas.getContext('2d'), size, box, dpr, pts: lattice(n),
    xs: new Float32Array(n), ys: new Float32Array(n), rs: new Float32Array(n), bk: Array.from({ length: DB * VB * SB }, () => []),
    want: null, // set from outside (the voice screen); otherwise worked out from where the orb sits
    s: { level: 0, bands: [0, 0, 0], listen: 0, think: 0, speak: 0, e8: new Float32Array(8) },
    auto: { state: 'idle', level: 0, bands: [0, 0, 0], b8: null }, // (filled in place each frame: nothing is allocated per frame)
    seen: true, at: 0
  };
  orbs.add(o);
  byEl.set(orb, o);
  io?.observe(canvas);
  paint(o, performance.now());
  wake();
  return o;
}

// What an orb is doing, from where it lives, when nobody tells it (the message box, the dock, the interview).
const IDLE = { state: 'idle', level: 0 };
const put = (o, state, level, bands = null, b8 = null) => { const w = o.auto; w.state = state; w.level = level; w.b8 = b8; if (bands) { w.bands[0] = bands[0]; w.bands[1] = bands[1]; w.bands[2] = bands[2]; } else w.bands[0] = w.bands[1] = w.bands[2] = 0; return w; };
const TALKB = [0.6, 0.5, 0.4];
// while the Coach speaks, its voice's level spread over the eight bands (the clip is read ahead of
// time as one envelope): each band on its own slow beat, so the surface moves like a voice, not a pulse
const speak8 = new Float32Array(8);
function speakBands(level, T) { for (let b = 0; b < 8; b++) speak8[b] = level * (0.55 + 0.45 * Math.sin(T * (2.3 + b * 0.9) + b * 1.7)) * (b < 2 ? 0.8 : b > 5 ? 0.7 : 1); return speak8; }
function autoState(o) {
  const app = document.getElementById('app');
  const box = o.orb.closest('#composer');
  if (box) {
    if (app?.classList.contains('thinking')) return put(o, 'thinking', 0);
    if (box.classList.contains('speaking')) { const l = Math.min(1, (+box.style.getPropertyValue('--sv') || 0) * 1.3); return put(o, 'speaking', l, null, speakBands(l, performance.now() / 1000)); }
    const talk = box.dataset.talk;
    if (talk === 'listening' || talk === 'hearing') return put(o, 'listening', Math.min(1, (+(o.orb.closest('.corb')?.style.getPropertyValue('--lv')) || 0) * 1.8), TALKB, mic8());
    if (talk === 'thinking') return put(o, 'thinking', 0);
    return IDLE;
  }
  const iv = o.orb.closest('.iv');
  if (iv) {
    const p = iv.dataset.phase;
    if (p === 'listening' || p === 'wait') return put(o, 'listening', 0.35, null, mic8());
    if (p === 'thinking' || p === 'hearing') return put(o, 'thinking', 0);
    if (p === 'speaking') return put(o, 'speaking', 0.4, null, speakBands(0.4, performance.now() / 1000));
    return IDLE;
  }
  if (o.orb.closest('#dock') && app?.classList.contains('speaking')) return put(o, 'speaking', 0.4, null, speakBands(0.4, performance.now() / 1000));
  return IDLE;
}
// the microphone's eight bands, read at most once a frame for every orb that listens
let micRead = -1;
const micB8 = new Float32Array(8);
function mic8() { if (micRead !== tick) { micRead = tick; if (!bands8(micB8) && ORBTEST) orbTestBands(micB8, performance.now() / 1000); } return micB8; }

// ?orbtest=1: a voice sample drives every orb (syllables about four a second, a vowel's lows and
// middle with the consonants' highs between them), for checking the motion without a microphone
const ORBTEST = /[?&]orbtest=1\b/.test(location.search);
function orbTestBands(out, T) {
  const syl = Math.max(0, Math.sin(T * TAU * 3.7)) ** 0.7 * (0.55 + 0.45 * Math.sin(T * 1.3) ** 2);
  const cons = Math.max(0, Math.sin(T * TAU * 3.7 + 2.2)) ** 6;
  for (let b = 0; b < 8; b++) out[b] = Math.min(1, b < 3 ? syl * (0.9 - b * 0.1) : b < 6 ? syl * (0.75 - (b - 3) * 0.12) * (0.7 + 0.3 * Math.sin(T * 5 + b)) : cons * 0.9);
  return out;
}
const TEST = { state: 'listening', level: 0, bands: [0, 0, 0], b8: new Float32Array(8) };

// Smooth 3D value noise, -1..1 (a hashed lattice, trilinear with smoothstep): the field the dots
// ripple in drifts through it, so the surface moves like liquid instead of pulsing as a whole.
const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) & 1023) / 511.5 - 1; };
const sm = t => t * t * (3 - 2 * t);
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}

// Move an orb's own state on to `want` over dt seconds (straight there with no motion).
function settle(o, want, dt) {
  const s = o.s;
  if (still()) {
    s.level = want.level || 0; s.listen = +(want.state === 'listening'); s.think = +(want.state === 'thinking'); s.speak = +(want.state === 'speaking');
    s.e8.fill(0); // (holding still: the orb doesn't ripple)
    return;
  }
  s.level = follow(s.level, want.level || 0, dt, 0.05, 0.2);
  // each of the eight bands has its own envelope: quick to rise (60 ms), slow to fall (250 ms)
  const b8 = want.b8;
  for (let b = 0; b < 8; b++) s.e8[b] = follow(s.e8[b], b8 ? b8[b] : 0, dt, 0.06, 0.25);
  for (let b = 0; b < 3; b++) s.bands[b] = follow(s.bands[b], want.bands?.[b] || 0, dt, 0.06, 0.22);
  s.listen = follow(s.listen, want.state === 'listening' ? 1 : 0, dt, 0.18, 0.35);
  s.think = follow(s.think, want.state === 'thinking' ? 1 : 0, dt, 0.25, 0.4);
  s.speak = follow(s.speak, want.state === 'speaking' ? 1 : 0, dt, 0.18, 0.35);
}

// Dots are sorted into batches that share a colour (how near, how high up, how lit by the sweep, how
// loud), far batches first so the near side covers the far one. Each colour is one dot drawn once into
// a sprite sheet; a frame is then only drawImage calls (no paths, gradients or shadows per dot).
const DB = 8, VB = 4, SB = 3, LB = 4, SWEEP = [0, 0.35, 0.85], LOUD = [0, 0.33, 0.66, 1];
const CELL = 24, COLS = 24; // device px per sprite cell; DB*VB*SB*LB = 384 cells in a 24 × 16 grid
// (The whole sheet is drawn at once, before any frame uses it: drawing into it while frames read it
// makes the browser flush it again and again, which was hundreds of milliseconds a frame.)
let atlas = null, atlasCtx = null;
function sheet() {
  if (atlas) return atlas;
  atlas = document.createElement('canvas');
  atlas.width = CELL * COLS; atlas.height = CELL * Math.ceil((DB * VB * SB * LB) / COLS);
  atlasCtx = atlas.getContext('2d');
  for (let key = 0; key < DB * VB * SB * LB; key++) drawCell(key);
  return atlas;
}
function drawCell(key) {
  const lb = key % LB, sb = ((key / LB) | 0) % SB, vb = ((key / (LB * SB)) | 0) % VB, db = (key / (LB * SB * VB)) | 0;
  const depth = (db + 0.5) / DB, u = (vb + 0.5) / VB, sweep = SWEEP[sb], loud = LOUD[lb];
  const P = palette();
  // the theme's colours across the sphere: the accent up top, turning blue, violet round the bottom
  let c = mix(mix(P.v, P.b, u), P.a, Math.max(0, u * 1.2 - 0.25) * 0.78);
  c = mix(c, [255, 255, 255], Math.min(1, 0.04 + 0.22 * depth ** 3 + 0.5 * sweep + 0.3 * loud * depth));
  const a = Math.min(1, 0.07 + 0.93 * depth ** 1.7 + sweep * 0.5);
  const x = (key % COLS) * CELL, y = ((key / COLS) | 0) * CELL;
  atlasCtx.clearRect(x, y, CELL, CELL);
  atlasCtx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
  atlasCtx.beginPath();
  atlasCtx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 1, 0, TAU);
  atlasCtx.fill();
}
function resetSprites() { atlas = null; atlasCtx = null; }
function paint(o, now) {
  const calm = still();
  const s = o.s;
  const T = calm ? 7 : now / 1000; // the shared clock
  const { ctx, size, box, dpr, pts, xs, ys, rs: radii, bk } = o;
  const R = size * 0.46, cx = box / 2;
  const yaw = T * 0.32 + G.extra, tilt = 0.42 + 0.08 * Math.sin(T * 0.3);
  const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  const breathe = 1 + 0.025 * Math.sin(T * 1.3);
  const lvl = s.level * s.listen, spk = Math.min(1, s.level * 1.6) * s.speak;
  const thinking = s.think > 0.002, scan = T * 2.6;
  const k0 = (size / 60) * (size > 90 ? 0.8 : size < 44 ? 1.25 : 1);
  const t31 = T * 3.1, t53 = T * 5.3;
  // the eight bands: the lows swell the whole sphere a little (at most 6 %), the middle pushes dots
  // out along their normals by a drifting noise field (a liquid ripple), the highs shimmer at the rim
  const e = s.e8, voiced = Math.max(s.listen, s.speak);
  const low = (e[0] + e[1]) * 0.5 * voiced, hi = (e[6] + e[7]) * 0.5 * voiced;
  const rich = voiced > 0.02 && (e[2] + e[3] + e[4] + e[5] + low + hi) > 0.02;
  const nx = T * 0.35, ny = -T * 0.22, nz = T * 0.17;
  for (const b of bk) b.length = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    // the surface moves: a slow breath, a ripple with the voice (the lows round the middle, the highs
    // up at the poles), and while it thinks a bright meridian sweeping round
    let k = breathe * (1 + 0.06 * low), sweep = 0;
    if (rich) {
      const n = noise3(p.x * 1.7 + nx, p.y * 1.7 + ny, p.z * 1.7 + nz);
      k += 0.15 * e[p.band] * voiced * (0.3 + 0.7 * n);
    } else if (lvl > 0.002) k += lvl * (0.08 + 0.14 * (s.bands[0] * p.lowW + s.bands[2] * p.highW) + 0.05 * s.bands[1]) * (0.6 + 0.2 * Math.sin(t31 + p.ph) + 0.2 * Math.sin(t53 + p.ph2));
    // speaking: the voice runs over it in waves from the poles, each dot lifting on its own beat
    if (spk > 0.002 && !rich) k += spk * (0.07 + 0.09 * Math.sin(T * 7.3 - p.y * 5 + p.ph * 0.4) + 0.05 * Math.sin(T * 11.1 + p.ph2));
    // thinking: a slow ripple travels round it under the sweep
    if (thinking) k += s.think * 0.035 * Math.sin(p.lon * 3 + yaw * 2 - T * 4.2);
    if (thinking) {
      const a = p.lon + yaw - scan, d = Math.atan2(Math.sin(a), Math.cos(a));
      sweep = s.think * Math.exp(-(d * d) / 0.12);
      k += 0.04 * sweep;
    }
    const x0 = p.x * k, y0 = p.y * k, z0 = p.z * k;
    const x1 = x0 * cyw + z0 * sy, z1 = -x0 * sy + z0 * cyw;
    const y1 = y0 * ct - z1 * st, z2 = y0 * st + z1 * ct;
    const depth = (z2 + 1) / 2; // 0 far … 1 near
    if (rich && hi > 0.01) { const rim = 1 - Math.abs(z2); const sh = hi * rim * rim * rim * (0.55 + 0.45 * Math.sin(T * 19 + p.ph * 3)); if (sh > sweep) sweep = sh; }
    xs[i] = cx + x1 * R;
    ys[i] = cx - y1 * R;
    radii[i] = Math.max(0.35, (0.55 + 1.45 * depth + 1.1 * sweep + (0.9 * lvl + 0.8 * spk) * depth) * k0);
    const db = Math.min(DB - 1, (depth * DB) | 0), vb = Math.min(VB - 1, (((y1 / k) + 1) / 2 * VB) | 0);
    const sb = sweep > 0.55 ? 2 : sweep > 0.15 ? 1 : 0;
    bk[(db * VB + vb) * SB + sb].push(i);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box, box);
  const lb = Math.max(0, Math.min(LB - 1, Math.round((lvl + spk) * (LB - 1))));
  const img = sheet();
  for (let key = 0; key < bk.length; key++) {
    const list = bk[key];
    if (!list.length) continue;
    const cell = key * LB + lb, sx = (cell % COLS) * CELL, sy2 = ((cell / COLS) | 0) * CELL;
    for (const i of list) { const r = radii[i]; ctx.drawImage(img, sx, sy2, CELL, CELL, xs[i] - r, ys[i] - r, r * 2, r * 2); }
  }
  o.at = now;
}

// ---------- one frame for all of them (the app's shared frame, js/ui/frame.js) ----------
let stop = null, tick = 0;
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
  for (const e of es) for (const o of orbs) if (o.canvas === e.target) o.seen = e.isIntersecting;
  wake();
}) : null;
// whether an orb can be seen (faded or hidden by its page): asked on a quarter-second timer, outside
// the frame, so the frame itself never forces a style pass to find out
const shown = o => o.vis ?? true;
setInterval(() => { if (!stop || document.hidden) return; for (const o of orbs) if (o.seen) o.vis = o.canvas.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true; }, 250);
function frame(now, dt) {
  tick++;
  const calm = still();
  // the shared spin: a little faster while any orb listens or thinks
  if (!calm) G.extra += G.busy * dt;
  let any = false, busy = 0;
  for (const o of orbs) {
    if (!o.orb.isConnected) { orbs.delete(o); io?.unobserve(o.canvas); byEl.delete(o.orb); continue; }
    if (!o.seen) continue;
    any = true;
    const want = ORBTEST ? (orbTestBands(TEST.b8, now / 1000), TEST.level = 0.5, TEST) : o.want || autoState(o);
    const odt = o.at ? Math.min(0.1, (now - o.at) / 1000) : dt;
    const active = want.state !== 'idle' || o.s.listen + o.s.think + o.s.speak > 0.004 || o.s.level > 0.004;
    const every = !shown(o) ? 8 : active ? 1 : 2;
    if (tick % every) { if (active) busy = Math.max(busy, 0.55 * o.s.think + 0.25 * o.s.listen); continue; }
    settle(o, want, odt);
    busy = Math.max(busy, 0.55 * o.s.think + 0.25 * o.s.listen + 0.3 * o.s.speak);
    paint(o, now);
  }
  G.busy = busy;
  if (!any || calm) { stop?.(); stop = null; } // nothing on screen (or holding still): off the frame
}
function wake() { if (!stop) stop = onFrame(frame); }

// Tell an orb what it's doing (the voice screen and the floating orb, from their own loop; null
// hands it back to working it out for itself).
export function setOrb(orb, want) {
  const o = orb && byEl.get(orb);
  if (!o) return;
  o.want = want;
  if (!o.seen) { o.seen = true; paint(o, performance.now()); } // on its way into view: in step already
  if (still()) { settle(o, want || autoState(o), 0); paint(o, performance.now()); }
  wake();
}

// One orb takes over from another (a flight lands, the floating orb opens full screen): it carries on
// exactly as swollen, lit and busy as the one it replaces, and eases to its own state from there.
export function handOrb(from, to) {
  const a = from && byEl.get(from);
  if (!a || !to?.matches?.('.orb')) return;
  const b = mount(to);
  b.s = { ...a.s, bands: [...a.s.bands], e8: Float32Array.from(a.s.e8) };
  b.seen = true; b.vis = true; // taking over: painted every frame from now, not when the timer next looks
  paint(b, performance.now());
  wake();
}

// Every orb, as it appears; a new theme or accent recolours them.
function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches('.orb')) mount(root);
  for (const el of root.querySelectorAll('.orb')) mount(el);
}
export function startDotOrbs() {
  scan(document.body);
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(() => { pal = null; resetSprites(); for (const o of orbs) if (o.orb.isConnected) paint(o, performance.now()); wake(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent', 'data-theme', 'data-motion'] });
}
