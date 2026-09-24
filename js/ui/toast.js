// The toast uses the intent-card surface: icon, what happened, optional Undo, countdown bar.
import { $, esc } from './dom.js';
import { I } from './icons.js';

let timer = 0;

export function toast({ title, sub = '', action = null, onAction = null, ms = 4000, error = false }) {
  const el = $('#toast');
  clearTimeout(timer);
  el.classList.remove('show');
  el.classList.toggle('err', error);
  el.style.setProperty('--ms', ms + 'ms');
  el.innerHTML = `<div class="ic">${error ? I.alert : I.check}</div>
    <div><b>${title}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    ${action ? `<button class="undo" type="button">${esc(action)}</button>` : '<span></span>'}
    <span class="bar"></span>`;
  if (action) el.querySelector('.undo').addEventListener('click', () => { hideToast(); onAction?.(); }, { once: true });
  void el.offsetWidth; // restart the bar animation
  el.classList.add('show');
  timer = setTimeout(hideToast, ms);
}

export function hideToast() {
  clearTimeout(timer);
  $('#toast').classList.remove('show');
}
