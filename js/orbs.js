// Thinking orbs: dotted, honestly-3D thought orbs (rotated, depth-shaded, z-sorted dots on a plain
// 2D canvas). A trimmed plain-JS port of the `thinking-orbs` engine by Jakub Antalik
// (https://libraries.dev/orbs, https://github.com/Jakubantalik/Libraries.dev), MIT licensed:
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
// Only the four states Setline shows are kept (working, searching, composing, breathing) at the
// library's sizes (64 and 20 hand-tuned, 32 its interpolated in-between). The maths is the original, unchanged; the golden
// vectors in tests/orbs.test.js check it against the library's own output. Pure geometry, no DOM:
// js/ui/thinkorb.js paints it.

// ---------- shared primitives (engine/core) ----------
function hashD(a, b) {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}
function fibDir(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// shared spin + tilt + orthographic projection
function makeProj(yaw, tilt, cx, cy, scale) {
  const st = Math.sin(tilt), ct = Math.cos(tilt), sy = Math.sin(yaw), cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}
// dot radii were tuned for a 300pt frame; sub-linear scaling keeps small spinners legible
const radiusScale = (size, pow) => (size / 300) ** pow;
// drop invisible marks, clamp radii to the mode's floor, z-sort far → near into draw order
function finalizeFrame(dots, lines, rMin = 0.3) {
  const visible = [];
  for (const d of dots) {
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    visible.push(d);
  }
  visible.sort((a, b) => a.z - b.z);
  return { dots: visible, lines: lines.filter(l => (l.a ?? 1) >= 0.02) };
}

// ---------- Orbits: particles on tilted orbits ("working") ----------
function frameOrbits(size, t, o) {
  const cx = size / 2, cy = size / 2, R = (size / 2) * 0.82;
  const pt = makeProj(t * 0.12, 0.3, cx, cy, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots = [];
  const orbitN = o.orbitN ?? 12, ghostN = o.ghostN ?? 40, particles = o.particles ?? 3;
  for (let orb = 0; orb < orbitN; orb++) {
    const h1 = hashD(orb, 1.7), h2 = hashD(orb, 5.2), h3 = hashD(orb, 8.9);
    const ro = R * (0.45 + 0.52 * h1);
    const th = h1 * 2 * Math.PI;
    const phi = Math.acos(2 * h2 - 1);
    // orbit plane basis (u, v ⟂ normal n)
    const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
    let ux = -ny, uy = nx;
    const uz = 0;
    const ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy));
    ux /= ul; uy /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);
    const at = a => pt((ux * Math.cos(a) + vx * Math.sin(a)) * ro, (uy * Math.cos(a) + vy * Math.sin(a)) * ro, (uz * Math.cos(a) + vz * Math.sin(a)) * ro);
    for (let k = 0; k < ghostN; k++) { // ghost path
      const [px, py, z] = at((k / ghostN) * 2 * Math.PI);
      const depth = (z / ro + 1) / 2;
      dots.push({ x: px, y: py, z, r: (o.ghostR ?? 0.9) * rs, white: 0.72, a: (o.ghostA ?? 0.5) * (0.4 + 0.6 * depth) });
    }
    for (let m = 0; m < particles; m++) { // the particles doing the work
      const [px, py, z] = at(t * speed + (m / particles) * 2 * Math.PI + h2 * 6);
      const depth = (z / ro + 1) / 2;
      dots.push({ x: px, y: py, z, r: ((o.partR ?? 1.2) + (o.partRDepth ?? 1.6) * depth) * rs, white: 0.3 - 0.22 * depth });
    }
  }
  return finalizeFrame(dots, [], o.rMin);
}

// ---------- Globe: a scan meridian sweeps a dotted globe ("searching") ----------
function frameGlobe(size, t, o) {
  const spin = 0.5;
  const cx = size / 2, cy = size / 2, radius = (size / 2) * 0.82;
  const tilt = 0.4 + 0.06 * Math.sin(t * 0.35);
  const pt = makeProj(t * spin, tilt, cx, cy, radius);
  const scan = t * (spin + (1.7 - spin) * (o.scanMul ?? 1)); // scan sweeps relative to the spin
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dimBase = o.dimBase ?? 1;
  const dots = [];
  const latRings = o.latRings ?? 17, lonDensity = o.lonDensity ?? 44;
  for (let li = 0; li <= latRings; li++) {
    const lat = -Math.PI / 2 + (li / latRings) * Math.PI;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * lonDensity));
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * 2 * Math.PI;
      const [px, py, z] = pt(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
      const depth = (z + 1) / 2;
      // the scan: a moving meridian read as a size ripple, not a shine
      const d = angleDelta(lon + t * spin, scan);
      const boost = Math.exp(-(d * d) / 0.18) * Math.max(0, z);
      dots.push({
        x: px, y: py, z,
        r: ((o.rBase ?? 0.6) + (o.rDepth ?? 1.7) * depth + (o.rBoost ?? 1) * boost) * rs,
        white: (o.inkFar ?? 0.62) - (o.inkSpan ?? 0.54) * depth,
        a: dimBase + (1 - dimBase) * Math.min(1, boost) // un-scanned dots fade so the meridian reads
      });
    }
  }
  return finalizeFrame(dots, [], o.rMin);
}

