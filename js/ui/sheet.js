// Bottom sheets. Each open sheet owns a history entry so Android back closes it.
import { $ } from './dom.js';

const stack = [];
const waiting = [];   // resolvers for history.back() calls we triggered

export const sheetOpen = () => stack.length > 0;

// render(body, api) fills the sheet. api = {close, replace}.
import { haptic } from '../haptics.js';
export function openSheet(render, { onClose = null, label = '' } = {}) {
  haptic('tick');
  const app = $('#app');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const el = document.createElement('div');
  el.className = 'sheet glass';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (label) el.setAttribute('aria-label', label);
  app.append(scrim, el);
  const entry = { el, scrim, onClose };
  stack.push(entry);
  history.pushState({ ...(history.state || {}), sheet: stack.length }, '');

  const api = {
    sheet: el,
    close: () => closeTop(),
    // swap contents without touching history (confirm chains)
    replace: (next, opts = {}) => { entry.onClose = opts.onClose ?? null; fill(next, true); }
  };
  // Each fill gets a fresh container, so listeners from the previous content go with it.
  function fill(fn, swap = false) {
    el.innerHTML = '<div class="grab" aria-hidden="true"></div>';
    el.style.height = '';
    const box = document.createElement('div');
    box.className = swap ? 'sin swap' : 'sin'; // new content in the same sheet fades in
    el.append(box);
    fn(box, api);
    const f = box.querySelector('[autofocus]');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  }
  fill(render);
  scrim.addEventListener('click', () => closeTop());
  dragToClose(el, scrim, entry);
  app.classList.add('sheeting');
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show', 'opening'); }));
  setTimeout(() => el.classList.remove('opening'), 900); // its contents cascade in once, on the way up
  // the glass blur switches on once the sheet has stopped moving (a moving blur flickers on Android)
  el.addEventListener('transitionend', e => { if (e.target === el && e.propertyName === 'transform' && el.classList.contains('show') && !el.classList.contains('dragging')) el.classList.add('settled'); });
  return api;
}

// Swipe the sheet down to close it, from anywhere on it: once its content is scrolled to the top a
// downward swipe moves the sheet itself (1:1 with the finger), and it closes on a flick or past a
// third of the way; otherwise it springs back. A mouse can drag it by the top edge.
const SKIP_DRAG = 'input, textarea, select, [contenteditable], .nodrag';
function scrollerIn(el, target) {
  for (let n = target; n && n !== el; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
}
function dragToClose(el, scrim, entry) {
  let d = null;
  const move = dy => {
    el.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / (el.offsetHeight * 0.9)));
  };
  const finish = () => {
    if (!d?.on) { d = null; return; }
    const { dy, v } = d;
    d = null;
    el.classList.remove('dragging');
    const close = dy > el.offsetHeight / 3 || (v > 0.45 && dy > 24);
    el.classList.add(close ? 'flung' : 'snap'); // a flick leaves at the finger's speed; a let-go springs back
    setTimeout(() => el.classList.remove('flung', 'snap'), 450);
    el.style.transform = '';
    scrim.style.opacity = '';
    if (close && stack[stack.length - 1] === entry) closeTop();
    else if (!close) el.classList.add('settled');
  };
  el.addEventListener('touchstart', e => {
    if (e.touches.length > 1 || e.target.closest(SKIP_DRAG) || stack[stack.length - 1] !== entry) { d = null; return; }
    const t = e.touches[0];
    d = { x: t.clientX, y: t.clientY, dy: 0, v: 0, t: performance.now(), on: false, off: false, scroller: scrollerIn(el, e.target) };
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!d || d.off) return;
    const t = e.touches[0], dx = t.clientX - d.x, dy = t.clientY - d.y;
    if (!d.on) {
      // decided on the first movement (after that Android has started scrolling and won't let go):
      // only a downward, mostly vertical swipe with the content already at its top moves the sheet
      if (dy <= 0 || Math.abs(dx) > dy || (d.scroller && d.scroller.scrollTop > 0)) { d.off = true; return; }
      d.on = true; d.y0 = d.y;
      el.classList.remove('settled');
      el.classList.add('dragging');
    }
    e.preventDefault(); // the swipe is ours now, not the list's
    const now = performance.now(), ny = Math.max(0, t.clientY - d.y0);
    d.v = (ny - d.dy) / Math.max(1, now - d.t); d.dy = ny; d.t = now;
    move(ny);
  }, { passive: false });
  el.addEventListener('touchend', finish);
  el.addEventListener('touchcancel', finish);
  // mouse: by the top edge
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button > 0 || e.target.closest('input,button,select,a,.sbody')) return;
    if (e.clientY - el.getBoundingClientRect().top > 72) return;
    d = { y: e.clientY, y0: e.clientY, t: performance.now(), dy: 0, v: 0, on: true, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    el.classList.remove('settled');
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!d?.on || e.pointerId !== d.id) return;
    const now = performance.now(), ny = Math.max(0, e.clientY - d.y0);
    d.v = (ny - d.dy) / Math.max(1, now - d.t); d.dy = ny; d.t = now;
    move(ny);
  });
  el.addEventListener('pointerup', e => { if (d?.id === e.pointerId) finish(); });
}

function dismiss(entry) {
  entry.el.classList.remove('show', 'settled');
  if (!stack.length) $('#app').classList.remove('sheeting'); // the page comes forward as the sheet leaves
  entry.scrim.classList.remove('show');
  const kill = () => { entry.el.remove(); entry.scrim.remove(); };
  // only the sheet's own slide counts; a button's transition inside it would cut the slide short
  const onEnd = e => { if (e.target === entry.el && e.propertyName === 'transform') { entry.el.removeEventListener('transitionend', onEnd); kill(); } };
  entry.el.addEventListener('transitionend', onEnd);
  setTimeout(kill, 500);
  entry.onClose?.();
}

// Close the top sheet from the UI. Resolves once history has settled.
export function closeTop() {
  const entry = stack.pop();
  if (!entry) return Promise.resolve();
  dismiss(entry);
  if (!history.state?.sheet) return Promise.resolve(); // never step back past our own entry
  return new Promise(res => { waiting.push(res); history.back(); });
}

export async function closeAll() {
  while (stack.length) await closeTop();
}

// Call from popstate. Returns true if a sheet consumed the event.
export function handlePop() {
  if (waiting.length) { waiting.shift()(); return true; }
  const entry = stack.pop();
  if (entry) { dismiss(entry); return true; }
  return false;
}
