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
// Changed for Setline: the original repaints its gradients every frame through custom properties.
// Here it is one canvas (at 1× pixel density: it is all soft light) and every lobe, mask and edge is
// a sprite drawn once when the glow opens, so a frame is a few dozen scaled image copies and there is
// one layer on screen instead of two dozen masked ones (1.62.1; before, each lobe was its own element). The colours are Setline's theme instead of the rainbow, held
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

// ---------- sprites (drawn once per theme, then only copied) ----------
const SPR = 64;
const cssColor = (() => { let probe = null; return c => { probe ||= document.createElement('i'); probe.style.color = ''; probe.style.color = c; document.body.append(probe); const v = getComputedStyle(probe).color; probe.remove(); return v; }; })();
const rgbaOf = (rgb, a) => { const m = /(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(rgb) || [0, 255, 255, 255]; return `rgba(${m[1]},${m[2]},${m[3]},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
// a lobe: the original's radial-gradient(closest-side, …) in a square, stretched to its ellipse when drawn
function lobeSprite(rgb, alpha, fade, soft) {
  const c = canvas(SPR, SPR), x = c.getContext('2d'), g = x.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2);
  g.addColorStop(0, rgbaOf(rgb, alpha));
  if (soft) { g.addColorStop(0.4, rgbaOf(rgb, alpha * 0.55)); g.addColorStop(0.7, rgbaOf(rgb, alpha * 0.18)); }
  g.addColorStop(fade / 100, rgbaOf(rgb, 0));
  g.addColorStop(1, rgbaOf(rgb, 0));
  x.fillStyle = g; x.fillRect(0, 0, SPR, SPR);
  return c;
}
// a layer's mask: the ellipse growing from the bottom centre of its box (2w × h), as its mask-image
function maskSprite({ mid, tail = 0 }) {
  const W = SPR * 2, H = SPR, c = canvas(W, H), x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, W / 2, H); x.scale(1, 1);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, SPR);
  g.addColorStop(0, '#fff'); g.addColorStop(mid / 100, 'rgba(255,255,255,.5)');
  if (tail) g.addColorStop(0.85, `rgba(255,255,255,${tail})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(-W / 2, -H, W, H);
  return c;
}
function coreSprite() {
  const c = canvas(SPR, SPR), x = c.getContext('2d'), g = x.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2);
  g.addColorStop(0, 'rgba(255,255,255,.45)'); g.addColorStop(0.3, 'rgba(255,255,255,.14)'); g.addColorStop(0.65, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, SPR, SPR);
  return c;
}
const EDGE_CSS = Math.round(28 * SC); // the inner light's band in from each edge (--vg-edge)
const Q = 0.5;                    // the canvas's scale (of CSS pixels)
const TALL = 480;                 // the glow never reaches higher than this above the bottom edge
const themeKey = () => (document.documentElement.dataset.accent || '') + '|' + (document.documentElement.dataset.theme || '');
let shared = null;
function themeSprites(layers) {
  const key = themeKey();
  if (shared?.key === key) return shared;
  const rgb = COLORS.map(cssColor);
  return (shared = { key, core: coreSprite(), layers: layers.map(ly => ({ mask: maskSprite(ly.base), lobes: rgb.map(c => lobeSprite(c, ly.alpha, ly.fade, ly.soft)) })) });
}
// the inner light shows in a band along the bottom and up each side (its two masks added); the
// stroke only in the 1px ring round the edge of the screen
function edgeMasks(W, H, EDGE) {
  const e1 = canvas(W, H), x1 = e1.getContext('2d');
  let g = x1.createLinearGradient(0, H, 0, H - EDGE); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x1.fillStyle = g; x1.fillRect(0, 0, W, H);
  g = x1.createLinearGradient(0, 0, W, 0); const k = EDGE / W;
  g.addColorStop(0, '#fff'); g.addColorStop(k, 'rgba(255,255,255,0)'); g.addColorStop(1 - k, 'rgba(255,255,255,0)'); g.addColorStop(1, '#fff');
  x1.fillStyle = g; x1.fillRect(0, 0, W, H);
  const e2 = canvas(W, H), x2 = e2.getContext('2d');
  x2.fillStyle = '#fff'; x2.fillRect(0, H - 1, W, 1); x2.fillRect(0, 0, 1, H); x2.fillRect(W - 1, 0, 1, H); // (1 canvas px: 2 CSS px, softly)
  return { inner: e1, ring: e2 };
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
  const cv = document.createElement('canvas');
  cv.className = 'vg-canvas';
  el.append(cv);
  if (before) host.insertBefore(el, before); else host.append(el);
  const ctx = cv.getContext('2d');
  // bottom to top as in the original: the inner light (hugging the edges), the stroke (the 1px edge
  // ring), the bloom (its blur baked into a longer, softer fall-off)
  const layers = [
    { base: inner, opacity: G.inner, sw: gw(0.9), sh: gh(0.9), y: 0, alpha: 0.46, fade, soft: false, edge: 'inner' },
    { base: stroke, opacity: G.stroke, sw: gw(1), sh: gh(1), y: 2, alpha: 1, fade, soft: false, edge: 'ring', core: true },
    { base: bloom, opacity: G.bloom, sw: gw(1.15) * 1.08, sh: gh(1.5) * 1.06, y: 0, alpha: 0.9, fade: 100, soft: true }
  ];
  let sprites = null, W = 0, H = 0, buf = null, octx = null, edges = {};
  // what the glow draws with: the theme's colours (shared by every glow) and canvases at the screen's
  // size, made while the app is idle, so turning the glow on costs nothing mid-gesture
  function prepare() {
    const app = document.getElementById('app');
    const w = Math.round(host.clientWidth || app?.clientWidth || innerWidth), h = Math.min(TALL, Math.round(host.clientHeight || app?.clientHeight || innerHeight));
    sprites = themeSprites(layers);
    if (w === W && h === H) return;
    W = w; H = h;
    // drawn at half the screen's size and stretched: it is all soft light, and a quarter of the pixels
    cv.width = Math.round(W * Q); cv.height = Math.round(H * Q);
    ctx.setTransform(Q, 0, 0, Q, 0, 0);
    buf = canvas(Math.round(W * Q), Math.round(H * Q)); octx = buf.getContext('2d'); octx.setTransform(Q, 0, 0, Q, 0, 0);
    edges = edgeMasks(Math.round(W * Q), Math.round(H * Q), EDGE_CSS * Q);
  }
  (window.requestIdleCallback || setTimeout)(prepare, { timeout: 3000 });
  const s = { level: 0, bands: [0, 0, 0], phase: 0, scanA: 0, scanT: 0, t: 0, on: false };
  const span = LOBE_SPAN * G.lobeSpacing;

  // One frame. src: { listening, processing, rms, voice: [low, mid, high] } from the recorder's own
  // analyser; still: no breathing, flow or sweep (reduced motion), the reaction to sound stays.
  // Pacing, as the original's driver: a phone that can't hold 60 steps every other frame (the
  // glow's own dynamics are far slower than 30 Hz) and tries full rate again every few seconds.
  const pace = { slowFor: 0, half: false, skip: false, probe: 0, acc: 0 };
  function step(dt, src, still) {
    const on = src.listening || src.processing;
    if (on !== s.on) { s.on = on; if (on && (!sprites || sprites.key !== themeKey())) prepare(); el.classList.toggle('on', on); }
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
    // ── draw: each layer's lobes inside its mask ellipse, which grows from the bottom centre; the
    // same geometry the original's elements had (mask box scaled by Cx, Cy round its bottom centre) ──
    if (!W) return;
    // only the part of the canvas the light covers is touched (a copy is paid per pixel)
    ctx.clearRect(0, 0, W, H);
    const X0 = W / 2 + cx * w;
    for (let k = 0; k < layers.length; k++) {
      const ly = layers[k], sp = sprites.layers[k], m = ly.base;
      const Cx = w * maskW, Cy = (m.h * h + bh) / m.h;
      const mw = m.w * Cx, mh = m.h * Cy;
      const rx = Math.max(0, Math.floor(X0 - mw)), rw = Math.min(W, Math.ceil(X0 + mw)) - rx;
      const ry = Math.max(0, Math.floor(H - mh)), rh = H - ry;
      if (rw <= 0 || rh <= 0) continue;
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(rx, ry, rw, rh);
      octx.save();
      octx.beginPath(); octx.rect(rx, ry, rw, rh); octx.clip();
      for (let i = 0; i < LOBES.length; i++) {
        const L = LOBES[i];
        const x = wrapX(L.x * G.lobeSpacing + s.phase, span);
        const amp = (0.6 + 0.7 * s.bands[L.band]) * edgeEnvelope(x, span);
        const lw = Math.round(L.w * ly.sw) * w, lh = Math.round(L.h * ly.sh) * h * amp; // half sizes, on screen
        const lx = X0 + x * gather * w, ly0 = H + ly.y * Cy;
        if (lw > 0.5 && lh > 0.5) octx.drawImage(sp.lobes[i], lx - lw, ly0 - lh, lw * 2, lh * 2);
      }
      if (ly.core) { const r = Math.round(30 * G.coreSize); const cw = r * w, ch = r * h; octx.drawImage(sprites.core, X0 - cw, H + 2 * Cy - ch, cw * 2, ch * 2); }
      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(sp.mask, X0 - mw, H - mh, mw * 2, mh);
      if (ly.edge) { octx.setTransform(1, 0, 0, 1, 0, 0); octx.drawImage(edges[ly.edge], 0, 0); octx.setTransform(Q, 0, 0, Q, 0, 0); }
      octx.restore();
      ctx.globalAlpha = Math.min(1, glow * ly.opacity);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const qx = Math.floor(rx * Q), qy = Math.floor(ry * Q), qw = Math.min(buf.width - qx, Math.ceil(rw * Q) + 1), qh = buf.height - qy;
      ctx.drawImage(buf, qx, qy, qw, qh, qx, qy, qw, qh);
      ctx.setTransform(Q, 0, 0, Q, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  // off at once (the voice closed): the glow fades out by its own opacity and the envelope starts
  // from silence next time
  function off() { s.on = false; el.classList.remove('on'); Object.assign(s, { level: 0, bands: [0, 0, 0], scanA: 0, scanT: 0 }); }

  return { el, step, off, get on() { return s.on; } };
}
