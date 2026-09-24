// A little figure doing the exercise: still in lists, moving on the exercise and workout screens.
import { PATTERNS, patternFor, posePaths } from '../figures.js';

const reduced = () => document.documentElement.dataset.motion === 'off' ||
  (document.documentElement.dataset.motion !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// Still icons show the end of the movement (the most telling moment).
export function figureHTML(ex, { move = false, cls = '' } = {}) {
  const name = patternFor(ex);
  const P = PATTERNS[name];
  const d = posePaths(name, move ? 'a' : 'b');
  return `<svg class="fig ${cls}" viewBox="0 -10 64 72" aria-hidden="true" data-fig="${name}"${move ? ' data-move="1"' : ''}>
    <path class="fg-floor" d="M4 56.5 L60 56.5"/>${P.scene ? `<path class="fg-scene" d="${P.scene}"/>` : ''}
    <path class="fg-far" d="${d.far}"/><path class="fg-prop" d="${d.prop}"/><path class="fg-near" d="${d.near}"/><path class="fg-head" d="${d.head}"/>
  </svg>`;
}

const DUR = 2600;
// Start the moving figures under root: a slow, even rep, a short hold at each end.
export function animateFigures(root) {
  if (reduced() || !root) return;
  for (const svg of root.querySelectorAll('svg.fig[data-move]:not([data-going])')) {
    svg.dataset.going = '1';
    const name = svg.dataset.fig;
    const a = posePaths(name, 'a'), b = posePaths(name, 'b');
    for (const k of ['far', 'prop', 'near', 'head']) {
      const el = svg.querySelector('.fg-' + k);
      if (!el || !a[k]) continue;
      try {
        el.animate([
          { d: `path("${a[k]}")`, offset: 0 }, { d: `path("${a[k]}")`, offset: 0.08, easing: 'cubic-bezier(.45,0,.35,1)' },
          { d: `path("${b[k]}")`, offset: 0.46 }, { d: `path("${b[k]}")`, offset: 0.58, easing: 'cubic-bezier(.45,0,.35,1)' },
          { d: `path("${a[k]}")`, offset: 1 }
        ], { duration: DUR, iterations: Infinity });
      } catch { return; } // no path morphing here: the still pose is fine
    }
  }
}
