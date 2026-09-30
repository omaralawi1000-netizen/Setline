// The Orb, drawn as a sphere of lit dots turning slowly in 3D. Dots near you are bigger and brighter,
// the far side fades, and the theme's colours run across it.
//
// It answers a voice by SEPARATING, never by growing: every dot keeps its size, the sphere opens up
// (its radius grows up to ~15%) so the gaps between dots widen, each dot has its own springy radial
// offset so on every syllable they pop out by different amounts and settle in ~180 ms, a few soft
// lobes wander over the surface, a swirl speeds up, and each syllable onset sends a ripple across it.
// The mic is normalised per band to its own recent peak (phone mics are quiet) above a noise floor,
// so silence stays a calm, tight sphere with a slow breath. While the Coach speaks the same system is
// driven by the playback level; while it thinks a soft brightness wave runs round the sphere.
//
// Every `.orb` in the app becomes one of these on its own (a watcher mounts a canvas in each one as
// it appears, the flying stand-ins included). They all turn on one clock and one spin, so whenever
// one orb hands over to another the two are in the same pose. One animation frame paints every orb;
// an orb at rest is painted at half rate and one that's hidden only now and then. Dots are stamped
// from pre-drawn sprites and nothing is allocated while it runs.
//
//   setOrb(orbEl, { state: 'listening' | 'thinking' | 'speaking' | 'idle' })   (null: work it out)

import * as mic from '../voice.js';
import * as tts from '../tts.js';

const TAU = Math.PI * 2;
const still = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// "Lively" (the default): every knob in one place.
const TUNE = {
  spread: 0.15,       // how far loudness pushes the sphere outward (fraction of the radius)
  jump: 0.11,         // how far a dot pops out on its band's energy
  kick: 3.5,          // the extra push every dot gets on a syllable onset (radius per second)
  lobes: [0.10, 0.16],// peak height of the soft lobes when loud
  swirl: 1.0,         // extra spin (rad/s) at full voice, on top of the resting 0.32
  ripple: 0.06,       // height of the ripple that crosses the sphere on an onset
  size: 0.04,         // dots grow at most this much with the voice
  breath: 0.015       // resting breath (over ~4 s)
};
const NB = 6;          // frequency bands
const K = 1444, C = 45.6; // dot spring: ~180 ms to settle, a little bounce

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
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// Dots are drawn far to near, one sprite per (how near, how high up, how lit by the thinking sweep).
const DB = 8, VB = 4, SB = 3, SWEEP = [0, 0.35, 0.85], SP = 24;
let sprites = null;
function buildSprites() {
  const cs = getComputedStyle(document.documentElement);
  const A = rgbOf(cs, '--accent-hi', [120, 240, 220]), B = rgbOf(cs, '--blue', [90, 140, 255]), V = rgbOf(cs, '--violet', [160, 120, 255]);
  const list = [];
  for (let key = 0; key < DB * VB * SB; key++) {
    const sb = key % SB, vb = ((key / SB) | 0) % VB, db = (key / (SB * VB)) | 0;
    const depth = (db + 0.5) / DB, u = (vb + 0.5) / VB, sweep = SWEEP[sb];
    let c = mix(mix(V, B, u), A, Math.max(0, u * 1.2 - 0.25) * 0.78);
    c = mix(c, [255, 255, 255], Math.min(1, 0.04 + 0.22 * depth ** 3 + 0.5 * sweep));
    const a = Math.min(1, 0.07 + 0.93 * depth ** 1.7 + sweep * 0.5);
    const cv = document.createElement('canvas');
    cv.width = cv.height = SP;
    const g = cv.getContext('2d'), rg = g.createRadialGradient(SP / 2, SP / 2, 0, SP / 2, SP / 2, SP / 2), col = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
    rg.addColorStop(0, `rgba(${col},${a.toFixed(3)})`);
    rg.addColorStop(0.7, `rgba(${col},${a.toFixed(3)})`);
    rg.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, SP, SP);
    list.push(cv);
  }
  return list;
}

