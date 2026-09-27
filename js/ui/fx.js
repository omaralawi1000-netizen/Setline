// Moments of delight: bursts, count-ups, orb pulses. Transform/opacity only; skipped with reduced motion.
const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// A motion token from css/tokens.css: a duration in ms, or an easing as written.
export function token(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (/^[\d.]+m?s$/.test(v)) return parseFloat(v) * (v.endsWith('ms') ? 1 : 1000);
  return v || 'ease';
}

// Particles flying out of an element's centre. warm = PR colours.
export function burst(el, { warm = false, count = 12, spread = 56 } = {}) {
  if (!el || reduced()) return;
  const app = document.getElementById('app');
  const a = app.getBoundingClientRect(), r = el.getBoundingClientRect();
  const x = r.left + r.width / 2 - a.left, y = r.top + r.height / 2 - a.top;
  const layer = document.createElement('div');
  layer.className = 'fx-burst';
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  const colors = warm ? ['#FFD9A8', '#FFE9CC', '#FFC27A', '#fff'] : ['var(--accent)', 'var(--accent-hi)', 'var(--violet)', 'var(--blue)'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const dist = spread * (0.55 + Math.random() * 0.6);
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
    p.style.setProperty('--s', (0.6 + Math.random() * 0.9).toFixed(2));
    p.style.setProperty('--d', `${Math.round(Math.random() * 60)}ms`);
    p.style.background = colors[i % colors.length];
    if (i % 3 === 0) p.classList.add('line');
    layer.appendChild(p);
  }
  const ring = document.createElement('b');
  if (warm) ring.classList.add('warm');
  layer.appendChild(ring);
  app.appendChild(layer);
  setTimeout(() => layer.remove(), 1100);
}

// Count a number up from 0 (or from its current text) to its value.
export function countUp(el, to, { ms = 900, format = v => Math.round(v).toLocaleString() } = {}) {
  if (!el) return;
  if (reduced()) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = format(to * ease(k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Every [data-count] in root counts up to its data-count value (formatted with data-dp decimals).
export function countAll(root, lang) {
  const nf = dp => new Intl.NumberFormat(lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: dp, minimumFractionDigits: dp });
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count), dp = Number(el.dataset.dp || 0);
    if (!Number.isFinite(to)) continue;
    const f = nf(dp);
    countUp(el, to, { format: v => f.format(v) });
  }
}

// The dock orb answers: a ring of light for a voice command that just landed, a gold flare for a
// record, a softer "go" when a rest is over, a small settle when the orb flies home.
const PULSES = ['pulse', 'pulse-warm', 'pulse-go', 'pulse-land'];
export function orbPulse(kind = 'pulse') {
  if (reduced()) return;
  const orb = document.querySelector('#dock .orbbtn');
  if (!orb) return;
  const cls = kind === true ? 'pulse-warm' : PULSES.includes(kind) ? kind : 'pulse';
  orb.classList.remove(...PULSES);
  void orb.offsetWidth;
  orb.classList.add(cls);
  if (cls === 'pulse-warm') burst(orb.querySelector('.orb'), { warm: true, count: 14, spread: 54 });
  clearTimeout(orb._pulse);
  orb._pulse = setTimeout(() => orb.classList.remove(...PULSES), cls === 'pulse-warm' ? 1500 : 900);
}

// An orb that got it wrong gives a small shake of the head (translate only, so it adds to whatever
// scale the orb is showing).
export function orbShake(el) {
  if (!el || reduced()) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  clearTimeout(el._shake);
  el._shake = setTimeout(() => el.classList.remove('shake'), 700);
}

// cubic-bezier(x1, y1, x2, y2) as a function of time → progress, for keyframes sampled in JS.
export function bezier(css) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css || '');
  if (!m) return t => Math.max(0, Math.min(1, t));
  const [x1, y1, x2, y2] = m[1].split(',').map(Number);
  const f = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return x => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 22; i++) { t = (lo + hi) / 2; if (f(x1, x2, t) < x) lo = t; else hi = t; }
    return f(y1, y2, t);
  };
}

// The light an orb leaves while it flies: a soft comet tail, brightest under the orb and fading out
// behind it. The orb itself stays sharp. The head runs with the orb and the tail a moment behind, so
// the tail is longest when the orb is fastest and is drawn back into it as it lands. from/to are
// centres in parent's coordinates; timing is the orb's own. Transform and opacity only.
export function orbStreak(parent, from, to, { duration, delay = 0, easing, size = 40, lag = 64, go, before = null, z = '0' } = {}) {
  if (!parent || reduced()) return null;
  const dx = to.x - from.x, dy = to.y - from.y, D = Math.hypot(dx, dy);
  if (D < 24) return null;
  const P = bezier(easing), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const el = document.createElement('div');
  el.className = 'orbstreak';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${from.x}px`, top: `${from.y - size / 2}px`, width: `${D}px`, height: `${size}px` });
  // just under the flying orb (the element before which it goes, at the orb's own level)
  el.style.zIndex = z;
  if (before) parent.insertBefore(el, before); else parent.append(el);
  const T = duration + lag, N = 30, frames = [];
  for (let i = 0; i <= N; i++) {
    const ms = (T * i) / N, head = P(ms / duration), tail = P((ms - lag) / duration);
    frames.push({ offset: i / N, opacity: Math.min(1, ms / (duration * 0.1)).toFixed(3),
      transform: `rotate(${ang.toFixed(2)}deg) translateX(${(tail * D).toFixed(1)}px) scaleX(${Math.max(head - tail, 0.001).toFixed(4)})` });
  }
  const opts = { duration: T, delay, easing: 'linear', fill: 'both' };
  const a = go ? go(el, frames, opts) : el.animate(frames, opts);
  const gone = () => el.remove();
  a.addEventListener('finish', gone);
  a.addEventListener('cancel', gone);
  return a;
}

// A voice-logged set: a spark of light leaves the orb, arcs to the new row and bursts on its check.
export function orbSpark(fromEl, toEl, { warm = false } = {}) {
  if (!fromEl || !toEl || reduced()) return false;
  const app = document.getElementById('app'), A = app.getBoundingClientRect();
  const f = fromEl.getBoundingClientRect(), t = toEl.getBoundingClientRect();
  if (!f.width || !t.width || t.bottom < A.top || t.top > A.bottom) return false;
  const x0 = f.left + f.width / 2 - A.left, y0 = f.top + f.height / 2 - A.top;
  const x1 = t.left + t.width / 2 - A.left, y1 = t.top + t.height / 2 - A.top;
  const s = document.createElement('div');
  s.className = warm ? 'orbspark warm' : 'orbspark';
  s.setAttribute('aria-hidden', 'true');
  Object.assign(s.style, { left: `${x0}px`, top: `${y0}px` });
  app.append(s);
  // a gentle arc: out to the side a little, then in
  const mx = (x1 - x0) * 0.5 + (y1 - y0) * 0.18, my = (y1 - y0) * 0.5 - Math.abs(x1 - x0) * 0.12;
  const a = s.animate([
    { translate: '0 0', scale: 0.4, opacity: 0 },
    { translate: `${mx}px ${my}px`, scale: 1, opacity: 1, offset: 0.45 },
    { translate: `${x1 - x0}px ${y1 - y0}px`, scale: 0.7, opacity: 1 }
  ], { duration: token('--m-slow') * 1.15, easing: token('--e-soft'), fill: 'both' });
  a.onfinish = () => { s.remove(); burst(toEl, { warm, count: warm ? 22 : 10, spread: warm ? 80 : 44 }); };
  a.oncancel = () => s.remove();
  return true;
}
