// Bottom sheets. Each open sheet owns a history entry so Android back closes it.
import { $ } from './dom.js';
import { cssSpring, reducedMotion } from '../motion-tokens.js';

const stack = [];
const waiting = [];   // resolvers for history.back() calls we triggered

export const sheetOpen = () => stack.length > 0;

// iOS-style depth: while a sheet is up, the page behind (and the bar) sits a little smaller and lower,
// with rounded corners, as if lifted off the background. p = 1 is fully back, 0 is normal.
const DEPTH = [{ sel: '.screen.on', s: 0.93, y: 12 }, { sel: '#dock', s: 0.95, y: 8 }, { sel: '#minibar', s: 0.95, y: 8 }];
// the page settles back on the default spring (css/motion.css has the same curve)
const PANEL = cssSpring('default');
let depthEls = [];
function depth(p, ms = 0, ease = PANEL.easing) {
  const app = $('#app');
  const settle = ms > 0; // a real move (not a finger), even when reduced motion makes it instant
  if (ms && reducedMotion()) ms = 0; // reduced motion: the page just is where it goes
  if (p > 0 && !depthEls.length) depthEls = DEPTH.map(d => ({ ...d, el: app.querySelector(d.sel) })).filter(d => d.el);
  // on their own layers while a sheet is up, so following a finger only moves them (no redraw)
  if (p > 0) depthEls.forEach(d => { d.el.style.willChange = 'scale, translate'; if (d.sel === '.screen.on') d.el.style.borderRadius = '22px'; }); // a scroller clips to its own corners
  for (const d of depthEls) {
    const el = d.el;
    const to = { scale: String(1 - (1 - d.s) * p), translate: `0px ${(d.y * p).toFixed(1)}px` };
    if (!ms) { // following a finger: cheap, no style reads
      if (d.anim) { d.anim.cancel(); d.anim = null; }
      el.style.scale = to.scale; el.style.translate = to.translate; continue;
    }
    const cs = getComputedStyle(el);
    const from = { scale: cs.scale === 'none' ? '1' : cs.scale, translate: cs.translate === 'none' ? '0px 0px' : cs.translate };
    el.getAnimations().filter(a => a.id === 'depth').forEach(a => a.cancel());
    el.style.scale = ''; el.style.translate = '';
    const a = d.anim = el.animate([from, to], { duration: ms, easing: ease, fill: 'forwards' });
    a.id = 'depth';
  }
  if (p === 0 && settle) {
    const els = depthEls; depthEls = [];
    setTimeout(() => els.forEach(d => {
      if (depthEls.some(x => x.el === d.el)) return; // a new sheet took it back already
      d.el.getAnimations().filter(a => a.id === 'depth').forEach(a => a.cancel());
      d.el.style.borderRadius = ''; d.el.style.willChange = ''; d.el.style.scale = ''; d.el.style.translate = '';
    }), ms + 20);
  }
}

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
  if (stack.length === 1) requestAnimationFrame(() => requestAnimationFrame(() => depth(1, PANEL.duration)));
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
  const app = $('#app');
  const move = dy => {
    el.style.transform = `translateY(${dy}px)`;
    const p = Math.max(0, 1 - dy / el.offsetHeight);
    scrim.style.opacity = String(p);
    if (stack.length === 1) depth(p); // the page behind follows the finger back to full size
  };
  const finish = () => {
    if (!d?.on) { d = null; return; }
    const { dy, v } = d;
    d = null;
    el.classList.remove('dragging');
    const close = dy > el.offsetHeight / 3 || (v > 0.45 && dy > 24);
    if (!close && stack.length === 1) depth(1, PANEL.duration); // let go: the page settles back behind
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
  if (!stack.length) { $('#app').classList.remove('sheeting'); depth(0, entry.el.classList.contains('flung') ? 280 : 360, 'cubic-bezier(.2,.8,.2,1)'); } // the page comes forward as the sheet leaves
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