// evenly spread points on a sphere (a Fibonacci lattice), each with fixed random traits
const fr = x => x - Math.floor(x);
const lattices = new Map();
function lattice(n) {
  if (lattices.has(n)) return lattices.get(n);
  const g = Math.PI * (3 - Math.sqrt(5)), pts = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * g;
    const h = fr(Math.sin(i * 12.9898) * 43758.5453), ph = h * TAU;
    pts.push({
      x: r * Math.cos(a), y, z: r * Math.sin(a), lon: Math.atan2(Math.sin(a), Math.cos(a)), ph,
      bd: Math.min(NB - 1, (fr(Math.sin(i * 78.233) * 12345.6789) * NB) | 0), // which band moves it
      rnd: 0.3 + 0.7 * fr(Math.sin(i * 39.346) * 24634.6345),                   // how hard a syllable kicks it
      spd: 7 + 4 * h                                                             // its own flutter rate
    });
  }
  lattices.set(n, pts);
  return pts;
}

// ---------- the voice, as every orb sees it (one field, shared) ----------
const SPK_W = [1, 0.95, 0.8, 0.6, 0.45, 0.3]; // how a spoken level spreads over the bands
const F = {
  raw: new Float32Array(NB), nf: new Float32Array(NB), pk: new Float32Array(NB), e: new Float32Array(NB),
  A: 0, fast: 0, slow: 0, lastOn: -1e9, onId: 0, onStr: 0
};
const RIP = [0, 1, 2].map(() => ({ t0: -9, x: 0, y: 1, z: 0, str: 0 }));
let ripN = 0;
const ra = { on: new Uint8Array(3), x: new Float32Array(3), y: new Float32Array(3), z: new Float32Array(3), front: new Float32Array(3), amp: new Float32Array(3) };
const lb = { x: new Float32Array(3), y: new Float32Array(3), z: new Float32Array(3), h: new Float32Array(3) };

// mode: 0 nothing, 1 the microphone, 2 the Coach's voice
function field(now, dt, T, mode) {
  let live = false;
  if (mode === 1) live = mic.spectrum(F.raw);
  else if (mode === 2) {
    let l = tts.speechLevel();
    if (l == null) l = 0.35 + 0.25 * Math.abs(Math.sin(now / 190)); // the phone's voice: a gentle beat
    for (let b = 0; b < NB; b++) F.raw[b] = l * SPK_W[b] * (0.55 + 0.45 * Math.sin(T * (5 + b * 2.3) + b * 1.7));
    live = true;
  }
  if (!live) F.raw.fill(0);
  const dk = Math.exp(-dt / 2); // the ~2 s window each band is measured against
  let sum = 0, mx = 0;
  for (let b = 0; b < NB; b++) {
    const r = F.raw[b];
    F.nf[b] = r < F.nf[b] ? r : Math.min(0.25, F.nf[b] + 0.008 * dt); // the noise floor: follows the quiet, creeps up slowly
    const sig = Math.max(0, r - F.nf[b]);
    F.pk[b] = Math.max(sig, F.pk[b] * dk);
    let e = Math.min(1, sig / Math.max(F.pk[b], 0.1)); // a quiet mic reaches the top of the range too
    e *= sig < 0.02 ? 0 : sig >= 0.05 ? 1 : (sig - 0.02) / 0.03; // and silence stays still
    F.e[b] += (e - F.e[b]) * (1 - Math.exp(-dt / (e > F.e[b] ? 0.02 : 0.07)));
    sum += F.e[b];
    if (F.e[b] > mx) mx = F.e[b];
  }
  const inst = 0.5 * sum / NB + 0.5 * mx;
  F.A += (inst - F.A) * (1 - Math.exp(-dt / (inst > F.A ? 0.05 : 0.22)));
  // a syllable: a quick rise over what it was a moment ago
  if (inst - F.slow > 0.16 && inst > 0.22 && now - F.lastOn > 130) {
    F.lastOn = now;
    F.onId++;
    F.onStr = Math.min(1, (inst - F.slow) * 2.2 + 0.4);
    const r = RIP[ripN++ % 3], y = 1 - 2 * fr(Math.sin(F.onId * 78.233) * 12345.6789), th = TAU * fr(Math.sin(F.onId * 12.9898) * 43758.5453), rr = Math.sqrt(1 - y * y);
    r.t0 = now / 1000; r.x = rr * Math.cos(th); r.y = y; r.z = rr * Math.sin(th); r.str = F.onStr;
  }
  F.slow += (inst - F.slow) * (1 - Math.exp(-dt / 0.15));
}

