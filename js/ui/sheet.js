// Bottom sheets. Each open sheet owns a history entry so Android back closes it.
import { $ } from './dom.js';

const stack = [];
const waiting = [];   // resolvers for history.back() calls we triggered

export const sheetOpen = () => stack.length > 0;

// render(body, api) fills the sheet. api = {close, replace}.
export function openSheet(render, { onClose = null, label = '' } = {}) {
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
    replace: (next, opts = {}) => { entry.onClose = opts.onClose ?? null; fill(next); }
  };
  // Each fill gets a fresh container, so listeners from the previous content go with it.
  function fill(fn) {
    el.innerHTML = '<div class="grab" aria-hidden="true"></div>';
    el.style.height = '';
    const box = document.createElement('div');
    box.className = 'sin';
    el.append(box);
    fn(box, api);
    const f = box.querySelector('[autofocus]');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  }
  fill(render);
  scrim.addEventListener('click', () => closeTop());
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('show'); el.classList.add('show'); }));
  return api;
}

function dismiss(entry) {
  entry.el.classList.remove('show');
  entry.scrim.classList.remove('show');
  const kill = () => { entry.el.remove(); entry.scrim.remove(); };
  entry.el.addEventListener('transitionend', kill, { once: true });
  setTimeout(kill, 600);
  entry.onClose?.();
}

// Close the top sheet from the UI. Resolves once history has settled.
export function closeTop() {
  const entry = stack.pop();
  if (!entry) return Promise.resolve();
  dismiss(entry);
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
