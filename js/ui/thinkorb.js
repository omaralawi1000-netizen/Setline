// A thinking orb on a canvas (geometry in ../orbs.js, the thinking-orbs port). As in the original:
// one shared clock (performance.now) keeps it in phase however often the thread redraws, it paints
// only while on screen (IntersectionObserver) and while the tab is visible, device pixels capped at
// 2×, plain 2D arcs (no filters). Reduced motion, or the app's motion set to off, shows one still,
// representative frame. Setline adds a short crossfade when the state changes, so the orb turns
// from one verb into the next instead of cutting.
import { orbFrame, resolvePreset, paintDots } from '../orbs.js';
import { token } from './fx.js';

const still = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// The theme's light accent as the ink tint (the library's `color` prop): depth still reads as the
// ramp on it, and it follows the theme.
function accentTint() {
  const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--accent-hi').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function thinkOrb(canvas, { size = 20, state = 'breathing', label = '' } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(size * dpr);
  Object.assign(canvas.style, { width: `${size}px`, height: `${size}px` });
  canvas.setAttribute('role', 'img');
  if (label) canvas.setAttribute('aria-label', label);
  const ctx = canvas.getContext('2d');
  const tint = accentTint();
  const fade = token('--m-slow');
  let cur = state, prev = null, since = 0, raf = 0, running = false, onScreen = true;

  const paint = now => {
    const t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const k = prev ? Math.min(1, (now - since) / fade) : 1;
    if (prev && k < 1) paintDots(ctx, orbFrame(prev, size, t * resolvePreset(prev, size).speed).dots, { tint, alpha: 1 - k });
    else prev = null;
    paintDots(ctx, orbFrame(cur, size, (still() ? 0.6 : t * resolvePreset(cur, size).speed)).dots, { tint, alpha: k });
  };
  const loop = now => { paint(now); if (running) raf = requestAnimationFrame(loop); };
  const start = () => {
    if (running || still() || !onScreen || document.visibilityState === 'hidden') return;
    running = true;
    raf = requestAnimationFrame(loop);
  };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) start(); else stop(); }) : null;
  io?.observe(canvas);
  const onVis = () => (document.visibilityState === 'hidden' ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  paint(performance.now()); // at least one frame, even offscreen or still
  start();

  return {
    set(next, nextLabel) {
      if (nextLabel) canvas.setAttribute('aria-label', nextLabel);
      if (next === cur) return;
      if (!still()) { prev = cur; since = performance.now(); }
      cur = next;
      if (!running) paint(performance.now());
    },
    destroy() { stop(); io?.disconnect(); document.removeEventListener('visibilitychange', onVis); }
  };
}
