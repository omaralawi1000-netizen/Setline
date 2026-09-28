// The stage the voice and the Coach play on: one frost layer, one orb and the chat sheet.
//
// - The frost: one full-screen layer over Home (a constant blur, only its opacity changes); while it
//   shows, everything under it holds still and can't be touched.
// - The orb: exactly one element. It sits in a slot (the dock, the message box) and, to go anywhere
//   else, is lifted into a flier above the frost and moved by a spring from wherever it is to wherever
//   it's going (FLIP: measured where it is, then moved, never a second copy).
// - The chat: the Coach is a sheet over the frosted page. It is laid out and scrolled to the end
//   before it moves; it slides up (the message box with it) while the orb flies into the box, and
//   slides back down the same way. Every move can be reversed half-way and carries on from there.
import { spring, reducedMotion } from './spring.js';
import { refitOrb, setOrb } from './dotorb.js';
import { nextFrame } from './frame.js';
import { M, slowmo } from '../motion.config.js';

const app = () => document.getElementById('app');
const $ = s => document.querySelector(s);

// ---------- geometry ----------
// the page's size and a slot's centre from layout (transforms ignored: where it rests, not where it
// is mid-move); read before anything moves in a frame
// (measured at start-up and on resize, never for the first time in the middle of a move)
let size = null;
const measure = () => { size = { W: app().clientWidth, H: app().clientHeight }; };
addEventListener('resize', measure);
export const viewSize = () => size || (measure(), size);
export const warmStage = () => { measure(); theOrb(); };
export function restCentre(el) {
  const a = app();
  let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
  for (let n = el; n && n !== a; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}
function visualCentre(el) {
  const A = app().getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - A.left + r.width / 2, y: r.top - A.top + r.height / 2, w: r.width };
}

// ---------- the frost ----------
// The layer exists only while it shows: made when the frost comes up, removed once it has faded.
let freezeTimer = 0, frostEl = null, frostGone = 0;
function frostNode() {
  if (!frostEl) {
    frostEl = document.createElement('div');
    frostEl.className = 'frost';
    frostEl.id = 'frost';
    frostEl.setAttribute('aria-hidden', 'true');
    frostEl.innerHTML = '<i></i>';
  }
  if (!frostEl.isConnected) { const d = document.getElementById('dock'); if (d) d.after(frostEl); else app().append(frostEl); }
  return frostEl;
}
export function frost(on) {
  const a = app();
  if (a.classList.contains('frosted') === on) return;
  a.classList.toggle('frosted', on);
  clearTimeout(frostGone);
  if (on) { const f = frostNode(); nextFrame(() => { if (a.classList.contains('frosted')) f.classList.add('on'); }); }
  else if (frostEl) {
    frostEl.classList.remove('on');
    frostGone = setTimeout(() => { if (!a.classList.contains('frosted')) frostEl.remove(); }, (M.frostFadeMs + 80) * slowmo);
  }
  // what's under it stops moving once the frost is up and the moves have settled (pausing every
  // animation on the page restyles all of it: done while nothing moves, not in a move's first frame)
  clearTimeout(freezeTimer);
  if (on) freezeTimer = setTimeout(() => { if (a.classList.contains('frosted')) a.classList.add('frozen'); }, 520);
  else a.classList.remove('frozen');
  // the page under it can't be touched (it's frozen: see flow.css)
  for (const s of document.querySelectorAll('.screen.on:not(#s-coach), .screen.under')) s.inert = on;
}
export const frosted = () => app().classList.contains('frosted');

