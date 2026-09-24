// The phone's own bars: the status bar takes the colour of the app's top edge (darker under a sheet
// or the voice layer), and soft blurred edges fade in at the top and bottom once content scrolls under them.
import * as store from '../store.js';

export const DIM = '#07080B';
// The top edge (and so the status bar) is the background with a touch of the theme's glow, so the
// glow seems to run on under the status bar instead of stopping in a dark band.
const hex = c => { const m = /^#?([\da-f]{6})$/i.exec(String(c).trim()); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
export function edgeColor() {
  const root = document.documentElement, cs = getComputedStyle(root);
  const bg = hex(cs.getPropertyValue('--bg')) || [13, 15, 21], glow = hex(cs.getPropertyValue('--amb1'));
  const k = root.dataset.glow === 'off' || !glow ? 0 : root.dataset.glow === 'soft' ? 0.07 : 0.14;
  const c = bg.map((v, i) => Math.round(v + ((glow?.[i] ?? v) - v) * k));
  const out = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  root.style.setProperty('--edge', out);
  return out;
}
const edge = () => edgeColor();
let repaint = () => {};
export const refreshChrome = () => repaint();

export function initChrome() {
  const app = document.getElementById('app');
  const metas = () => document.querySelectorAll('meta[name=theme-color]');
  let color = '';
  const paint = () => {
    const dim = app.classList.contains('voice') || !!app.querySelector(':scope > .scrim.show');
    const next = dim ? DIM : edge();
    if (next !== color) { color = next; for (const m of metas()) m.setAttribute('content', next); }
  };
  new MutationObserver(paint).observe(app, { attributes: true, attributeFilter: ['class'], childList: true, subtree: false });
  // a sheet's scrim gets .show a frame after it's added
  app.addEventListener('transitionrun', e => { if (e.target.classList?.contains('scrim')) paint(); });
  app.addEventListener('transitionend', e => { if (e.target.classList?.contains('scrim')) paint(); });
  let raf = 0, lastY = 0;
  const onScroll = e => {
    const s = e.target;
    if (!s.classList?.contains('screen') || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      app.classList.toggle('under-top', s.scrollTop > 6);
      app.classList.toggle('under-bottom', s.scrollHeight - s.clientHeight - s.scrollTop > 6);
      const y = s.scrollTop, dy = y - lastY;
      const atEnd = s.scrollHeight - s.clientHeight - y < 24; // the end of the page: the bar opens again
      if (atEnd && app.classList.contains('compact')) { app.classList.remove('compact'); lastY = y; }
      else if (Math.abs(dy) > 14) { app.classList.toggle('compact', dy > 0 && y > 90 && !atEnd && !app.classList.contains('coaching')); lastY = y; }
    });
  };
  app.addEventListener('scroll', onScroll, { capture: true, passive: true });
  // a new screen starts at its own scroll position
  app.addEventListener('screenchange', () => {
    const s = app.querySelector('.screen.on');
    app.classList.remove('compact'); lastY = s?.scrollTop || 0;
    app.classList.toggle('under-top', !!s && s.scrollTop > 6);
    app.classList.toggle('under-bottom', !!s && s.scrollHeight - s.clientHeight - s.scrollTop > 6);
  });
  // tapping the small pill opens the dock again (the orb still talks straight away)
  const dock = document.getElementById('dock');
  dock?.addEventListener('click', e => {
    if (!app.classList.contains('compact') || e.target.closest('.orbbtn')) return;
    e.preventDefault(); e.stopPropagation();
    app.classList.remove('compact');
  }, true);
  // the indicator is placed from the laid-out tabs: place it again once the dock has opened
  dock?.addEventListener('transitionend', e => { if (e.target === dock && e.propertyName === 'grid-template-columns' && !app.classList.contains('compact')) app.dispatchEvent(new Event('dockopen')); });
  // Full screen (Settings): the browser only allows it from a tap, so ask on the next one, and
  // again after coming back to the app (Android leaves full screen when the app is left).
  const wantFull = () => {
    const s = store.state.settings;
    return s.fullscreen && !document.fullscreenElement && document.fullscreenEnabled;
  };
  const goFull = () => { if (wantFull()) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {}); };
  document.addEventListener('pointerup', goFull, { capture: true, passive: true });
  store.subscribe(r => {
    if (r !== 'settings') return;
    if (!store.state.settings.fullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else goFull(); // switched on: still inside the tap
  });
  repaint = paint;
  paint();
}
