// The month as a picture you can keep or share: drawn on a canvas in the app's own colours.
import { state } from '../store.js';
import { monthRecap } from '../recap.js';
import { weight, total } from '../format.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet } from './sheet.js';

const W = 1080, H = 1350;

function draw(r) {
  const { t, lang, settings } = state;
  const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
  const bg = v('--bg') || '#0d0f15', ink = v('--ink') || '#f1f0f6', muted = v('--muted') || '#9a98a8', accent = v('--accent') || '#b9a6ff', accent2 = v('--accent2') || accent;
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // the glow, as in the app
  const glow = (x, y, rad, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, col); gr.addColorStop(1, 'transparent'); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1; };
  glow(240, 120, 760, accent, 0.28); glow(980, 1250, 700, accent2, 0.2);
  const unit = t('unit.' + settings.unit);
  const month = new Intl.DateTimeFormat(lang === 'da' ? 'da-DK' : 'en-GB', { month: 'long', year: 'numeric' }).format(r.from);
  // max: the widest it may be; bigger text steps down until it fits
  const text = (s, x, y, size, col, weightN = 800, align = 'left', max = W - 180) => {
    let px = size;
    do { g.font = `${weightN} ${px}px ${font}`; px -= 2; } while (g.measureText(s).width > max && px > 20);
    g.fillStyle = col; g.textAlign = align; g.fillText(s, x, y);
  };
  text('SETLINE', 90, 150, 34, muted, 800);
  text(month.charAt(0).toUpperCase() + month.slice(1), 90, 250, 92, ink, 850);
  text(t(r.whole ? 'recap.whole' : 'recap.soFar'), 90, 310, 36, muted, 650);
  // three big numbers
  const big = [[String(r.sessions), t('recap.sessions')], [total(r.volume, settings.unit, lang), `${t('recap.volume')}, ${unit}`], [String(r.records), t('recap.records')]];
  const cols = [[90, 200], [320, 430], [790, 200]];
  big.forEach(([n, l], i) => { const [x, w] = cols[i]; text(n, x, 480, 96, ink, 850, 'left', w); text(l, x, 530, 32, muted, 650, 'left', w); });
  // the lifts that moved
  let y = 660;
  if (r.moves.length) {
    text(t('recap.moved').toUpperCase(), 90, y, 30, muted, 800); y += 70;
    for (const m of r.moves) {
      text(state.catalog.name(m.id, lang), 90, y, 44, ink, 750, 'left', 640);
      text(`+${weight(m.change, settings.unit, lang)} ${unit}`, W - 90, y, 44, accent, 850, 'right');
      y += 74;
    }
  }
  // body and cardio
  y = Math.max(y + 30, 1060);
  const bits = [];
  if (r.bodyweight) { const d = r.bodyweight.to - r.bodyweight.from; bits.push([`${d > 0 ? '+' : d < 0 ? '−' : '±'}${weight(Math.round(Math.abs(d) * 10) / 10, settings.unit, lang)} ${unit}`, t('recap.bodyweight')]); }
  if (r.cardioMin) bits.push([`${r.cardioMin} min`, t('recap.cardio')]);
  bits.forEach(([n, l], i) => { const x = 90 + i * 480; text(n, x, y + 60, 64, ink, 850); text(l, x, y + 108, 30, muted, 650); });
  // a thin accent line at the foot
  const ln = g.createLinearGradient(90, 0, W - 90, 0); ln.addColorStop(0, accent); ln.addColorStop(1, accent2);
  g.fillStyle = ln; g.fillRect(90, H - 110, W - 180, 6);
  return c;
}

export function openRecap() {
  const { t } = state;
  const r = monthRecap({ history: state.history, prs: state.prs, bodyweight: state.bodyweight, cardio: state.cardio });
  if (!r) { toast({ title: esc(t('recap.none')) }); return; }
  const canvas = draw(r);
  const url = canvas.toDataURL('image/png');
  openSheet(el => {
    el.innerHTML = `<div class="sbody"><h2>${t('recap.title')}</h2>
      <img class="recapimg" src="${url}" alt="${esc(t('recap.title'))}">
      <div class="acts"><button class="log" data-rc="share">${I.upload}<span>${t('recap.share')}</span></button><button class="btn2 solid" data-rc="save">${I.download}<span>${t('recap.save')}</span></button></div></div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-rc]');
      if (!b) return;
      haptic('tap');
      canvas.toBlob(async blob => {
        if (!blob) return;
        const name = `setline-${new Date(r.from).toISOString().slice(0, 7)}.png`;
        const file = new File([blob], name, { type: 'image/png' });
        if (b.dataset.rc === 'share' && navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: t('recap.title') }); } catch {}
          return;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast({ title: esc(t('recap.saved')) });
      }, 'image/png');
    });
  }, { label: t('recap.title') });
}
