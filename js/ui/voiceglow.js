// Voice glow: a colourful light along the bottom of the voice screen that rises and blooms with your
// voice. A trimmed plain-JS port of `voice-glow` by Jakub Antalik (https://libraries.dev/voice,
// https://github.com/Jakubantalik/Libraries.dev), MIT licensed:
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
// Kept from the original: its seven lobes fanning out from the bottom centre (the centre one
// following the low band, its neighbours the mids, the outer pair the highs), its three layers (the
// colours in the edge stroke with a hot white core, a soft inner light, a blurred bloom), each masked
// to an ellipse that grows with the voice, its noise gate, soft saturation and attack/release
// envelope, the flow that slides the colours sideways while you talk, and the processing state (the
// lobes gather into one beam that sweeps left and right while the words are being worked out). The
// `mobile` type's tuning (the bottom of a phone screen), with a lower reach so it stays restrained.
//
// Changed for Setline: the original repaints its gradients every frame through custom properties;
// here every lobe and mask is its own element moved only by transform and opacity, so the phone
// composites it instead of repainting. The colours are Setline's theme instead of the rainbow, held
// still (the library's `staticColors`), with no colour filters. Left out: the curved band line and the displacement warp
// (a canvas and an SVG filter every frame: too much for a restrained glow on Android). It reads the
// voice from the recorder's own analyser: no second microphone stream.

// ---------- the original's geometry and response (voice-glow presets: default + `mobile`) ----------
const LOBES = [
  { x: 0, w: 74, h: 46, band: 0 },
  { x: -36, w: 54, h: 40, band: 1 }, { x: 36, w: 54, h: 40, band: 1 },
  { x: -72, w: 48, h: 32, band: 2 }, { x: 72, w: 48, h: 32, band: 2 },
  { x: -108, w: 42, h: 26, band: 1 }, { x: 108, w: 42, h: 26, band: 1 }
];
const LOBE_SPAN = 36 * LOBES.length;
const SC = 1.25; // the mobile type's scale: every px dimension rides it
const G = {
  glowWidth: 1.15 * SC, glowHeight: 2.1 * SC, lobeSpacing: 1.35 * SC, rangeWidth: 1.25 * SC, rangeHeight: 1.2 * SC,
  softness: 1.1, coreSize: SC, bend: 70 * SC, flow: 60 * SC,
  reach: 1.8, // the mobile type runs 3 (a third of the screen); kept lower for a restrained glow
  spread: 0.45, idle: 0.18, breathe: 5.2, sensitivity: 3.1, threshold: 0.015, attack: 0.325, release: 0.86,
  procDuration: 1.05, procLevel: 0.35, procTravel: 1, procCurve: 2.1, procEase: 0.6,
  // dark theme layer opacities (the brightness/saturation filters are left out: Setline's own colours)
  stroke: 1.16, inner: 0.47, bloom: 0.89
};
const BASE_GAIN = 5, BAND_GAIN = 1.7;
const TWO_PI = Math.PI * 2;

// Setline's colours for the seven lobes (centre, then pairs outward), as CSS so they follow the theme
const COLORS = ['var(--accent)', 'var(--blue)', 'var(--violet)', 'var(--accent2)', 'var(--orb1)', 'var(--violet)', 'var(--blue)'];
const withAlpha = (c, a) => (a >= 1 ? c : `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`);

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const wrapX = (x, span) => ((((x + span / 2) % span) + span) % span) - span / 2;
// how much of a lobe shows at offset x: full at the centre, gone at the wrap so it never pops across
const edgeEnvelope = (x, span) => { const t = x / (span / 2 + 4); return Math.max(0, 1 - t * t); };
// noise gate, then soft saturation, so a shout rounds off instead of clipping
function shape(raw, threshold) {
  if (raw <= threshold) return 0;
  const t = (raw - threshold) / Math.max(0.001, 1 - threshold);
  return clamp01((1 - Math.exp(-3 * t)) / (1 - Math.exp(-3)));
}
// one-pole follower: fast up (attack), slow down (release)
function follow(prev, target, dt, attack, release) {
  const tau = target > prev ? attack : release;
  return prev + (target - prev) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
}

