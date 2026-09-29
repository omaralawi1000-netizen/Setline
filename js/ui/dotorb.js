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

const TAU = Math.PI * 2;
const still = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

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
    pts.push({ x: r * Math.cos(a), y, z: r * Math.sin(a), lon: Math.atan2(Math.sin(a), Math.cos(a)), ph, ph2: ph * 1.7, lowW: 1 - Math.abs(y), highW: Math.abs(y) });
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
    s: { level: 0, bands: [0, 0, 0], listen: 0, think: 0, speak: 0 },
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
function autoState(o) {
  const app = document.getElementById('app');
  const box = o.orb.closest('#composer');
  if (box) {
    if (app?.classList.contains('thinking')) return { state: 'thinking', level: 0 };
    if (box.classList.contains('speaking')) return { state: 'speaking', level: Math.min(1, (+box.style.getPropertyValue('--sv') || 0) * 1.3) };
    const talk = box.dataset.talk;
    if (talk === 'listening' || talk === 'hearing') return { state: 'listening', level: Math.min(1, (+(o.orb.closest('.corb')?.style.getPropertyValue('--lv')) || 0) * 1.8), bands: [0.6, 0.5, 0.4] };
    if (talk === 'thinking') return { state: 'thinking', level: 0 };
    return IDLE;
  }
  const iv = o.orb.closest('.iv');
  if (iv) {
    const p = iv.dataset.phase;
    if (p === 'listening' || p === 'wait') return { state: 'listening', level: 0.35 };
    if (p === 'thinking' || p === 'hearing') return { state: 'thinking', level: 0 };
    if (p === 'speaking') return { state: 'speaking', level: 0.4 };
    return IDLE;
  }
  if (o.orb.closest('#dock') && app?.classList.contains('speaking')) return { state: 'speaking', level: 0.4 };
  return IDLE;
}

// Move an orb's own state on to `want` over dt seconds (straight there with no motion).
function settle(o, want, dt) {
  const s = o.s;
  if (still()) {
    s.level = want.level || 0; s.listen = +(want.state === 'listening'); s.think = +(want.state === 'thinking'); s.speak = +(want.state === 'speaking');
    return;
  }
  s.level = follow(s.level, want.level || 0, dt, 0.05, 0.2);
  for (let b = 0; b < 3; b++) s.bands[b] = follow(s.bands[b], want.bands?.[b] || 0, dt, 0.06, 0.22);
  s.listen = follow(s.listen, want.state === 'listening' ? 1 : 0, dt, 0.18, 0.35);
  s.think = follow(s.think, want.state === 'thinking' ? 1 : 0, dt, 0.25, 0.4);
  s.speak = follow(s.speak, want.state === 'speaking' ? 1 : 0, dt, 0.18, 0.35);
}