// ---------- the orbs ----------
const orbs = [];
const byEl = new WeakMap();
const G = { yaw: 0, busy: 0 }; // the spin every orb shares, and how busy the busiest thinker is
const follow = (x, to, dt, up, down) => x + (to - x) * (1 - Math.exp(-dt / (to > x ? up : down)));
const drop = o => { const i = orbs.indexOf(o); if (i >= 0) orbs.splice(i, 1); io?.unobserve(o.canvas); byEl.delete(o.orb); };

function mount(orb) {
  if (byEl.has(orb)) return byEl.get(orb);
  for (let i = orbs.length - 1; i >= 0; i--) if (!orbs[i].orb.isConnected) drop(orbs[i]); // redrawn away
  for (const c of orb.querySelectorAll(':scope > canvas.dots')) c.remove(); // a copy's blank canvas
  const size = parseFloat(orb.style.getPropertyValue('--s')) || parseFloat(getComputedStyle(orb).getPropertyValue('--s')) || orb.offsetWidth || 60;
  const box = Math.round(size * 1.3); // room for the sphere to open up
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
    xs: new Float32Array(n), ys: new Float32Array(n), rs: new Float32Array(n),
    off: new Float32Array(n), vel: new Float32Array(n), // each dot's own radial spring
    bk: Array.from({ length: DB * VB * SB }, () => []),
    want: null, // set from outside; otherwise worked out from where the orb sits
    cur: 'idle', onSeen: F.onId,
    s: { listen: 0, think: 0, speak: 0 },
    seen: true, at: 0, visTick: null, vis: true
  };
  orbs.push(o);
  byEl.set(orb, o);
  io?.observe(canvas);
  paint(o, performance.now());
  wake();
  return o;
}

// What an orb is doing, from where it lives, when nobody tells it (the message box, the dock, the interview).
function autoState(o) {
  const app = document.getElementById('app');
  const box = o.orb.closest('#composer');
  if (box) {
    if (app?.classList.contains('thinking')) return 'thinking';
    if (box.classList.contains('speaking')) return 'speaking';
    const talk = box.dataset.talk;
    if (talk === 'listening' || talk === 'hearing') return 'listening';
    return talk === 'thinking' ? 'thinking' : 'idle';
  }
  const iv = o.orb.closest('.iv');
  if (iv) {
    const p = iv.dataset.phase;
    return p === 'listening' || p === 'wait' ? 'listening' : p === 'thinking' || p === 'hearing' ? 'thinking' : p === 'speaking' ? 'speaking' : 'idle';
  }
  return o.orb.closest('#dock') && app?.classList.contains('speaking') ? 'speaking' : 'idle';
}

// Move an orb's own state on to `state` over dt seconds (straight there with no motion).
function settle(o, state, dt) {
  const s = o.s, l = +(state === 'listening'), t = +(state === 'thinking'), p = +(state === 'speaking');
  if (still()) { s.listen = l; s.think = t; s.speak = p; return; }
  s.listen = follow(s.listen, l, dt, 0.18, 0.35);
  s.think = follow(s.think, t, dt, 0.25, 0.4);
  s.speak = follow(s.speak, p, dt, 0.18, 0.35);
}

