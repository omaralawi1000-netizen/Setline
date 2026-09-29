// Pure geometry for the dock's two glass lobes joining around their existing orb.
export const clamp = x => Math.max(0, Math.min(1, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, p) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };

// All intermediate contours have the same cubic topology. The neck opens before the
// left lobe resolves into the composer, so the material joins rather than cross-fades.
export function joinedGlass(width, height, split, p) {
  const r = height / 2, right = width - r;
  const join = mix(Math.min(split - r, right - r * 1.5), right - r, smooth(0.08, 0.8, p));
  const neck = mix(r - 1, 0, smooth(0.02, 0.55, p));
  const mid = (join + right) / 2;
  const n = x => Number(x.toFixed(2));
  return `M ${n(r)} 0 L ${n(join)} 0 C ${n(join + r * .55)} 0 ${n(mid - r * .25)} ${n(neck)} ${n(mid)} ${n(neck)} C ${n(mid + r * .25)} ${n(neck)} ${n(right - r * .55)} 0 ${n(right)} 0 C ${n(right + r * .552)} 0 ${n(width)} ${n(r * .448)} ${n(width)} ${n(r)} C ${n(width)} ${n(r * 1.552)} ${n(right + r * .552)} ${n(height)} ${n(right)} ${n(height)} C ${n(right - r * .55)} ${n(height)} ${n(mid + r * .25)} ${n(height - neck)} ${n(mid)} ${n(height - neck)} C ${n(mid - r * .25)} ${n(height - neck)} ${n(join + r * .55)} ${n(height)} ${n(join)} ${n(height)} L ${n(r)} ${n(height)} C ${n(r * .448)} ${n(height)} 0 ${n(r * 1.552)} 0 ${n(r)} C 0 ${n(r * .448)} ${n(r * .448)} 0 ${n(r)} 0 Z`;
}

// A retargeted segment begins at the current presentation value, including reversal.
export function segmentValue(from, to, elapsed, duration) {
  const t = clamp(elapsed / duration);
  const eased = t === 1 ? 1 : 1 - Math.pow(1 - t, 3);
  return mix(from, to, eased);
}
