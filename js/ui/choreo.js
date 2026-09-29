// The one way things move between Home, the floating orb, the voice screen and the Coach.
//
// arcFly(from, to): ONE orb travels (a stand-in carrying the source orb's own dots), on a soft arc that
//   bows about 12 % of the distance off the straight line, its size going from the source's to the
//   target's, fully opaque the whole way. Both real orbs are hidden while it flies; on arrival the
//   stand-in hands its dots to the target and they swap in the same frame, then the target gives a
//   tiny squash. No trail, streak or smear: the orb is one solid object on every frame.
// recoil(box, point): the message box taking the orb: pressed back in depth (never up or down) from
//   the point it landed, springing back with one soft overshoot. No light, no flash.
import { handOrb } from './dotorb.js';

export const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
// a flight: off the mark at once but unhurried, then a long soft landing (no dart-and-creep)
export const FLY = 'cubic-bezier(.3,0,.2,1)';
export const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

const appEl = () => document.getElementById('app');
const centre = el => { const a = appEl().getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2, w: r.width }; };
const hide = el => { el._held = (el._held || 0) + 1; el.style.visibility = 'hidden'; };
const show = el => { if (el._held && --el._held > 0) return; el._held = 0; el.style.visibility = ''; };

// A quadratic arc from a to b, bowing off the line by `bow` of its length: upwards when the flight
// is mostly sideways, towards the middle of the screen when it's mostly up or down.
function arc(a, b, bow = 0.12) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d, ny = dx / d;
  if (Math.abs(dx) >= Math.abs(dy) ? ny > 0 : (appEl().clientWidth / 2 - (a.x + b.x) / 2) * nx < 0) { nx = -nx; ny = -ny; }
  const k = 2 * bow * d; // (a quadratic's peak sits half-way to its control point)
  return { c: { x: (a.x + b.x) / 2 + nx * k, y: (a.y + b.y) / 2 + ny * k }, d };
}

// (to: where the target will be, when it isn't there yet; keepFrom: the source stays hidden until its
// owner lets go of it with releaseOrb(), for a source whose screen is still fading out)
export const releaseOrb = el => el && show(el);
export function arcFly(fromEl, toEl, { delay = 0, onland, ctrl = null, disc = true, from = null, to = null, keepFrom = false } = {}) {
  if (!fromEl?.isConnected || !toEl?.isConnected) { onland?.(); return Promise.resolve(); }
  const a = from?.w ? from : centre(fromEl), b = to || centre(toEl);
  if (!a.w || !b.w || reduced()) {
    // (no flight: the orb is simply in its new place, and the old one is gone while its screen fades)
    handOrb(fromEl, toEl); hide(fromEl); if (!keepFrom) setTimeout(() => show(fromEl), 450);
    onland?.(); return Promise.resolve();
  }
  const W = Math.max(a.w, b.w);
  const ghost = document.createElement('div');
  ghost.className = 'orbghost' + (disc ? ' disc' : '');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { left: `${a.x - W / 2}px`, top: `${a.y - W / 2}px`, width: `${W}px`, height: `${W}px`, zIndex: '30' });
  // two looks of the one orb: the source's dots, and the target's (its own, finer or coarser, pattern),
  // which take over half-way while it moves fastest, so nothing changes at the landing
  const make = size => {
    const o = document.createElement('span');
    o.className = 'orb';
    o.dataset.low = '1'; // (drawn at 1×: it's moving, and it's the one extra orb painted every frame)
    o.innerHTML = '<i class="core"><b></b><b></b><b></b></i>';
    Object.assign(o.style, { position: 'absolute', left: `${(W - size) / 2}px`, top: `${(W - size) / 2}px`, margin: '0', scale: `${W / size}` });
    o.style.setProperty('--s', `${size}px`);
    ghost.append(o);
    return o;
  };
  const orbA = make(W), orbB = Math.abs(a.w - b.w) > 8 ? make(b.w) : null;
  appEl().append(ghost);
  handOrb(fromEl, orbA); // the stand-in is the source orb, dot for dot
  if (orbB) { handOrb(fromEl, orbB); orbB.style.opacity = '0'; }
  hide(fromEl); hide(toEl);
  const { c, d } = ctrl ? { c: ctrl, d: Math.hypot(b.x - a.x, b.y - a.y) } : arc(a, b);
  const s0 = a.w / W, s1 = b.w / W, N = 24, frames = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, v = 1 - u;
    const x = v * v * a.x + 2 * v * u * c.x + u * u * b.x - a.x, y = v * v * a.y + 2 * v * u * c.y + u * u * b.y - a.y;
    const k = s0 + (s1 - s0) * (1 - (1 - u) ** 3); // (it takes its new size early in the flight, and travels at it)
    frames.push({ offset: u, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(4)})` });
  }
  const duration = Math.round(Math.max(380, Math.min(520, 340 + d * 0.45)));
  ghost.style.willChange = 'transform';
  const fly = ghost.animate(frames, { duration, delay, easing: FLY, fill: 'both' });
  let swap0 = null;
  // its own drop of glass under the dots while it's out in the open (so it reads as one solid thing,
  // never as dots over text), gone again as it settles into the glass it lands in
  if (disc) swap0 = ghost.animate([{ opacity: 0 }, { opacity: 1, offset: 0.07 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration, delay, easing: 'linear', fill: 'both', pseudoElement: '::before' });
  const swap = orbB ? [orbA.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], { duration, delay, fill: 'both' }),
    orbB.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], { duration, delay, fill: 'both' })] : [];
  return new Promise(res => {
    const land = () => {
      handOrb(orbB || orbA, toEl);
      show(toEl); if (!keepFrom) show(fromEl); // (the source's screen has gone by now)
      ghost.remove(); // (the same frame: the target takes over exactly where the stand-in ends)
      swap.forEach(x => x.cancel()); swap0?.cancel();
      toEl.animate([{ scale: '1 1' }, { scale: '1.05 0.95', offset: 0.35 }, { scale: '1 1' }], { duration: 230, easing: 'cubic-bezier(.3,.6,.3,1)' });
      onland?.();
      res();
    };
    fly.onfinish = land;
    fly.oncancel = () => { ghost.remove(); show(toEl); if (!keepFrom) show(fromEl); res(); };
  });
}

export function recoil(box, point) {
  if (!box || reduced()) return;
  const r = box.getBoundingClientRect(), a = appEl().getBoundingClientRect();
  const ox = point ? point.x - (r.left - a.left) : r.width / 2, oy = point ? point.y - (r.top - a.top) : r.height / 2;
  box.style.transformOrigin = `${ox.toFixed(0)}px ${oy.toFixed(0)}px`;
  const k = box.animate([{ scale: '1' }, { scale: '0.97', offset: 0.2 }, { scale: '1.008', offset: 0.62 }, { scale: '1' }],
    { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)' });
  k.onfinish = k.oncancel = () => { box.style.transformOrigin = ''; };
}
