// Instant touch feedback. Android delays :active while it decides whether a touch is a scroll,
// so quick taps often show nothing. This presses on pointerdown and springs back on release.
// Uses the separate `scale` property, so it never fights an element's own transform.

const SPRING = globalThis.CSS?.supports?.('transition-timing-function', 'linear(0, 1)')
  ? 'linear(0, .22 8%, .6 17%, 1.02 30%, 1.07 38%, 1.05 46%, 1 58%, .99 70%, 1)'
  : 'cubic-bezier(.34,1.56,.64,1)';
const SKIP = '.orbbtn, [data-o], .hold, .step, .sw .set, input, textarea, select, :disabled, [aria-disabled="true"]';
const TARGET = 'button, [data-act], .rmain, .hitem, .lift';

let cur = null; // {el, t}
const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// Smaller things squish more; a whole card only gives a little.
export const depthFor = (w, h) => { const size = Math.max(w, h); return size > 240 ? 0.985 : size > 120 ? 0.97 : size > 60 ? 0.95 : 0.92; };

function down(e) {
  if (e.button > 0 || reduced()) return;
  const el = e.target.closest?.(TARGET);
  if (!el || el.matches(SKIP) || el.closest('.ofloat')) return;
  const r = el.getBoundingClientRect();
  release(true);
  cur = { el, t: performance.now(), s: depthFor(r.width, r.height), x: e.clientX, y: e.clientY };
  el.getAnimations?.().forEach(a => { if (a.id === 'press') a.cancel(); });
  const a = el.animate([{ scale: 1 }, { scale: cur.s }], { duration: 90, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  a.id = 'press';
  cur.anim = a;
}

function release(now = false) {
  const c = cur;
  if (!c) return;
  cur = null;
  // hold the press a moment so even a flick of a tap is visible
  const wait = now ? 0 : Math.max(0, 70 - (performance.now() - c.t));
  setTimeout(() => {
    c.anim?.cancel();
    const back = c.el.animate([{ scale: c.s }, { scale: 1 }], { duration: 420, easing: SPRING });
    back.id = 'press';
  }, wait);
}

// a scroll that starts on a button isn't a press
function move(e) {
  if (!cur) return;
  if (Math.abs(e.clientX - cur.x) > 10 || Math.abs(e.clientY - cur.y) > 10) release(true);
}

export function initPress(root = document) {
  document.documentElement.classList.add('js-press');
  root.addEventListener('pointerdown', down, { passive: true });
  root.addEventListener('pointermove', move, { passive: true });
  root.addEventListener('pointerup', () => release(), { passive: true });
  root.addEventListener('pointercancel', () => release(true), { passive: true });
  addEventListener('scroll', () => release(true), { passive: true, capture: true });
}