function paint(o, now) {
  const calm = still();
  const s = o.s;
  const T = calm ? 7 : now / 1000; // the shared clock
  const dt = o.at ? Math.min(0.033, (now - o.at) / 1000) : 0.016;
  const { ctx, size, box, dpr, pts, xs, ys, rs: radii, bk, off, vel } = o;
  const R = size * 0.46, cx = box / 2;
  const yaw = calm ? 7 * 0.32 : G.yaw, tilt = 0.42 + 0.08 * Math.sin(T * 0.3);
  const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  const m = calm ? 0 : Math.min(1, Math.max(s.listen, s.speak)); // how much of the voice this orb shows
  const A = F.A * m, thinking = s.think > 0.002, scan = T * 2.6;
  const k0 = (size / 60) * (size > 90 ? 0.8 : size < 44 ? 1.25 : 1) * (1 + TUNE.size * A);
  const base = 1 + TUNE.breath * Math.sin(T * TAU / 4) + TUNE.spread * A; // the sphere opens up with the voice
  // a syllable: every dot gets its own kick
  if (o.onSeen !== F.onId) {
    o.onSeen = F.onId;
    if (m > 0.05) for (let i = 0; i < pts.length; i++) vel[i] += TUNE.kick * F.onStr * pts[i].rnd * m;
  }
  // 3 soft lobes wander over the surface, each one riding a couple of the bands
  for (let j = 0; j < 3; j++) {
    const a = T * (0.21 + 0.13 * j) + j * 2.1, b = T * (0.17 + 0.09 * j) + j * 1.3, cb = Math.cos(b);
    lb.x[j] = Math.cos(a) * cb; lb.y[j] = Math.sin(b); lb.z[j] = Math.sin(a) * cb;
    lb.h[j] = (TUNE.lobes[0] + (TUNE.lobes[1] - TUNE.lobes[0]) * (0.5 + 0.5 * Math.sin(j * 4.7))) * (0.12 + 0.88 * (0.5 * F.A + 0.5 * F.e[j * 2])) * m;
  }
  // ripples still on their way across
  const nowS = now / 1000;
  for (let r = 0; r < 3; r++) {
    const age = nowS - RIP[r].t0;
    ra.on[r] = m > 0.05 && age >= 0 && age < 1.2 ? 1 : 0;
    ra.x[r] = RIP[r].x; ra.y[r] = RIP[r].y; ra.z[r] = RIP[r].z;
    ra.front[r] = age * 3.6;
    ra.amp[r] = RIP[r].str * TUNE.ripple * (1 - age / 1.2) * m;
  }
  const sdt = dt;
  for (let b = 0; b < bk.length; b++) bk[b].length = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    // its own springy offset: pulled out by its band's energy (and its own flutter), it settles back
    const nz = 0.5 + 0.5 * Math.sin(T * p.spd + p.ph * 3);
    const tg = TUNE.jump * F.e[p.bd] * (0.3 + 0.7 * nz) * m;
    vel[i] += ((tg - off[i]) * K - vel[i] * C) * sdt;
    off[i] += vel[i] * sdt;
    let k = base + off[i];
    for (let j = 0; j < 3; j++) k += lb.h[j] * Math.exp((p.x * lb.x[j] + p.y * lb.y[j] + p.z * lb.z[j] - 1) * 4);
    for (let r = 0; r < 3; r++) {
      if (!ra.on[r]) continue;
      const c = p.x * ra.x[r] + p.y * ra.y[r] + p.z * ra.z[r], w = Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) - ra.front[r];
      k += ra.amp[r] * Math.exp(-(w * w) / 0.06);
    }
    let sweep = 0;
    if (thinking) {
      k += s.think * 0.02 * Math.sin(p.lon * 3 + yaw * 2 - T * 4.2);
      const a = p.lon + yaw - scan, d = Math.atan2(Math.sin(a), Math.cos(a));
      sweep = s.think * Math.exp(-(d * d) / 0.12);
    }
    if (k > 1.33) k = 1.33;
    const x1 = p.x * cyw + p.z * sy, z1 = -p.x * sy + p.z * cyw;
    const y1 = p.y * ct - z1 * st, z2 = p.y * st + z1 * ct;
    const depth = (z2 + 1) / 2; // 0 far … 1 near
    xs[i] = cx + x1 * k * R;
    ys[i] = cx - y1 * k * R;
    radii[i] = Math.max(0.35, (0.55 + 1.45 * depth) * k0); // the dot's size does not follow the radius
    const db = Math.min(DB - 1, (depth * DB) | 0), vb = Math.min(VB - 1, ((y1 + 1) / 2 * VB) | 0);
    bk[(db * VB + vb) * SB + (sweep > 0.55 ? 2 : sweep > 0.15 ? 1 : 0)].push(i);
  }
  if (!sprites) sprites = buildSprites();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box, box);
  ctx.globalAlpha = 0.92 + 0.1 * A;
  for (let key = 0; key < bk.length; key++) {
    const list = bk[key], sp = sprites[key];
    for (let n = 0; n < list.length; n++) {
      const i = list[n], r = radii[i];
      ctx.drawImage(sp, xs[i] - r, ys[i] - r, r * 2, r * 2);
    }
  }
  o.at = now;
}