// Dots are drawn in batches that share a colour (how near, how high up, how lit by the sweep), far
// batches first so the near side covers the far one: a few dozen fills a frame instead of one per dot.
const DB = 8, VB = 4, SB = 3, SWEEP = [0, 0.35, 0.85];
function paint(o, now) {
  const calm = still();
  const s = o.s;
  const T = calm ? 7 : now / 1000; // the shared clock
  const { ctx, size, box, dpr, pts, xs, ys, rs: radii, bk } = o;
  const P = palette();
  const R = size * 0.46, cx = box / 2;
  const yaw = T * 0.32 + G.extra, tilt = 0.42 + 0.08 * Math.sin(T * 0.3);
  const sy = Math.sin(yaw), cyw = Math.cos(yaw), st = Math.sin(tilt), ct = Math.cos(tilt);
  const breathe = 1 + 0.025 * Math.sin(T * 1.3);
  const lvl = s.level * s.listen, spk = Math.min(1, s.level * 1.6) * s.speak;
  const thinking = s.think > 0.002, scan = T * 2.6;
  const k0 = (size / 60) * (size > 90 ? 0.8 : size < 44 ? 1.25 : 1);
  const t31 = T * 3.1, t53 = T * 5.3;
  for (const b of bk) b.length = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    // the surface moves: a slow breath, a ripple with the voice (the lows round the middle, the highs
    // up at the poles), and while it thinks a bright meridian sweeping round
    let k = breathe, sweep = 0;
    if (lvl > 0.002) k += lvl * (0.08 + 0.14 * (s.bands[0] * p.lowW + s.bands[2] * p.highW) + 0.05 * s.bands[1]) * (0.6 + 0.2 * Math.sin(t31 + p.ph) + 0.2 * Math.sin(t53 + p.ph2));
    // speaking: the voice runs over it in waves from the poles, each dot lifting on its own beat
    if (spk > 0.002) k += spk * (0.07 + 0.09 * Math.sin(T * 7.3 - p.y * 5 + p.ph * 0.4) + 0.05 * Math.sin(T * 11.1 + p.ph2));
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
    xs[i] = cx + x1 * R;
    ys[i] = cx - y1 * R;
    radii[i] = Math.max(0.35, (0.55 + 1.45 * depth + 1.1 * sweep + (0.9 * lvl + 0.8 * spk) * depth) * k0);
    const db = Math.min(DB - 1, (depth * DB) | 0), vb = Math.min(VB - 1, (((y1 / k) + 1) / 2 * VB) | 0);
    const sb = sweep > 0.55 ? 2 : sweep > 0.15 ? 1 : 0;
    bk[(db * VB + vb) * SB + sb].push(i);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, box, box);
  for (let key = 0; key < bk.length; key++) {
    const list = bk[key];
    if (!list.length) continue;
    const sb = key % SB, vb = ((key / SB) | 0) % VB, db = (key / (SB * VB)) | 0;
    const depth = (db + 0.5) / DB, u = (vb + 0.5) / VB, sweep = SWEEP[sb];
    // the theme's colours across the sphere: the accent up top, turning blue, violet round the bottom
    let c = mix(mix(P.v, P.b, u), P.a, Math.max(0, u * 1.2 - 0.25) * 0.78);
    c = mix(c, [255, 255, 255], Math.min(1, 0.04 + 0.22 * depth ** 3 + 0.5 * sweep + 0.3 * (lvl + spk) * depth));
    const a = Math.min(1, 0.07 + 0.93 * depth ** 1.7 + sweep * 0.5);
    ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
    ctx.beginPath();
    for (const i of list) { ctx.moveTo(xs[i] + radii[i], ys[i]); ctx.arc(xs[i], ys[i], radii[i], 0, TAU); }
    ctx.fill();
  }
  o.at = now;
}

// ---------- one frame for all of them ----------
let raf = 0, last = 0, tick = 0;
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => {
  for (const e of es) for (const o of orbs) if (o.canvas === e.target) o.seen = e.isIntersecting;
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
  // the shared spin: a little faster while any orb listens or thinks
  if (!calm) G.extra += G.busy * dt;
  let any = false, busy = 0;
  for (const o of orbs) {
    if (!o.orb.isConnected) { orbs.delete(o); io?.unobserve(o.canvas); byEl.delete(o.orb); continue; }
    if (!o.seen) continue;
    any = true;
    const want = o.want || autoState(o);
    const odt = o.at ? Math.min(0.1, (now - o.at) / 1000) : dt;
    const active = want.state !== 'idle' || o.s.listen + o.s.think + o.s.speak > 0.004 || o.s.level > 0.004;
    const every = !shown(o) ? 8 : active ? 1 : 2;
    if (tick % every) { if (active) busy = Math.max(busy, 0.55 * o.s.think + 0.25 * o.s.listen); continue; }
    settle(o, want, odt);
    busy = Math.max(busy, 0.55 * o.s.think + 0.25 * o.s.listen + 0.3 * o.s.speak);
    paint(o, now);
  }
  G.busy = busy;
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
  o.want = want;
  o.visTick = null;
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
  b.s = { ...a.s, bands: [...a.s.bands] };
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
  new MutationObserver(() => { pal = null; for (const o of orbs) if (o.orb.isConnected) paint(o, performance.now()); wake(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent', 'data-theme', 'data-motion'] });
}
