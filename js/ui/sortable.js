// Drag to reorder, the same everywhere (routine exercises, the workout's exercises, Settings sections).
// Grab the pull tab (or hold a row still for a moment) and drag: the row lifts, the others slide out of
// the way, the list scrolls by itself near the top or bottom, and on letting go the row settles into
// its slot before onMove(from, to) redraws the list. Only transform moves.
import { haptic } from '../haptics.js';
import { onFrame } from './frame.js';

const HOLD_MS = 320, EDGE = 72;
const still = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const scroller = el => { for (let n = el?.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return null; };

// root: where to listen; item: selector of a row; handle: selector of its pull tab
export function sortable(root, { item, handle, onMove, hold = true }) {
  let d = null, pending = null;

  const start = (row, e) => {
    const rows = [...row.parentElement.querySelectorAll(`:scope > ${item}`)];
    const from = rows.indexOf(row);
    if (from < 0) return;
    const sc = scroller(row);
    d = { row, rows, from, to: from, y0: e.clientY, y: e.clientY, id: e.pointerId, sc, top0: sc?.scrollTop || 0, raf: 0,
      rects: rows.map(r => { const b = r.getBoundingClientRect(); return { top: b.top, h: b.height }; }) };
    d.gap = rows.length > 1 ? Math.max(0, d.rects[1].top - (d.rects[0].top + d.rects[0].h)) : 0;
    row.classList.add('lifted');
    root.classList.add('sorting');
    rows.forEach(r => { if (r !== row) r.classList.add('shifting'); });
    try { row.setPointerCapture?.(e.pointerId); } catch {}
    haptic('tap');
    d.raf = onFrame(tick);
  };

  const place = () => {
    const scrolled = (d.sc?.scrollTop || 0) - d.top0, dy = d.y - d.y0 + scrolled;
    d.row.style.transform = `translateY(${dy}px) scale(1.02)`;
    const r = d.rects[d.from], mid = r.top + r.h / 2 + dy;
    let to = d.from;
    d.rects.forEach((q, k) => {
      if (k < d.from && mid < q.top + q.h / 2) to = Math.min(to, k);
      if (k > d.from && mid > q.top + q.h / 2) to = Math.max(to, k);
    });
    if (to !== d.to) {
      d.to = to;
      const h = r.h + d.gap;
      d.rows.forEach((x, k) => {
        if (x === d.row) return;
        const shift = d.from < to && k > d.from && k <= to ? -h : d.from > to && k < d.from && k >= to ? h : 0;
        x.style.transform = shift ? `translateY(${shift}px)` : '';
      });
      haptic('tick');
    }
  };

  // near the top or bottom of the list's scroller, it scrolls on its own
  const tick = () => {
    if (!d) return;
    if (d.sc) {
      const b = d.sc.getBoundingClientRect();
      const v = d.y < b.top + EDGE ? -(b.top + EDGE - d.y) : d.y > b.bottom - EDGE ? d.y - (b.bottom - EDGE) : 0;
      if (v) { d.sc.scrollTop += Math.max(-18, Math.min(18, v * 0.25)); place(); }
    }
  };

  const finish = cancel => {
    if (!d) return;
    const x = d;
    d = null;
    x.raf?.();
    const to = cancel ? x.from : x.to;
    // the row settles into its slot, then the list is drawn in its new order
    const slot = to === x.from ? 0 : (to > x.from ? 1 : -1) * x.rects.slice(Math.min(x.from, to) + (to > x.from ? 1 : 0), Math.max(x.from, to) + (to > x.from ? 1 : 0)).reduce((a, q) => a + q.h + x.gap, 0);
    x.row.classList.remove('lifted');
    x.row.classList.add('settling');
    x.row.style.transform = `translateY(${slot}px)`;
    haptic('tap');
    const done = () => {
      root.classList.remove('sorting');
      x.rows.forEach(r => { r.classList.remove('shifting', 'settling'); r.style.transform = ''; });
      if (to !== x.from) onMove(x.from, to);
    };
    if (still()) done(); else setTimeout(done, 200);
  };

  root.addEventListener('pointerdown', e => {
    if (d || e.button > 0) return;
    const row = e.target.closest(item);
    if (!row || !root.contains(row)) return;
    if (e.target.closest(handle)) { e.preventDefault(); start(row, e); return; }
    if (!hold || e.target.closest('button, input, select, textarea, a, .toggle')) return;
    // hold a row still for a moment to pick it up
    pending = { row, x: e.clientX, y: e.clientY, id: e.pointerId, timer: setTimeout(() => { if (pending?.row === row) { const p = pending; pending = null; start(row, { clientY: p.y, pointerId: p.id }); } }, HOLD_MS) };
  });
  root.addEventListener('pointermove', e => {
    if (pending && e.pointerId === pending.id && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 8) { clearTimeout(pending.timer); pending = null; }
    if (!d || e.pointerId !== d.id) return;
    d.y = e.clientY;
    place();
  });
  // once a row is up, the page doesn't scroll under the finger (the list scrolls itself at the edges)
  root.addEventListener('touchmove', e => { if (d) e.preventDefault(); }, { passive: false });
  const up = e => { if (pending && e.pointerId === pending.id) { clearTimeout(pending.timer); pending = null; } if (d && e.pointerId === d.id) finish(e.type === 'pointercancel'); };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('contextmenu', e => { if (d || pending) e.preventDefault(); });
}

// The pull tab
export const GRIP = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
