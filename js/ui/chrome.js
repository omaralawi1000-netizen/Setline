// The phone's own bars: the status bar takes the colour of the app's top edge (darker under a sheet
// or the voice layer), and soft blurred edges fade in at the top and bottom once content scrolls under them.
export const DIM = '#121220';
const edge = () => getComputedStyle(document.documentElement).getPropertyValue('--edge').trim() || '#24233F';
let repaint = () => {};
export const refreshChrome = () => repaint();

export function initChrome() {
  const app = document.getElementById('app');
  const meta = document.querySelector('meta[name=theme-color]');
  let color = '';
  const paint = () => {
    const dim = app.classList.contains('voice') || !!app.querySelector(':scope > .scrim.show');
    const next = dim ? DIM : edge();
    if (next !== color && meta) { color = next; meta.setAttribute('content', next); }
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
      if (Math.abs(dy) > 12) { app.classList.toggle('compact', dy > 0 && y > 80); lastY = y; }
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
  repaint = paint;
  paint();
}
