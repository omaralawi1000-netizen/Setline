// Border beam: a beam of light travelling round a card's border, for the one thing that's live right
// now: the workout (or run) in progress, on Today. A trimmed plain-JS/CSS port of `border-beam` by
// Jakub Antalik (https://libraries.dev/beam, https://github.com/Jakubantalik/Libraries.dev), its `md`
// type with the `ocean` palette on the dark theme, MIT licensed:
//
//   MIT License. Copyright (c) 2026 Jakub Antalik
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: The above copyright
//   notice and this permission notice shall be included in all copies or substantial portions of
//   the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
//   LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// The same three layers as the original (the colours in the 1px edge ring with a white highlight,
// a soft inner light, a blurred bloom), its palette, window and highlight gradients and opacities.
// The original turns them with an animated custom property (a repaint every frame); here the window
// is a mask on a square that turns by transform, and the colours sit on a child turning back the
// other way, so they stay put round the border exactly as in the original while the phone only
// composites. Held colours (the library's `staticColors`); slower than its default spin, since it
// stays on for the length of a workout.

// the ocean palette's colour lobes round the border (position, size), as in the original
const OCEAN = [
  ['rgb(100, 80, 220)', '33% -7.4%', [70, 40]], ['rgb(60, 120, 255)', '12% -5%', [60, 35]],
  ['rgb(80, 100, 200)', '2.1% 68.3%', [40, 70]], ['rgb(50, 140, 220)', '2.1% 68.3%', [20, 35]],
  ['rgb(120, 80, 255)', '74.4% 100%', [180, 32]], ['rgb(70, 130, 255)', '55% 100%', [85, 26]],
  ['rgb(140, 100, 240)', '93.9% 0%', [74, 32]], ['rgb(90, 110, 230)', '100% 27.1%', [26, 42]],
  ['rgb(130, 70, 255)', '100% 27.1%', [52, 48]]
];
const lobes = (alpha, k) => OCEAN.map(([c, pos, [w, h]]) => `radial-gradient(ellipse ${Math.round(w * k)}px ${Math.round(h * k)}px at ${pos}, ${alpha < 1 ? c.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`) : c}, transparent)`).join(',');

export const beamHTML = () => `<span class="beam" aria-hidden="true">
  <span class="bm-l bm-inner"><i class="bm-rot"><b class="bm-fix" style="background:${lobes(0.45, 0.9)}"></b></i></span>
  <span class="bm-l bm-stroke"><i class="bm-rot"><b class="bm-fix" style="background:${lobes(1, 1)}"></b></i></span>
  <span class="bm-l bm-bloom"><i class="bm-rot"></i></span></span>`;

// Size each beam to its card (the turning square covers the card's diagonal) and turn it only while
// it's on screen: off the page, on another tab or with the app hidden it stands still.
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for (const e of es) e.target.classList.toggle('bm-away', !e.isIntersecting); }) : null;
const ro = 'ResizeObserver' in window ? new ResizeObserver(es => { for (const e of es) size(e.target); }) : null;
function size(beam) {
  const w = beam.offsetWidth, h = beam.offsetHeight;
  if (!w || !h) return;
  beam.style.setProperty('--bw', `${w}px`);
  beam.style.setProperty('--bh', `${h}px`);
  beam.style.setProperty('--bd', `${Math.ceil(Math.hypot(w, h)) + 2}px`);
}
const watched = new Set();
export function syncBeams(root) {
  for (const b of watched) if (!b.isConnected) { io?.unobserve(b); ro?.unobserve(b); watched.delete(b); } // a redrawn card lets go
  for (const b of root?.querySelectorAll('.beam:not([data-on])') || []) {
    b.dataset.on = '1';
    size(b);
    io?.observe(b);
    ro?.observe(b);
    watched.add(b);
  }
}