// A layer: its lobes (each a soft ellipse, the original's radial gradient at the same size and fade)
// inside a box masked to the layer's ellipse, which the driver scales from the bottom centre.
function layerHTML(cls, { sw, sh, y, alpha, fade, mask, soft = false }) {
  const lobes = LOBES.map((l, i) => {
    const W = Math.round(l.w * sw), H = Math.round(l.h * sh), c = withAlpha(COLORS[i], alpha);
    const stops = soft ? `${c},${withAlpha(COLORS[i], alpha * 0.55)} 40%,${withAlpha(COLORS[i], alpha * 0.18)} 70%,transparent ${fade}%` : `${c},transparent ${fade}%`;
    return `<i style="width:${2 * W}px;height:${2 * H}px;margin:0 0 ${-H - y}px ${-W}px;background:radial-gradient(closest-side,${stops})"></i>`;
  }).join('');
  return `<div class="vg-l ${cls}"><div class="vg-m" style="width:${2 * mask.w}px;height:${mask.h}px;margin-left:${-mask.w}px;${maskCSS(mask)}">${lobes}</div></div>`;
}
function maskCSS({ w, h, mid, tail = 0 }) {
  const g = `radial-gradient(ellipse ${w}px ${h}px at 50% 100%,#fff 0%,rgba(255,255,255,.5) ${mid}%${tail ? `,rgba(255,255,255,${tail}) 85%` : ''},transparent 100%)`;
  return `-webkit-mask-image:${g};mask-image:${g}`;
}