// ---------- Ribbon: an undulating sash ("composing"); face-on, a morphing ring ("breathing") ----------
function frameRibbon(size, t, o) {
  const cx = size / 2, cy = size / 2, R = (size / 2) * 0.78;
  const spin = o.spin ?? 1; // 0 freezes the band's orientation, leaving the travelling undulation
  const camTilt = 0.3;
  const pt = makeProj(t * 0.1 * spin, camTilt, cx, cy, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6);
  const dots = [];
  const ghostN = o.ghostN ?? 150;
  for (let i = 0; i < ghostN; i++) {
    const d = fibDir(i, ghostN);
    const [px, py, z] = pt(d[0] * R, d[1] * R, d[2] * R);
    const depth = (z / R + 1) / 2;
    dots.push({ x: px, y: py, z, r: 0.8 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
  }
  // the band plane, precessing (frozen when spin = 0); face-on reads as a true circle
  const ya = t * 0.24 * spin;
  const ta = o.faceOn ? -camTilt : 0.55 + 0.3 * Math.sin(t * 0.18) * spin;
  const ux = Math.cos(ya), uy = 0, uz = Math.sin(ya);
  const vx = -uz * Math.sin(ta), vy = Math.cos(ta), vz = ux * Math.sin(ta);
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const wobAmp = 0.23 * (o.wobMul ?? 1);
  const baseR = o.faceOn ? R / (1 + 0.85 * wobAmp) : R; // lobes swell past R, so pull the base in
  const lanes = Math.max(1, Math.round((o.lanes ?? 5) * (o.bandMul ?? 1)));
  const segs = o.segs ?? 88;
  for (let w = 0; w < lanes; w++) {
    const laneOff = (w - (lanes - 1) / 2) * 0.075;
    const edge = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * 2 * Math.PI;
      // two travelling waves along the band; wobMul scales the deformation
      const wob = (0.16 * Math.sin(a * 3 - t * 1.7 + w * 0.22) + 0.07 * Math.sin(a * 5 + t * 1.1)) * (o.wobMul ?? 1);
      const radial = o.faceOn ? 1 + wob : 1;
      const off = o.faceOn ? laneOff : laneOff + wob;
      const x = ux * Math.cos(a) + vx * Math.sin(a) + nx * off;
      const y = uy * Math.cos(a) + vy * Math.sin(a) + ny * off;
      const z = uz * Math.cos(a) + vz * Math.sin(a) + nz * off;
      const l = Math.sqrt(x * x + y * y + z * z);
      const rr = baseR * radial;
      const [px, py, zr] = pt((x / l) * rr, (y / l) * rr, (z / l) * rr);
      const depth = (zr / R + 1) / 2;
      dots.push({
        x: px, y: py, z: zr,
        r: ((o.rBase ?? 1.1) + (o.rDepth ?? 1.7) * depth) * (1 - 0.25 * edge) * rs,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        a: 0.4 + 0.6 * depth
      });
    }
  }
  return finalizeFrame(dots, [], o.rMin);
}

// ---------- presets (profiles + the shipped state × size tunings) ----------
const BASE = {
  orbits: { orbitN: 12, ghostN: 40, ghostR: 0.9, ghostA: 0.5, particles: 3, partR: 1.2, partRDepth: 1.6, rsPow: 0.6, rMin: 0.3 },
  globe: { latRings: 17, lonDensity: 44, rBase: 0.6, rDepth: 1.7, rBoost: 1.0, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 },
  ribbon: { lanes: 5, segs: 88, ghostN: 150, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  ring: { lanes: 5, segs: 88, ghostN: 0, faceOn: 1, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 }
};
const PRESETS = {
  orbits: { 64: { speed: 1.885, count: 1, size: 1 }, 32: { speed: 2.9072, count: 0.4251, size: 1.6849 }, 20: { speed: 3.9, count: 0.238, size: 2.4 } },
  globe: { 64: { speed: 2.015, count: 0.42, size: 1.15, extra: { scanMul: 4.08, dimBase: 0.45 } }, 32: { speed: 2.3803, count: 0.1839, size: 1.4769, extra: { scanMul: 4.2301, dimBase: 0.45 } }, 20: { speed: 2.665, count: 0.105, size: 1.75, extra: { scanMul: 4.335, dimBase: 0.45 } } },
  ribbon: { 64: { speed: 2.34, count: 0.25, size: 0.85, extra: { spin: 0, bandMul: 3.9, wobMul: 1 } }, 32: { speed: 2.7776, count: 0.0969, size: 0.9766, extra: { spin: 0, bandMul: 4.49, wobMul: 1 } }, 20: { speed: 3.12, count: 0.051, size: 1.073, extra: { spin: 0, bandMul: 4.94, wobMul: 1 } } },
  ring: { 64: { speed: 3.24, count: 0.25, size: 0.956, extra: { spin: 0, bandMul: 3.627, wobMul: 0.368 } }, 32: { speed: 3.5517, count: 0.0678, size: 1.31, extra: { spin: 0, bandMul: 3.8265, wobMul: 0.4751 } }, 20: { speed: 3.78, count: 0.028, size: 1.622, extra: { spin: 0, bandMul: 3.968, wobMul: 0.565 } } }
};
const PAIRS = [['latRings', 'lonDensity'], ['rings', 'lonDensity'], ['lanes', 'segs']];
const COUNTS = ['orbitN', 'ghostN', 'nodeN', 'strandN', 'signals'];
const RADII = ['rBase', 'rDepth', 'rActive', 'rDot', 'ghostR', 'partR', 'partRDepth', 'nodeR', 'nodeRDepth'];
// grid pairs take √scale each so the total dot count scales by `scale`; flat lists scale linearly
function scaleCounts(opts, scale) {
  const out = { ...opts }, done = new Set(), rt = Math.sqrt(scale);
  for (const [a, b] of PAIRS) {
    if (out[a] != null && out[b] != null && !done.has(a) && !done.has(b)) {
      out[a] = Math.max(2, Math.round(out[a] * rt));
      out[b] = Math.max(2, Math.round(out[b] * rt));
      done.add(a); done.add(b);
    }
  }
  // 0 means the mode opted out of a layer (ring has no ghost sphere): scaling must not bring it back
  for (const k of COUNTS) if (out[k] != null && out[k] !== 0 && !done.has(k)) out[k] = Math.max(1, Math.round(out[k] * scale));
  return out;
}
function scaleRadii(opts, scale) {
  const out = { ...opts };
  for (const k of RADII) if (out[k] != null) out[k] *= scale;
  out.rSizeMul = (out.rSizeMul ?? 1) * scale;
  return out;
}

export const STATE_TO_MODE = { working: 'orbits', searching: 'globe', composing: 'ribbon', breathing: 'ring' };
const FRAMES = { orbits: frameOrbits, globe: frameGlobe, ribbon: frameRibbon, ring: frameRibbon };

// (state, size) → the mode's frame function, its speed and fully-scaled options (resolved once)
const cache = new Map();
export function resolvePreset(state, size) {
  const key = `${state}-${size}`;
  if (cache.has(key)) return cache.get(key);
  const mode = STATE_TO_MODE[state], p = PRESETS[mode][size];
  let opts = { ...BASE[mode] };
  if (p.count !== 1) opts = scaleCounts(opts, p.count);
  if (p.size !== 1) opts = scaleRadii(opts, p.size);
  if (p.extra) opts = { ...opts, ...p.extra };
  const r = { mode, speed: p.speed, opts, frame: FRAMES[mode] };
  cache.set(key, r);
  return r;
}

// One instant of a state: a finished, z-sorted list of dots {x, y, z, r, white, a}.
export function orbFrame(state, size, tSec) {
  const r = resolvePreset(state, size);
  return r.frame(size, tSec, r.opts);
}

// Ink: grayscale by default; with a tint the ink ramp is kept as a ramp on the tint (on a dark
// substrate the ink value is mirrored, 1 - white, so near dots read bright)
export function inkColor(w, alpha, tint) {
  if (!tint) { const g = Math.round((1 - w) * 255); return `rgba(${g},${g},${g},${alpha})`; }
  const ramp = c => Math.round(c * (1 - w));
  return `rgba(${ramp(tint[0])},${ramp(tint[1])},${ramp(tint[2])},${alpha})`;
}

// Paint a finished frame on a dark substrate (Setline is dark), at an overall alpha (for crossfades).
export function paintDots(ctx, dots, { tint = null, alpha = 1 } = {}) {
  for (const d of dots) {
    ctx.fillStyle = inkColor(Math.min(1, Math.max(0, d.white)), (d.a ?? 1) * alpha, tint);
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

