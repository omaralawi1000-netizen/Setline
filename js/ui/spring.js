// One spring for every moving thing (the orb, the sheets, the words flying into the chat): critically
// damped by default, so it settles in about 400 ms without a visible overshoot. A spring can be sent
// somewhere new at any moment and carries on from where it is, at the speed it has: nothing ever
// snaps back to a start pose. A group of values (x, y, scale…) moves together on the app's one frame.
//
//   const s = spring({ y: 0, s: 1 }, { onUpdate: v => …, onRest: v => … });
//   s.to({ y: 300 });           // from wherever it is now
//   s.to({ y: () => target() }) // a target that moves (read every frame)
//   s.set({ y: 0 });            // jump (no motion)
import { onFrame } from './frame.js';
import { M, slowmo } from '../motion.config.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && RM.matches);

// one step of x'' = -k(x - t) - c·x', in small sub-steps so a slow frame can't blow it up
export function stepSpring(x, v, t, dt, k = M.stiffness, c = M.damping) {
  let n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  while (n--) { v += (-k * (x - t) - c * v) * h; x += v * h; }
  return [x, v];
}

export function spring(initial, { onUpdate = () => {}, onRest = () => {}, precision = 0.001 } = {}) {
  const keys = Object.keys(initial);
  const x = { ...initial }, v = Object.fromEntries(keys.map(k => [k, 0])), goal = { ...initial };
  let stop = null, restFn = null;
  const target = k => (typeof goal[k] === 'function' ? goal[k]() : goal[k]);
  const settle = () => { stop?.(); stop = null; const f = restFn; restFn = null; onRest(x); f?.(x); };
  const tick = (now, dt) => {
    dt = Math.min(0.064, dt) / slowmo;
    let moving = false;
    for (const k of keys) {
      const t = target(k);
      [x[k], v[k]] = stepSpring(x[k], v[k], t, dt);
      const eps = Math.max(1, Math.abs(t)) * precision;
      if (Math.abs(x[k] - t) > eps || Math.abs(v[k]) > eps * 10) moving = true;
    }
    if (!moving) for (const k of keys) { x[k] = target(k); v[k] = 0; }
    onUpdate(x);
    if (!moving) settle();
  };
  const api = {
    value: x,
    velocity: v,
    get running() { return !!stop; },
    // move on to a new target from here; resolves when it comes to rest (or is sent elsewhere)
    to(next, { velocity } = {}) {
      Object.assign(goal, next);
      if (velocity) Object.assign(v, velocity);
      const prev = restFn;
      const p = new Promise(res => { restFn = res; });
      prev?.(x);
      if (reducedMotion()) { for (const k of keys) { x[k] = target(k); v[k] = 0; } onUpdate(x); settle(); return p; }
      if (!stop) stop = onFrame(tick);
      return p;
    },
    set(next) {
      Object.assign(x, next); Object.assign(goal, next);
      for (const k of Object.keys(next)) v[k] = 0;
      onUpdate(x);
    },
    // freeze where it is (a gesture takes over; the value then follows the finger via set)
    halt() { stop?.(); stop = null; const f = restFn; restFn = null; f?.(x); for (const k of keys) { goal[k] = x[k]; } },
    target
  };
  return api;
}

// Track a value from a gesture: remembers the speed it had so a spring can take over with it.
export function tracker() {
  let last = null, vel = 0;
  return {
    push(val, t = performance.now()) {
      if (last) { const dt = Math.max(1, t - last.t) / 1000; vel = vel * 0.6 + ((val - last.v) / dt) * 0.4; }
      last = { v: val, t };
    },
    get velocity() { return last && performance.now() - last.t < 80 ? vel : 0; },
    reset() { last = null; vel = 0; }
  };
}