// ---------- the one orb ----------
let orbEl = null, flyEl = null, F = 60, flight = 0, home = 'dock';
const extra = { dy: 0, sx: 1, sy: 1 }; // what a finger adds on top of the spring (1:1, no lag)
const moveFns = new Set();
export const onOrbMove = fn => { moveFns.add(fn); return () => moveFns.delete(fn); };
const orbSpring = spring({ x: 0, y: 0, s: 1 }, { onUpdate: paintFly });
function paintFly(v) {
  if (!flyEl || orbEl?.parentElement !== flyEl) return;
  const sx = v.s * extra.sx, sy = v.s * extra.sy;
  // stretched toward the top: grows upward from its lower edge
  const lift = (sy - v.s) * F / 2;
  flyEl.style.transform = `translate3d(${(v.x - F / 2).toFixed(2)}px, ${(v.y + extra.dy - F / 2 - lift).toFixed(2)}px, 0) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  for (const fn of moveFns) fn(orbPos());
}
export const orbPos = () => ({ x: orbSpring.value.x, y: orbSpring.value.y + extra.dy, size: orbSpring.value.s * F });

export function theOrb() {
  if (orbEl) return orbEl;
  orbEl = document.createElement('span');
  orbEl.className = 'orb';
  orbEl.id = 'orb';
  orbEl.setAttribute('aria-hidden', 'true');
  orbEl.innerHTML = '<span class="olight"></span><i class="core"><b></b><b></b><b></b></i>';
  flyEl = document.createElement('div'); // (in the page only while the orb is in the air)
  flyEl.className = 'orbfly';
  flyEl.id = 'orbfly';
  flyEl.setAttribute('aria-hidden', 'true');
  return orbEl;
}
export const slots = { dock: () => $('#dock .orbbtn'), composer: () => $('#composer .corb') };
export const orbHome = () => (orbEl?.parentElement === flyEl ? 'flying' : home);

// Put the orb in its slot (after a rebuild of the dock or the message box, or when a flight lands).
export function seatOrb(name = home) {
  const o = theOrb(), s = slots[name]?.();
  if (!s) return false;
  flight++;
  home = name;
  extra.dy = 0; extra.sx = extra.sy = 1;
  o.style.removeProperty('--s');
  o.style.transform = '';
  if (o.parentElement !== s) s.append(o);
  flyEl.style.transform = '';
  flyEl.classList.remove('on');
  flyEl.remove();
  refitOrb(o);
  setOrb(o, null); // it works out what it's doing from where it sits again
  return true;
}

// Lift it into the flier at exactly the place and size it shows now. `want`: the biggest size it
// will fly to, so the canvas is drawn for that and only ever scaled down (sharp all the way).
function lift(want) {
  const o = theOrb();
  if (o.parentElement === flyEl) {
    if (want > F * 1.02) { const v = orbSpring.value; orbSpring.set({ s: (v.s * F) / want }); F = want; o.style.setProperty('--s', `${F}px`); refitOrb(o, F); }
    return;
  }
  const c = o.isConnected ? visualCentre(o) : { x: viewSize().W / 2, y: viewSize().H, w: 60 };
  F = Math.round(Math.max(c.w || 60, want || 0));
  o.style.setProperty('--s', `${F}px`);
  if (!flyEl.isConnected) app().append(flyEl);
  flyEl.append(o);
  flyEl.classList.add('on');
  refitOrb(o, F);
  extra.dy = 0; extra.sx = extra.sy = 1;
  orbSpring.set({ x: c.x, y: c.y, s: (c.w || F) / F });
}

// Fly to a target (read every frame, so it can ride on a moving sheet). Resolves true when it got
// there, false if another flight took over first.
export function flyOrb(target, { size: want = 0 } = {}) {
  lift(Math.max(want, target().size || 0));
  const mine = ++flight;
  return orbSpring.to({ x: () => target().x, y: () => target().y, s: () => target().size / F }).then(() => mine === flight);
}
// Fly into a slot and sit down in it. `offset` moves the slot's resting place (a sliding sheet).
export async function flyOrbTo(name, { offset = () => 0, size: want = 0 } = {}) {
  const s = slots[name]?.();
  if (!s) return false;
  const c = restCentre(s), w = innerSize(s);
  const ok = await flyOrb(() => ({ x: c.x, y: c.y + offset(), size: w }), { size: want });
  if (ok) seatOrb(name);
  return ok;
}
const innerSize = s => (s.matches('.corb') ? 42 : 60);
// the finger's share of the orb's movement, applied on top of the spring every frame (no lag)
export function orbGesture({ dy = 0, stretch = 0 } = {}) {
  extra.dy = dy; extra.sy = 1 + 0.06 * stretch; extra.sx = 1 - 0.03 * stretch;
  paintFly(orbSpring.value);
}
// fold the finger's offset into the spring, so the next move starts exactly where the orb is
export function orbSettleGesture() {
  const p = orbPos();
  extra.dy = 0; extra.sx = extra.sy = 1;
  orbSpring.set({ y: p.y });
}
export const orbFlying = () => orbSpring.running;

// ---------- the chat sheet ----------
let sheetSeq = 0;
const chat = { open: false, moving: false };
const sheetSpring = spring({ y: 0 }, { onUpdate: v => paintSheet(v.y) });
function paintSheet(y) {
  const t = Math.abs(y) < 0.5 ? '' : `translate3d(0, ${y.toFixed(2)}px, 0)`;
  const c = $('#s-coach'), box = $('#composer');
  if (c) c.style.transform = t;
  if (box) box.style.transform = t;
}
export const sheetY = () => sheetSpring.value.y;
export const chatMoving = () => chat.moving;

// Everything the Coach sheet needs before it moves: in place, laid out and at the end of the thread.
function prepareChat() {
  const c = $('#s-coach');
  if (!c) return;
  for (const m of c.querySelectorAll('.msg')) m.classList.add('seen');
  c.scrollTop = c.scrollHeight;
}

// Open: `from` is where the orb is coming from ('dock', or 'flier' when it's already in the air).
export function openChat({ from = 'dock' } = {}) {
  const a = app(), mine = ++sheetSeq;
  const wasShowing = a.classList.contains('chatsheet');
  a.classList.add('chatsheet', 'sheetmoving');
  a.classList.remove('rmout');
  frost(true);
  chat.open = true;
  chat.moving = true;
  if (!wasShowing) sheetSpring.set({ y: viewSize().H });
  // one frame for the sheet's layout, then measure and move (nothing forces a layout mid-move)
  return new Promise(res => nextFrame(() => {
    if (mine !== sheetSeq) return res(false);
    prepareChat(); // (a render in between may have added a message)
    const c = $('#s-coach');
    a.dataset.chatStart = String(Math.round(c?.scrollTop || 0)); // for the tests: final before it moves
    a.dataset.chatMax = String(Math.round(c ? c.scrollHeight - c.clientHeight : 0));
    const orbGoes = from === 'flier' || orbHome() !== 'composer' ? flyOrbTo('composer', { offset: sheetY }) : Promise.resolve(false);
    Promise.all([sheetSpring.to({ y: 0 }), orbGoes]).then(([, landed]) => {
      if (mine !== sheetSeq) return res(false);
      chat.moving = false;
      a.classList.remove('sheetmoving');
      if (landed) landHook?.();
      res(true);
    });
  }));
}

// Close: the exact reverse. The orb goes home to the dock; the frost fades as the sheet goes down.
export function closeChat({ instant = false } = {}) {
  const a = app(), mine = ++sheetSeq;
  chat.open = false;
  chat.moving = true;
  a.classList.add('sheetmoving');
  frost(false);
  const H = viewSize().H;
  if (instant || reducedMotion()) {
    seatOrb('dock');
    const done = () => {
      if (mine !== sheetSeq) return;
      a.classList.remove('chatsheet', 'sheetmoving', 'rmout');
      chat.moving = false;
      sheetSpring.set({ y: 0 });
      paintSheet(0);
    };
    if (instant) { done(); return Promise.resolve(true); }
    a.classList.add('rmout'); // reduced motion: it fades (150 ms) where it is
    return new Promise(res => setTimeout(() => { done(); res(true); }, 160));
  }
  const orbGoes = flyOrbTo('dock', { size: 60 });
  // however the close goes (reversed half-way, interrupted), it always ends tidy: at the latest a
  // moment after it should have finished, nothing of the chat is left over the page
  const tidy = () => {
    if (mine !== sheetSeq || chat.open) return;
    a.classList.remove('chatsheet', 'sheetmoving', 'rmout');
    chat.moving = false;
    paintSheet(0);
    if (orbHome() === 'flying') seatOrb('dock');
  };
  setTimeout(tidy, 800 * slowmo);
  return Promise.all([sheetSpring.to({ y: H }), orbGoes]).then(([, landed]) => {
    if (mine !== sheetSeq) return false;
    tidy();
    if (landed) dockHook?.();
    return true;
  });
}

// The review sheet becomes the chat: the Coach is put in place right away under it (at its open
// position, its content hidden), and shown once the review sheet's surface has reached it.
export function chatUnder() {
  const a = app();
  ++sheetSeq;
  a.classList.add('chatsheet', 'chatveil');
  frost(true);
  chat.open = true;
  sheetSpring.set({ y: 0 });
  prepareChat();
}
export function revealChat() {
  const a = app();
  a.classList.remove('chatveil', 'sheetmoving');
  chat.moving = false;
}

let landHook = null, dockHook = null;
export function onLand({ composer, dock }) { landHook = composer; dockHook = dock; }
