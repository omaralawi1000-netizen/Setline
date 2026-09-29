// Springs, the way iOS moves: a damped spring worked out once and handed to the compositor as a CSS
// `linear()` easing, so a WAAPI animation or a CSS transition runs it on the GPU with no script per
// frame. `response` is roughly how long the spring takes to get there (seconds, like SwiftUI's
// .spring(response:dampingFraction:)), `damping` 1 is no overshoot, lower bounces a little.
const cache = new Map();
const LINEAR_OK = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', 'linear(0, 1)');

// The spring's position over time, 0 → 1, and how long until it's settled (within 0.1 %).
function solve(response, damping) {
  const w0 = (2 * Math.PI) / response, z = damping;
  const at = t => {
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t); // critically damped
  };
  let T = response;
  for (let t = response * 0.5; t < 6; t += 0.01) {
    let still = true;
    for (let u = t; u < t + 0.15; u += 0.01) if (Math.abs(1 - at(u)) > 0.001) { still = false; break; }
    if (still) { T = t; break; }
  }
  return { at, T };
}

// { easing, duration } for WAAPI / CSS. Falls back to a close cubic-bezier where linear() is missing.
export function spring(response = 0.42, damping = 0.86) {
  const k = `${response}|${damping}`;
  if (cache.has(k)) return cache.get(k);
  const { at, T } = solve(response, damping);
  const N = 48, pts = [];
  for (let i = 0; i <= N; i++) pts.push(+at((T * i) / N).toFixed(4));
  pts[N] = 1;
  const easing = LINEAR_OK ? `linear(${pts.join(', ')})` : damping < 0.8 ? 'cubic-bezier(.3,1.35,.5,1)' : 'cubic-bezier(.2,.9,.25,1)';
  const out = { easing, duration: Math.round(T * 1000), at: t => at(Math.min(T, t / 1000)) };
  cache.set(k, out);
  return out;
}

// The ones the app uses, so everything shares a feel.
export const SNAPPY = () => spring(0.34, 0.88);  // controls, small things arriving
export const SMOOTH = () => spring(0.46, 1);     // screens, sheets, big things settling
export const LIVELY = () => spring(0.42, 0.74);  // the orb landing (one small overshoot)

// Sampled keyframes of a spring for properties that need a path (the orb's arc): `frame(p)` gives the
// keyframe at spring progress p (0 → 1, may overshoot a little); the timing is linear over the samples.
export function springFrames(s, frame, n = 30) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ offset: i / n, ...frame(s.at((s.duration * i) / n)) });
  return out;
}

// The app's CSS gets real springs too: `--e-spring` (the token every little bounce uses) becomes a true
// spring curve, and `--sp-card` / `--sp-card-d` move the cards that rise from the bottom (the voice
// card, toasts). Where linear() isn't supported the CSS keeps its cubic-bezier fallbacks.
export function installSprings(root = document.documentElement) {
  if (!LINEAR_OK) return;
  const bounce = spring(0.44, 0.7), card = spring(0.42, 0.8);
  root.style.setProperty('--e-spring', bounce.easing);
  root.style.setProperty('--sp-card', card.easing);
  root.style.setProperty('--sp-card-d', `${card.duration}ms`);
}
