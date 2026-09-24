// Moments of delight: bursts, count-ups, orb pulses. Transform/opacity only; skipped with reduced motion.
const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

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
  const colors = warm ? ['#FFD9A8', '#FFE9CC', '#FFC27A', '#fff'] : ['#C6BBFA', '#D9D0FF', '#7A67F2', '#5B86FF'];
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

// A ring that leaves the dock orb, for a voice command that just landed.
export function orbPulse(warm = false) {
  if (reduced()) return;
  const orb = document.querySelector('#dock .orbbtn');
  if (!orb) return;
  orb.classList.remove('pulse', 'pulse-warm');
  void orb.offsetWidth;
  orb.classList.add(warm ? 'pulse-warm' : 'pulse');
  setTimeout(() => orb.classList.remove('pulse', 'pulse-warm'), 900);
}