// ---------- one frame for all of them ----------
let raf = 0, last = 0, tick = 0;
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
  for (const e of es) for (let i = 0; i < orbs.length; i++) if (orbs[i].canvas === e.target) orbs[i].seen = e.isIntersecting;
  wake();
}) : null;
// (asked a few times a second, not every frame: each ask makes the browser work out every style on the
// page first, which cost frames in the middle of transitions)
const shown = o => {
  if (o.visTick == null || tick - o.visTick >= 12) { o.visTick = tick; o.vis = o.canvas.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true; }
  return o.vis;
};
function frame(now) {
  raf = 0;
  tick++;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
  last = now;
  const calm = still();
  let any = false, listen = false, speak = false, think = 0;
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    if (!o.orb.isConnected) { drop(o); continue; }
    if (!o.seen) continue;
    any = true;
    o.cur = o.want || autoState(o);
    if (o.cur === 'listening') listen = true;
    else if (o.cur === 'speaking') speak = true;
    if (o.s.think > think) think = o.s.think;
  }
  // the voice they answer: the mic while one listens, the Coach's playback while one speaks
  if (!calm) {
    field(now, dt, now / 1000, listen ? 1 : speak ? 2 : 0);
    G.yaw += (0.32 + TUNE.swirl * F.A + 0.25 * think) * dt; // the swirl speeds up while it talks
  }
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i];
    if (!o.seen) continue;
    const odt = o.at ? Math.min(0.1, (now - o.at) / 1000) : dt;
    const active = o.cur !== 'idle' || o.s.listen + o.s.think + o.s.speak > 0.004 || F.A > 0.004;
    if (tick % (!shown(o) ? 8 : active ? 1 : 2)) continue;
    settle(o, o.cur, odt);
    paint(o, now);
  }
  if (any && !calm && document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame);
  else last = 0;
}
function wake() { if (!raf && document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame); }
document.addEventListener('visibilitychange', wake);

// Tell an orb what it's doing (the voice screen and the floating orb, from their own loop; null
// hands it back to working it out for itself).
export function setOrb(orb, want) {
  const o = orb && byEl.get(orb);
  if (!o) return;
  o.want = want?.state ?? want ?? null;
  o.visTick = null;
  if (!o.seen) { o.seen = true; paint(o, performance.now()); } // on its way into view: in step already
  if (still()) { settle(o, o.want || autoState(o), 0); paint(o, performance.now()); }
  wake();
}

// One orb takes over from another (a flight lands, the floating orb opens full screen): it carries on
// exactly as busy as the one it replaces, and eases to its own state from there.
export function handOrb(from, to) {
  const a = from && byEl.get(from);
  if (!a || !to?.matches?.('.orb')) return;
  const b = mount(to);
  b.s.listen = a.s.listen; b.s.think = a.s.think; b.s.speak = a.s.speak;
  b.seen = true;
  b.visTick = null;
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
  new MutationObserver(() => { sprites = null; for (const o of orbs) if (o.orb.isConnected) paint(o, performance.now()); wake(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent', 'data-theme', 'data-motion'] });
}
