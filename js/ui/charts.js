// Small SVG charts. Animations are transform/opacity/stroke-dashoffset only, set up in CSS.
import { esc } from './dom.js';

let gid = 0;

// Bars: values [{v, label?, hot?}] → the same picture the SVG version drew, as plain boxes: bars
// growing inside an SVG made the phone lay the chart out again on every frame, while a box's
// transform runs on the GPU. They grow from the baseline one after another. Geometry is in the old
// viewBox units, as percentages of the chart.
export function barChart(values, { h = 120, w = 340, color = 'lav', fmt = v => String(v), axis = [] } = {}) {
  const n = values.length;
  if (!n) return '';
  const max = Math.max(1, ...values.map(x => x.v));
  const gap = 6, bw = (w - gap * (n - 1)) / n, H = h + 18;
  const pc = (a, b) => `${((a / b) * 100).toFixed(3)}%`;
  const bars = values.map((x, i) => {
    const bh = x.v ? Math.max(3, (x.v / max) * (h - 18)) : 2;
    const tip = `${x.label || ''} ${fmt(x.v)}`.trim();
    return `<i class="bar-r${x.hot ? ' hot' : ''}${x.v ? '' : ' zero'}" title="${esc(tip)}" style="--i:${i};left:${pc(i * (bw + gap), w)};width:${pc(bw, w)};bottom:${pc(18, H)};height:${pc(bh, H)};border-radius:${Math.min(6, bw / 2).toFixed(1)}px"></i>`;
  }).join('');
  return `<div class="chart bars hbars${color === 'blue' ? ' blue' : ''}" style="aspect-ratio:${w} / ${H}" role="img" aria-label="${esc(values.map(x => `${x.label || ''} ${fmt(x.v)}`.trim()).join(', '))}">
    <b class="base" style="bottom:${pc(17.5, H)}"></b>
    ${bars}
    ${axis.map(a => { const side = a.x === 'end' ? 'ax ax-end' : 'ax'; return `<span class="${side}">${esc(a.text)}</span>`; }).join('')}
  </div>`;
}

// Line with area and dots: points [{t, v}] → SVG that draws itself in.
// scatter: the raw values under a smoothed line (e.g. each weigh-in under the weight trend), as faint dots
export function lineChart(points, { h = 150, w = 340, pad = 12, dots = true, warmLast = false, fmt = v => String(v), yLabels = true, scatter = null } = {}) {
  if (points.length < 2) return '';
  const vs = [...points, ...(scatter || [])].map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const span = hi - lo;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const tx = t => (t1 === t0 ? w / 2 : pad + ((t - t0) / (t1 - t0)) * (w - pad * 2));
  const ty = v => h - pad - ((v - lo) / span) * (h - pad * 2);
  const pts = points.map(p => [tx(p.t), ty(p.v)]);
  // gentle curve through the points
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const id = `l${++gid}`;
  const last = pts[pts.length - 1];
  const area = `${d} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  // the dots and the record's halo pop and pulse, so they're boxes over the line (a transform inside an
  // SVG lays the whole chart out again on every frame; a box's runs on the GPU)
  const at = (x, y, r) => `left:${((x - r) / w * 100).toFixed(3)}%;top:${((y - r) / h * 100).toFixed(3)}%;width:${(2 * r / w * 100).toFixed(3)}%`;
  const dotEls = dots ? pts.map(([x, y], i) => `<i class="dot${i === pts.length - 1 && warmLast ? ' warm' : ''}" title="${esc(fmt(points[i].v))}" style="--i:${i};${at(x, y, i === pts.length - 1 ? 4.5 : 2.6)}"></i>`).join('') : '';
  return `<div class="chart line hline" role="img">
  <svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)" stop-opacity=".3"/><stop offset="1" style="stop-color:var(--accent)" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient>
    </defs>
    ${yLabels ? `<text class="ax" x="0" y="10">${esc(fmt(hi))}</text><text class="ax" x="0" y="${h - 2}">${esc(fmt(lo))}</text>` : ''}
    <path class="area" d="${area}" fill="url(#${id}f)"/>
    <path class="stroke" d="${d}" pathLength="1" fill="none" stroke="url(#${id}s)" stroke-width="2.6" stroke-linecap="round"/>
    ${scatter ? scatter.map(p => `<circle class="raw" cx="${tx(p.t).toFixed(1)}" cy="${ty(p.v).toFixed(1)}" r="2.2"/>`).join('') : ''}
  </svg>
  ${warmLast ? `<i class="halo" style="${at(last[0], last[1], 10)}"></i>` : ''}${dotEls}
  </div>`;
}
