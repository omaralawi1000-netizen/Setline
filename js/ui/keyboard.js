// The keyboard and the Coach: when it comes up (or goes), the message box and the conversation move
// with it, smoothly and together, and the conversation keeps to its latest message. Never a jump.
//
// On Android Chrome the keyboard is told to lie over the page while the message box is being typed in
// (VirtualKeyboard.overlaysContent), so the page keeps its size and says, as the keyboard starts to
// move, how tall it will be (geometrychange): the box glides up by that much, in step with it, and the
// thread's newest messages glide with it (the room they need is added below them at once, and they're
// moved back to where they were and let go). Elsewhere (no such API, or the page resized anyway) the
// same glide runs from where things were a moment ago (a FLIP of the resize).
const MS = 280, EASE = 'cubic-bezier(.2,.8,.2,1)'; // (about the keyboard's own slide)

export function initKeyboard() {
  const app = document.getElementById('app'), box = document.getElementById('composer'), chat = document.getElementById('s-coach');
  const input = box?.querySelector('input');
  if (!app || !box || !chat || !input) return;
  const calm = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let kb = 0;
  // the conversation's newest messages on screen glide from where they were
  const glideThread = (before, dy) => {
    if (!dy || calm()) return;
    for (const [m, top] of before) {
      const d = top - m.getBoundingClientRect().top;
      if (Math.abs(d) > 1) m.animate([{ transform: `translateY(${d.toFixed(1)}px)` }, { transform: 'none' }], { duration: MS, easing: EASE });
    }
  };
  const visible = () => {
    const v = chat.getBoundingClientRect(), out = [];
    for (const m of chat.querySelectorAll('#thread > .msg')) { const r = m.getBoundingClientRect(); if (r.bottom > v.top && r.top < v.bottom) out.push([m, r.top]); }
    return out;
  };
  const atEnd = () => chat.scrollHeight - chat.clientHeight - chat.scrollTop < 90;
  // the keyboard is h px tall now (0: gone)
  const setKb = h => {
    h = Math.max(0, Math.round(h));
    if (h === kb) return;
    const coach = app.classList.contains('coaching');
    const before = coach ? visible() : [], end = atEnd();
    kb = h;
    app.style.setProperty('--kbh', h + 'px');
    app.classList.toggle('kbup', h > 0);
    if (!coach) return;
    // (the room goes in below the messages at once; the view stays on the newest one)
    if (end) chat.scrollTop = chat.scrollHeight;
    glideThread(before, 1);
  };
  app._setKb = setKb; // (for the frame checks: there's no keyboard in a test browser)

  const vk = navigator.virtualKeyboard;
  if (vk && 'overlaysContent' in vk) {
    const on = () => {
      vk.overlaysContent = true;
      // (a safety net: if this phone never says how tall its keyboard is, the page goes back to making
      // room for it itself, so the box is never left under it)
      clearTimeout(on.t);
      on.t = setTimeout(() => { if (!kb && document.activeElement === input && !vk.boundingRect?.height) vk.overlaysContent = false; }, 900);
    };
    input.addEventListener('pointerdown', on, { passive: true });
    input.addEventListener('focus', on);
    vk.addEventListener('geometrychange', () => {
      if (!vk.overlaysContent) return;
      setKb(vk.boundingRect?.height || 0);
      // once it has gone, the page goes back to making room for keyboards itself (every other field)
      if (!vk.boundingRect?.height && document.activeElement !== input) vk.overlaysContent = false;
    });
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input && !kb) vk.overlaysContent = false; }, 500));
    return;
  }
  // no VirtualKeyboard: the page resizes; the box and the thread glide from where they were instead of jumping
  let last = box.getBoundingClientRect().top, lastMsgs = [];
  const snap = () => { if (app.classList.contains('coaching')) { last = box.getBoundingClientRect().top; lastMsgs = visible(); } };
  input.addEventListener('focus', snap);
  input.addEventListener('pointerdown', snap, { passive: true });
  const onResize = () => {
    if (!app.classList.contains('coaching') || calm()) return snap();
    const now = box.getBoundingClientRect().top, d = last - now;
    if (Math.abs(d) > 40) {
      box.animate([{ transform: `translateY(${d.toFixed(1)}px)` }, { transform: 'none' }], { duration: MS, easing: EASE, composite: 'add' });
      if (atEnd()) chat.scrollTop = chat.scrollHeight;
      glideThread(lastMsgs, d);
    }
    snap();
  };
  addEventListener('resize', onResize);
  globalThis.visualViewport?.addEventListener('resize', onResize);
}
