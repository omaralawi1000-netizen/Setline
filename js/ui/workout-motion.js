// Motion for the active workout screen: button presses, the set list (rows entering, moving,
// leaving and undone) and the set-saved toast. A logged row's own landing is CSS (.set.fresh in
// app.css, on the same expressive spring from css/motion.css), because it has to survive the
// screen redrawing mid-animation. View only: reads the DOM that renderWorkout() wrote, never the
// workout data. Every animation uses js/motion-tokens.js.
import { animate, stagger } from '../vendor/motion.js';
import { presets, reducedMotion } from '../motion-tokens.js';

const { tap, fade, expressive } = presets;
const base = presets.default;
const LIVE = 'wk-live'; // on #s-workout while it shows a workout in progress

// ---------- presses: scale down a little, spring back ----------

const PRESS = 'button, [role="button"]';
const NO_PRESS = '.sw .set, :disabled, [aria-disabled="true"]'; // set rows swipe sideways instead
let pressed = null;

function release() {
  if (!pressed) return;
  const { el } = pressed;
  pressed = null;
  animate(el, { scale: 1 }, tap);
}

export function initWorkoutMotion(root) {
  root.addEventListener('pointerdown', e => {
    if (e.button > 0 || !root.classList.contains(LIVE) || reducedMotion()) return;
    const el = e.target.closest(PRESS);
    if (!el || !root.contains(el) || el.matches(NO_PRESS)) return;
    release();
    pressed = { el, x: e.clientX, y: e.clientY };
    animate(el, { scale: 0.96 }, tap);
  }, { passive: true });
  // a press that turns into a scroll or a swipe lets go
  root.addEventListener('pointermove', e => {
    if (pressed && (Math.abs(e.clientX - pressed.x) > 10 || Math.abs(e.clientY - pressed.y) > 10)) release();
  }, { passive: true });
  root.addEventListener('pointerup', release, { passive: true });
  root.addEventListener('pointercancel', release, { passive: true });
  root.addEventListener('scroll', release, { passive: true });
}

// Marks the screen as the live workout (presses, and CSS that leaves :active squish to Motion).
export function markLive(root, live) {
  root.classList.toggle(LIVE, live);
}

// ---------- the set list ----------
// renderWorkout() replaces the whole screen on every change, so before it does, remember where
// each row was (and whether it was done); afterwards, animate the difference. One change can
// render twice in a row (logging does), so the first picture of a frame is kept and the
// difference is animated once, just before that frame paints.

let before = null; // null: nothing remembered yet this frame; false: there was no list
let queued = 0;

export function rememberSets(root) {
  if (before !== null) return;
  const list = root.querySelector('#sets');
  before = !!list && {
    ex: list.dataset.ex,
    rows: new Map([...list.children].map(li => [li.dataset.set, {
      el: li, r: li.getBoundingClientRect(), done: !!li.querySelector('.set.done'), gone: li.classList.contains('gone')
    }]))
  };
}

const rise = (el, i, n) => {
  const delay = stagger(0.04)(i, n);
  return animate(el, { opacity: [0, 1], translate: ['0 10px', '0 0'] }, { ...base, delay, opacity: { ...fade, delay } });
};

// a row that's gone stays where it was as a copy and fades away while the others close the gap
// (in a layer above the screen, so another render of the screen can't cut it short; the layer is
// added to the app once, so the app's own child watchers aren't woken for every row)
let layer = null;
function leave(old) {
  const g = old.el;
  if (!layer?.isConnected) {
    layer = document.createElement('div');
    layer.className = 'wkfx';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: '2', pointerEvents: 'none' });
    document.getElementById('app').appendChild(layer);
  }
  const host = layer.getBoundingClientRect();
  Object.assign(g.style, {
    position: 'absolute', margin: '0',
    left: `${old.r.left - host.left}px`, top: `${old.r.top - host.top}px`,
    width: `${old.r.width}px`, height: `${old.r.height}px`
  });
  g.inert = true;
  layer.appendChild(g);
  animate(g, { opacity: 0, scale: 0.96 }, { ...base, opacity: fade }).finished.then(() => g.remove(), () => g.remove());
}

export function animateSets(root) {
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    const prev = before || null;
    before = null;
    diffSets(root, prev);
  });
}

function diffSets(root, prev) {
  const list = root.querySelector('#sets');
  if (!list || reducedMotion()) return;
  const rows = [...list.children];
  // a new exercise, or arriving on the screen: the rows come in one after another
  if (!prev || prev.ex !== list.dataset.ex || root.classList.contains('enter')) {
    rows.forEach((li, i) => rise(li, i, rows.length));
    return;
  }
  const added = rows.filter(li => !prev.rows.has(li.dataset.set));
  for (const li of rows) {
    const old = prev.rows.get(li.dataset.set);
    const done = !!li.querySelector('.set.done');
    if (!old) continue;
    const dy = old.r.top - li.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) animate(li, { translate: [`0 ${dy}px`, '0 0'] }, base);
    if (!done && old.done) { // undone: the row settles back to planned
      const row = li.querySelector('.set');
      if (row) animate(row, { opacity: [0.4, 1], scale: [0.97, 1] }, { ...base, opacity: fade });
    }
  }
  const fresh = added.filter(li => !li.querySelector('.set.fresh')); // a just-logged row lands by itself
  fresh.forEach((li, i) => rise(li, i, fresh.length));
  const now = new Set(rows.map(li => li.dataset.set));
  for (const [id, old] of prev.rows) if (!now.has(id) && !old.gone) leave(old); // swiped rows already left
}

// ---------- the set-saved confirmation: the toast springs up ----------

export function springToast() {
  const el = document.getElementById('toast');
  if (!el?.classList.contains('show') || reducedMotion()) return;
  el.style.transition = 'none'; // the spring replaces the CSS entrance
  const clear = () => { for (const p of ['transition', 'transform', 'opacity']) el.style.removeProperty(p); };
  animate(el, { transform: ['translateY(18px) scale(.96)', 'none'], opacity: [0, 1] }, { ...expressive, opacity: fade }).finished.then(clear, clear);
}
