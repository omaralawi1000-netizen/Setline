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
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); }));
  return api;
}

// Pull the sheet down by its top edge to close it.
function dragToClose(el, scrim, entry) {
  let d = null;
  el.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('input,button,select,a,.sbody')) return;
    if (e.clientY - el.getBoundingClientRect().top > 72) return;
    d = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!d || e.pointerId !== d.id) return;
    d.dy = Math.max(0, e.clientY - d.y);
    el.style.transform = `translateY(${d.dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - d.dy / 400));
  });
  const end = () => {
    if (!d) return;
    const v = d.dy / Math.max(1, performance.now() - d.t);
    const close = d.dy > 110 || (v > 0.6 && d.dy > 30);
    d = null;
    el.classList.remove('dragging');
    el.style.transform = '';
    scrim.style.opacity = '';
    if (close && stack[stack.length - 1] === entry) closeTop();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function dismiss(entry) {
  entry.el.classList.remove('show');
  entry.scrim.classList.remove('show');
  const kill = () => { entry.el.remove(); entry.scrim.remove(); if (!stack.length) $('#app').classList.remove('sheeting'); };
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
