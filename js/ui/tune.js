// Dev-only tuning panel: open the app once with ?tune=1 (remembered; ?tune=0 turns it off) and a small
// panel in the top-right corner has a slider for every value in js/motion.config.js. Changes apply at
// once and are kept in this browser. "Copy values" puts them on the clipboard as JSON (to paste back
// into motion.config.js), "Reset" goes back to the defaults, "Slow-mo ×4" slows every spring and fade.
// Works alongside ?perf=1 (that meter sits top-left). Never shown without the flag.
import { DEFAULTS, M, setValue, reset, setSlowmo, slowmo, applyCss, onTune } from '../motion.config.js';

const RANGES = {
  frostBlur: [0, 40, 1], frostSat: [100, 250, 5], frostBright: [0.5, 1.2, 0.01], tintTop: [0, 1, 0.01], tintBottom: [0, 1, 0.01],
  grain: [0, 0.15, 0.005], frostFadeMs: [60, 600, 10], frostStatic: [0, 1, 1], holdMs: [120, 500, 10], tapSlopPx: [2, 30, 1], lockPx: [30, 200, 5],
  cancelPx: [30, 200, 5], follow: [0, 1, 0.05], orbRestPct: [25, 70, 1], pressScale: [1, 1.3, 0.01], reviewScale: [0.3, 1, 0.05],
  reviewHeightPct: [60, 96, 1], stiffness: [40, 600, 5], damping: [5, 60, 0.5]
};

export function initTune() {
  applyCss();
  onTune(() => applyCss());
  const q = new URLSearchParams(location.search).get('tune');
  try {
    if (q === '1') localStorage.setItem('setline.tuneOn', '1');
    if (q === '0') { localStorage.removeItem('setline.tuneOn'); localStorage.removeItem('setline.tune'); }
    if (localStorage.getItem('setline.tuneOn') !== '1') return;
  } catch { if (q !== '1') return; }
  const box = document.createElement('div');
  box.id = 'tunepanel';
  Object.assign(box.style, {
    position: 'fixed', right: '6px', top: 'calc(env(safe-area-inset-top) + 4px)', zIndex: 99999, width: '236px', maxHeight: '70vh', overflow: 'auto',
    font: '600 11px/1.3 ui-monospace, monospace', color: '#e8f4ff', background: 'rgba(0,0,0,.82)', padding: '6px 8px', borderRadius: '10px'
  });
  const rows = Object.keys(DEFAULTS).map(k => {
    const [min, max, step] = RANGES[k] || [0, DEFAULTS[k] * 2 || 1, 0.01];
    return `<label style="display:block;margin:5px 0 0"><span style="display:flex;justify-content:space-between"><span>${k}</span><b data-v="${k}"></b></span>
      <input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" style="width:100%;margin:2px 0 0"></label>`;
  }).join('');
  const btn = 'style="flex:1;padding:5px 4px;border-radius:6px;background:rgba(255,255,255,.14);color:inherit;font:inherit"';
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px"><b>tune</b><button data-t="fold" ${btn.replace('flex:1;', '')}>–</button></div>
    <div data-t="body">${rows}
      <div style="display:flex;gap:4px;margin-top:8px"><button data-t="copy" ${btn}>Copy values</button><button data-t="reset" ${btn}>Reset</button></div>
      <button data-t="slow" ${btn.replace('flex:1;', 'width:100%;margin-top:4px;')}>Slow-mo ×4</button></div>`;
  document.body.append(box);
  const paint = () => {
    for (const i of box.querySelectorAll('input[data-k]')) { i.value = M[i.dataset.k]; box.querySelector(`[data-v="${i.dataset.k}"]`).textContent = +M[i.dataset.k].toFixed(3); }
    box.querySelector('[data-t=slow]').style.background = slowmo > 1 ? 'rgba(140,242,223,.4)' : 'rgba(255,255,255,.14)';
  };
  paint();
  onTune(paint);
  box.addEventListener('input', e => { const k = e.target.dataset.k; if (k) setValue(k, parseFloat(e.target.value)); });
  box.addEventListener('click', async e => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'fold') { const b = box.querySelector('[data-t=body]'); const open = b.style.display === 'none'; b.style.display = open ? '' : 'none'; e.target.textContent = open ? '–' : '+'; }
    if (t === 'reset') reset();
    if (t === 'slow') setSlowmo(slowmo === 1);
    if (t === 'copy') {
      const json = JSON.stringify(M, null, 2);
      try { await navigator.clipboard.writeText(json); e.target.textContent = 'Copied'; } catch { prompt('Values', json); }
      setTimeout(() => { e.target.textContent = 'Copy values'; }, 1200);
    }
  });
}