export function createVoiceGlow(host, before = null) {
  const fade = Math.round(Math.max(40, Math.min(95, 70 * G.softness)));
  const gw = m => G.glowWidth * m, gh = m => G.glowHeight * m;
  const inner = { w: Math.round(170 * G.rangeWidth), h: Math.round(64 * G.rangeHeight), mid: 45, tail: 0.3 };
  const bloom = { w: Math.round(200 * G.rangeWidth), h: Math.round(130 * G.rangeHeight), mid: 35 };
  const stroke = { w: inner.w, h: inner.h, mid: 45 };
  const core = Math.round(30 * G.coreSize);
  const el = document.createElement('div');
  el.className = 'vglow';
  el.setAttribute('aria-hidden', 'true');
  // bottom to top as in the original: the inner light (hugging the edges), the stroke (the 1px edge
  // ring), the bloom
  el.innerHTML =
    layerHTML('vg-inner', { sw: gw(0.9), sh: gh(0.9), y: 0, alpha: 0.46, fade, mask: inner }) +
    layerHTML('vg-stroke', { sw: gw(1), sh: gh(1), y: 2, alpha: 1, fade, mask: stroke }) +
    // the bloom's blur is baked into its gradient (a longer, softer fall-off) instead of a blur
    // filter re-run every frame over a moving layer
    layerHTML('vg-bloom', { sw: gw(1.15) * 1.08, sh: gh(1.5) * 1.06, y: 0, alpha: 0.9, fade: 100, mask: bloom, soft: true });
  // the hot white core at the centre of the edge: the light the colours fan out from
  const coreEl = document.createElement('b');
  coreEl.className = 'vg-core';
  Object.assign(coreEl.style, { width: `${2 * core}px`, height: `${2 * core}px`, margin: `0 0 ${-core - 2}px ${-core}px` });
  el.querySelector('.vg-stroke .vg-m').append(coreEl);
  el.style.setProperty('--vg-edge', `${Math.round(28 * SC)}px`);
  if (before) host.insertBefore(el, before); else host.append(el);

  const layers = ['vg-inner', 'vg-stroke', 'vg-bloom'].map((c, k) => {
    const L = el.querySelector('.' + c);
    return { L, M: L.firstElementChild, lobes: [...L.firstElementChild.children].filter(n => n.tagName === 'I'), base: [inner, stroke, bloom][k], opacity: [G.inner, G.stroke, G.bloom][k] };
  });
  const s = { level: 0, bands: [0, 0, 0], phase: 0, scanA: 0, scanT: 0, t: 0, on: false };
  const span = LOBE_SPAN * G.lobeSpacing;

  // One frame. src: { listening, processing, rms, voice: [low, mid, high] } from the recorder's own
  // analyser; still: no breathing, flow or sweep (reduced motion), the reaction to sound stays.
  // Pacing, as the original's driver: a phone that can't hold 60 steps every other frame (the
  // glow's own dynamics are far slower than 30 Hz) and tries full rate again every few seconds.
  const pace = { slowFor: 0, half: false, skip: false, probe: 0, acc: 0 };
  function step(dt, src, still) {
    const on = src.listening || src.processing;
    if (on !== s.on) { s.on = on; el.classList.toggle('on', on); }
    // switched off: it holds its last frame and fades out by opacity, with no more per-frame work
    if (!on) { Object.assign(s, { level: 0, bands: [0, 0, 0], scanA: 0, scanT: 0 }); return; }
    if (dt > 0.022) pace.slowFor += dt; else if (!pace.half) pace.slowFor = 0;
    if (!pace.half && pace.slowFor > 0.5) { pace.half = true; pace.probe = 4; }
    if (pace.half) {
      pace.acc += dt;
      pace.skip = !pace.skip;
      if (pace.skip) return;
      dt = pace.acc; pace.acc = 0;
      if ((pace.probe -= dt) <= 0) { pace.half = false; pace.slowFor = 0; }
    }
    s.t += dt;
    // ── the source: shaped and followed (silence while not recording) ──
    const raw = src.listening ? src.rms * BASE_GAIN * G.sensitivity : 0;
    s.level = follow(s.level, shape(raw, G.threshold), dt, G.attack, G.release);
    for (let b = 0; b < 3; b++) {
      const bt = src.listening ? shape((src.voice?.[b] || 0) * BAND_GAIN * G.sensitivity, G.threshold * 0.6) : 0;
      s.bands[b] = follow(s.bands[b], bt, dt, G.attack, G.release * 1.15);
    }
    // ── processing: the lobes gather into a beam that travels the range, ping-pong ──
    if (src.processing && s.scanA < 0.001 && s.scanT === 0) s.scanT = G.procDuration / 2; // start at the centre
    s.scanA = follow(s.scanA, src.processing ? 1 : 0, dt, G.procEase * 0.9, G.procEase * 0.8);
    if (src.processing) s.scanT += dt; else if (s.scanA < 0.001) s.scanT = 0;
    const morph = s.scanA * s.scanA * (3 - 2 * s.scanA);
    const passes = s.scanT / G.procDuration, idx = Math.floor(passes), u = passes - idx, k = G.procCurve;
    const eased = u < 0.5 ? 0.5 * Math.pow(2 * u, k) : 1 - 0.5 * Math.pow(2 - 2 * u, k);
    const pass = still ? 0 : idx % 2 === 0 ? 2 * eased - 1 : 1 - 2 * eased;
    const cx = morph * (span / 2) * G.procTravel * pass;
    const gather = 1 - morph * 0.6, maskW = 1 - morph * 0.45, passW = 1 + morph * 0.3 * (1 - pass * pass);
    // ── idle breathing folded under the voice (only while recording) ──
    const breathe = still ? 0.5 : 0.5 + 0.5 * Math.sin((TWO_PI * s.t) / G.breathe);
    const voiced = s.level + (1 - s.level) * (src.listening ? G.idle : 0) * breathe;
    const heldT = Math.max(0, Math.min(1, (morph - 0.25) / 0.75)), held = heldT * heldT * (3 - 2 * heldT);
    const eff = Math.max(voiced, G.procLevel * held);
    const glow = 0.15 + 0.85 * eff, h = 0.5 + G.reach * eff, w = (0.85 + G.spread * eff) * passW;
    if (!still) s.phase = (((s.phase + G.flow * eff * dt) % span) + span) % span;
    const bh = G.bend * eff;
    // ── write: each layer's mask box scales from the bottom centre (the original's growing ellipse),
    // and its lobes move inside it, divided by that scale so they keep their own size ──
    for (const ly of layers) {
      const Cx = w * maskW, Cy = (ly.base.h * h + bh) / ly.base.h;
      ly.M.style.transform = `translateX(${(cx * w).toFixed(1)}px) scale(${Cx.toFixed(4)}, ${Cy.toFixed(4)})`;
      ly.L.style.opacity = (glow * ly.opacity).toFixed(3);
      for (let i = 0; i < LOBES.length; i++) {
        const x = wrapX(LOBES[i].x * G.lobeSpacing + s.phase, span);
        const amp = (0.6 + 0.7 * s.bands[LOBES[i].band]) * edgeEnvelope(x, span);
        ly.lobes[i].style.transform = `translate(${((x * gather * w) / Cx).toFixed(1)}px, 0) scale(${(w / Cx).toFixed(4)}, ${((h * amp) / Cy).toFixed(4)})`;
      }
    }
    const S = layers[1];
    coreEl.style.transform = `scale(${(w / (w * maskW)).toFixed(4)}, ${(h / ((S.base.h * h + bh) / S.base.h)).toFixed(4)})`;
  }

  // off at once (the voice closed): the glow fades out by its own opacity and the envelope starts
  // from silence next time
  function off() { s.on = false; el.classList.remove('on'); Object.assign(s, { level: 0, bands: [0, 0, 0], scanA: 0, scanT: 0 }); }

  return { el, step, off, get on() { return s.on; } };
}
