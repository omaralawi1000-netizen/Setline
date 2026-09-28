// One animation frame for everything that draws every frame (the orbs, the voice loop and its
// waveform, the Coach's streaming words and thread follow): a single requestAnimationFrame that runs
// only while something is subscribed and the page is visible. Each callback gets (now, dt in seconds).
//
//   const stop = onFrame((now, dt) => { … });   stop() unsubscribes
const subs = new Set();
let raf = 0, last = 0;

function frame(now) {
  raf = 0;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  for (const fn of [...subs]) {
    try { fn(now, dt); } catch (e) { console.error(e); }
  }
  if (subs.size && document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame);
  else last = 0;
}

export function onFrame(fn) {
  subs.add(fn);
  if (!raf && document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame);
  return () => { subs.delete(fn); };
}

// run fn once on the next shared frame (a DOM write batched with everything else)
export function nextFrame(fn) {
  const stop = onFrame(now => { stop(); fn(now); });
  return stop;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { cancelAnimationFrame(raf); raf = 0; last = 0; }
  else if (subs.size && !raf) raf = requestAnimationFrame(frame);
});

export const frameSubscribers = () => subs.size; // (for the ?perf=1 overlay)
