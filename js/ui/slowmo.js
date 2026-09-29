// Dev only: ?slowmo=N runs the app N times slower, so a transition can be watched (or filmed) frame by
// frame. Everything that tells time is slowed together, or the choreography would come apart:
// performance.now(), the time frames hand out (so js/ui/frame.js and every loop on it), and timers
// (setTimeout / setInterval wait N times longer). CSS transitions, keyframes and el.animate() are
// slowed by the browser's own playback rate: scripts/choreo.mjs sets it through the DevTools protocol
// (with &cdp=1); on the phone this page sets each animation's rate itself.
const n = +new URLSearchParams(location.search).get('slowmo');
export const SLOWMO = n > 1 ? Math.min(20, n) : 1;

if (SLOWMO > 1) {
  const k = 1 / SLOWMO;
  const realNow = performance.now.bind(performance), base = realNow();
  const slow = t => base + (t - base) * k;
  performance.now = () => slow(realNow());
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = fn => raf(t => fn(slow(t)));
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => st(fn, ms * SLOWMO, ...a);
  window.setInterval = (fn, ms = 0, ...a) => si(fn, ms * SLOWMO, ...a);
  if (!/[?&]cdp=1\b/.test(location.search)) {
    const sweep = () => { for (const a of document.getAnimations()) if (a.playbackRate === 1) a.playbackRate = k; raf(sweep); };
    raf(sweep);
  }
  console.info(`[slowmo] ${SLOWMO}× slower`);
}
