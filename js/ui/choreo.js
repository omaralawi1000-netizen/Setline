// The one way things move between Home, the floating orb, the voice screen and the Coach.
//
// arcFly(from, to): ONE orb travels (a stand-in carrying the source orb's own dots), on a soft arc that
//   bows about 12 % of the distance off the straight line, its size going from the source's to the
//   target's, fully opaque the whole way. Both real orbs are hidden while it flies; on arrival the
//   stand-in hands its dots to the target and they swap in the same frame, then the target gives a
//   tiny squash. No trail, streak or smear: the orb is one solid object on every frame.
// recoil(box, point): the message box taking the orb: pushed back in depth (never up or down) from
//   the point it was hit, springing back with one soft overshoot, its glass a little brighter at impact.
// fadeOut / fadeIn: screen content leaving and arriving (the sea behind is shared and never fades).
import { handOrb } from './dotorb.js';

export const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
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

export function arcFly(fromEl, toEl, { delay = 0, onland } = {}) {
  if (!fromEl?.isConnected || !toEl?.isConnected) { onland?.(); return Promise.resolve(); }
  const a = centre(fromEl), b = centre(toEl);
  if (!a.w || !b.w || reduced()) {
    // (no flight: the orb is simply in its new place, and the old one is gone while its screen fades)
    handOrb(fromEl, toEl); hide(fromEl); setTimeout(() => show(fromEl), 450);
    onland?.(); return Promise.resolve();
  }
  const W = Math.max(a.w, b.w);
  const ghost = document.createElement('div');
  ghost.className = 'orbghost';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { left: `${a.x - W / 2}px`, top: `${a.y - W / 2}px`, width: `${W}px`, height: `${W}px`, zIndex: '30' });
  const orb = document.createElement('span');
  orb.className = 'orb';
  orb.innerHTML = '<i class="core"><b></b><b></b><b></b></i>';
  Object.assign(orb.style, { position: 'absolute', inset: '0', margin: '0' });
  orb.style.setProperty('--s', `${W}px`);
  ghost.append(orb);
  appEl().append(ghost);
  handOrb(fromEl, orb); // the stand-in is the source orb, dot for dot
  hide(fromEl); hide(toEl);
  const { c, d } = arc(a, b);
  const s0 = a.w / W, s1 = b.w / W, N = 24, frames = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, v = 1 - u;
    const x = v * v * a.x + 2 * v * u * c.x + u * u * b.x - a.x, y = v * v * a.y + 2 * v * u * c.y + u * u * b.y - a.y;
    frames.push({ offset: u, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(s0 + (s1 - s0) * u).toFixed(4)})` });
  }
  const duration = Math.round(Math.max(380, Math.min(520, 340 + d * 0.45)));
  ghost.style.willChange = 'transform';
  const fly = ghost.animate(frames, { duration, delay, easing: EASE, fill: 'both' });
  return new Promise(res => {
    const land = () => {
      handOrb(orb, toEl);
      show(toEl); show(fromEl); // (the source's screen has gone by now)
      ghost.remove(); // (the same frame: the target takes over exactly where the stand-in ends)
      toEl.animate([{ scale: '1 1' }, { scale: '1.05 0.95', offset: 0.35 }, { scale: '1 1' }], { duration: 230, easing: 'cubic-bezier(.3,.6,.3,1)' });
      onland?.();
      res();
    };
    fly.onfinish = land;
    fly.oncancel = () => { ghost.remove(); show(toEl); show(fromEl); res(); };
  });
}

export function recoil(box, point) {
  if (!box || reduced()) return;
  const r = box.getBoundingClientRect(), a = appEl().getBoundingClientRect();
  const ox = point ? point.x - (r.left - a.left) : r.width / 2, oy = point ? point.y - (r.top - a.top) : r.height / 2;
  box.style.transformOrigin = `${ox.toFixed(0)}px ${oy.toFixed(0)}px`;
  const k = box.animate([{ scale: '1' }, { scale: '0.97', offset: 0.2 }, { scale: '1.008', offset: 0.62 }, { scale: '1' }],
    { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)' });
  box.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.2)', offset: 0.18 }, { filter: 'brightness(1)' }], { duration: 420, easing: 'ease-out' });
  k.onfinish = k.oncancel = () => { box.style.transformOrigin = ''; };
}

// content leaving (100 ms, settling back a touch) and arriving (220 ms from 60 ms, rising 12 px);
// reduced motion: 150 ms cross-fades
export const fadeOut = (el, { scale = 0.985 } = {}) => el?.animate(reduced()
  ? [{ opacity: 1 }, { opacity: 0 }]
  : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `scale(${scale})` }], { duration: reduced() ? 150 : 100, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
export const fadeIn = (el, { delay = 60, rise = 12, duration = 220 } = {}) => el?.animate(reduced()
  ? [{ opacity: 0 }, { opacity: 1 }]
  : [{ opacity: 0, transform: `translateY(${rise}px)` }, { opacity: 1, transform: 'none' }], { duration: reduced() ? 150 : duration, delay: reduced() ? 0 : delay, easing: EASE, fill: 'backwards' });
