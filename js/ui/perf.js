// Dev-only frame meter: open the app once with ?perf=1 (it's remembered, ?perf=0 turns it off) and a
// tiny counter sits in the top-left corner: frames per second over the last second, how many frames
// took longer than 50 ms, and long tasks (main-thread work over 50 ms) since it started. Hidden by
// default; never shown otherwise.
import { onFrame } from './frame.js';

export function initPerf() {
  const q = new URLSearchParams(location.search).get('perf');
  try {
    if (q === '1') localStorage.setItem('setline.perf', '1');
    if (q === '0') localStorage.removeItem('setline.perf');
    if (localStorage.getItem('setline.perf') !== '1') return;
  } catch { if (q !== '1') return; }
  const box = document.createElement('div');
  box.id = 'perfmeter';
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', left: '6px', top: 'calc(env(safe-area-inset-top) + 4px)', zIndex: 99999, pointerEvents: 'none',
    font: '600 11px/1.3 ui-monospace, monospace', color: '#9ff5c8', background: 'rgba(0,0,0,.72)', padding: '3px 6px', borderRadius: '6px', whiteSpace: 'pre'
  });
  document.body.appendChild(box);
  let frames = 0, long = 0, tasks = 0, since = performance.now(), prev = 0, fps = 0, worst = 0;
  try { new PerformanceObserver(list => { tasks += list.getEntries().length; }).observe({ type: 'longtask', buffered: false }); } catch {}
  onFrame(now => {
    frames++;
    if (prev) { const d = now - prev; if (d > 50) long++; if (d > worst) worst = d; }
    prev = now;
    if (now - since >= 1000) {
      fps = Math.round((frames * 1000) / (now - since));
      box.textContent = `${fps} fps  worst ${Math.round(worst)}ms\nlong frames ${long}  long tasks ${tasks}`;
      frames = 0; worst = 0; since = now;
    }
  });
  document.addEventListener('visibilitychange', () => { prev = 0; });
}
