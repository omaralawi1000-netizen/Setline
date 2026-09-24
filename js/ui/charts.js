// Small SVG charts. Animations are transform/opacity/stroke-dashoffset only, set up in CSS.
import { esc } from './dom.js';

let gid = 0;

// Bars: values [{v, label?, hot?}] → SVG. Bars grow from the baseline one after another.
export function barChart(values, { h = 120, w = 340, color = 'lav', fmt = v => String(v), axis = [] } = {}) {
  const n = values.length;
  if (!n) return '';
  const max = Math.max(1, ...values.map(x => x.v));
  const gap = 6, bw = (w - gap * (n - 1)) / n;
  const id = `b${++gid}`;
  const bars = values.map((x, i) => {
    const bh = x.v ? Math.max(3, (x.v / max) * (h - 18)) : 2;
    const xPos = i * (bw + gap);
    return `<rect class="bar-r${x.hot ? ' hot' : ''}${x.v ? '' : ' zero'}" style="--i:${i}" x="${xPos.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(6, bw / 2).toFixed(1)}" fill="url(#${id})"><title>${esc(x.label || '')} ${esc(fmt(x.v))}</title></rect>`;
  }).join('');
  const stops = color === 'blue' ? ['#5B86FF', '#3E5FCC'] : ['var(--accent-hi)', 'var(--violet)'];
  return `<svg class="chart bars" viewBox="0 0 ${w} ${h + 18}" preserveAspectRatio="none" role="img">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${stops[0]}"/><stop offset="1" style="stop-color:${stops[1]}" stop-opacity=".55"/></linearGradient></defs>
    <line class="base" x1="0" x2="${w}" y1="${h + .5}" y2="${h + .5}"/>
    ${bars}
    ${axis.map(a => `<text class="ax" x="${a.x === 'end' ? w : 0}" y="${h + 14}" text-anchor="${a.x === 'end' ? 'end' : 'start'}">${esc(a.text)}</text>`).join('')}
  </svg>`;
}

// Line with area and dots: points [{t, v}] → SVG that draws itself in.
export function lineChart(points, { h = 150, w = 340, pad = 12, dots = true, warmLast = false, fmt = v => String(v), yLabels = true } = {}) {
  if (points.length < 2) return '';
  const vs = points.map(p => p.v);
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
  const dotEls = dots ? pts.map(([x, y], i) => `<circle class="dot" style="--i:${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 2.6}"${i === pts.length - 1 && warmLast ? ' fill="#FFD9A8"' : ''}><title>${esc(fmt(points[i].v))}</title></circle>`).join('') : '';
  return `<svg class="chart line" viewBox="0 0 ${w} ${h}" role="img">
    <defs>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)" stop-opacity=".3"/><stop offset="1" style="stop-color:var(--accent)" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--violet)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient>
    </defs>
    ${yLabels ? `<text class="ax" x="0" y="10">${esc(fmt(hi))}</text><text class="ax" x="0" y="${h - 2}">${esc(fmt(lo))}</text>` : ''}
    <path class="area" d="${area}" fill="url(#${id}f)"/>
    <path class="stroke" d="${d}" pathLength="1" fill="none" stroke="url(#${id}s)" stroke-width="2.6" stroke-linecap="round"/>
    ${dotEls}
    ${warmLast ? `<circle class="halo" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="10" fill="#FFD9A8"/>` : ''}
  </svg>`;
}
