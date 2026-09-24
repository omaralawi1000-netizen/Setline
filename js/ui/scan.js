// Barcode scanner: live camera with a lock-on animation, Open Food Facts lookup, amount picker.
// Fallbacks: type the number, or snap the nutrition label and Gemini reads it.
import * as store from '../store.js';
import { state } from '../store.js';
import * as db from '../db.js';
import { validBarcode, lookup, forAmount, amountChoices, fromLabel, LABEL_SCHEMA, labelPrompt, remember } from '../food.js';
import { aiMeal, withFallback } from '../ai.js';
import { coachModels } from '../settings.js';
import { getKey } from '../keys.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { burst } from './fx.js';
import { openSheet, closeTop } from './sheet.js';
import { prepImage } from './meal.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const BARCODE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v12M7 6v12M10.5 6v12M13 6v12M16.5 6v12M20 6v12" stroke-width="1.6"/><path d="M3 4h3M18 4h3M3 20h3M18 20h3" /></svg>';
const TORCH = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1.5 5h-5zM9.5 8h5l-1 13h-3z"/></svg>';
export const scanIcon = BARCODE;

export const canDetect = async () => {
  try { return 'BarcodeDetector' in globalThis && (await BarcodeDetector.getSupportedFormats()).some(f => FORMATS.includes(f)); } catch { return false; }
};

async function products() { return (await db.get('meta', 'products').catch(() => null)) || []; }
async function keep(p) { if (p.code) await db.put('meta', remember(await products(), p), 'products').catch(() => {}); }

// A small data-URL thumbnail from the product photo (if the image server allows it).
async function thumbOf(url) {
  if (!url) return undefined;
  try {
    const r = await fetch(url);
    const bmp = await createImageBitmap(await r.blob());
    const k = Math.min(1, 132 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  } catch { return undefined; }
}

export function openScanner() {
  const { t } = state;
  const s = { stream: null, det: null, timer: 0, last: null, seen: 0, done: false, product: null, grams: 100, code: '' };
  const stop = () => { clearTimeout(s.timer); s.stream?.getTracks().forEach(x => x.stop()); s.stream = null; };
  const api = openSheet(box => {
    const render = html => { box.innerHTML = html; };

    // ---------- camera ----------
    async function camera() {
      s.done = false;
      render(`<div class="scanview">
        <video playsinline muted autoplay></video>
        <div class="scanwin" id="scanwin"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><i class="laser"></i></div>
        <div class="scantop"><span class="scanhint" id="scanhint">${t('scan.point')}</span><button class="iconbtn glassbtn" data-s="torch" hidden aria-label="${esc(t('scan.torch'))}">${TORCH}</button></div>
        <div class="scanbar"><button class="glasspill" data-s="manual">${t('scan.type')}</button><button class="glasspill" data-s="label">${I.camera}<span>${t('scan.label')}</span></button></div>
      </div>`);
      if (!(await canDetect())) return manual(t('scan.noDetector'));
      try {
        s.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) { return manual(t(e?.name === 'NotAllowedError' ? 'scan.denied' : 'scan.noCamera')); }
      const video = box.querySelector('video');
      if (!video) return stop();
      video.srcObject = s.stream;
      await video.play().catch(() => {});
      const track = s.stream.getVideoTracks()[0];
      if (track?.getCapabilities?.().torch) box.querySelector('[data-s=torch]').hidden = false;
      s.det = new BarcodeDetector({ formats: FORMATS });
      loop(video);
    }

    async function loop(video) {
      if (!s.stream || s.done) return;
      try {
        const found = (await s.det.detect(video)).find(b => validBarcode(b.rawValue));
        if (found) {
          if (found.rawValue === s.last && performance.now() - s.seen < 1200) return lock(video, found);
          s.last = found.rawValue; s.seen = performance.now();
        }
      } catch {}
      s.timer = setTimeout(() => loop(video), 110);
    }

    // the window snaps onto the code, flashes, and the product card rises
    function lock(video, found) {
      s.done = true;
      s.code = found.rawValue;
      haptic('success');
      const win = box.querySelector('#scanwin');
      const r = video.getBoundingClientRect();
      const vw = video.videoWidth || r.width, vh = video.videoHeight || r.height;
      const k = Math.max(r.width / vw, r.height / vh); // object-fit: cover
      const ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
      const b = found.boundingBox;
      if (b && win) {
        const pad = 14;
        const x = b.x * k + ox - pad, y = b.y * k + oy - pad, w = b.width * k + pad * 2, h = b.height * k + pad * 2;
        const w0 = win.getBoundingClientRect(), v0 = r;
        win.style.setProperty('--tx', `${(x + w / 2) - (w0.left - v0.left + w0.width / 2)}px`);
        win.style.setProperty('--ty', `${(y + h / 2) - (w0.top - v0.top + w0.height / 2)}px`);
        win.style.setProperty('--sx', (w / w0.width).toFixed(3));
        win.style.setProperty('--sy', (h / w0.height).toFixed(3));
      }
      win?.classList.add('locked');
      video.pause();
      setTimeout(() => burst(win, { count: 16, spread: 90 }), 180);
      setTimeout(() => { stop(); find(s.code); }, 520);
    }

    // ---------- lookup and product ----------
    async function find(code) {
      s.code = code;
      render(`<div class="pwrap"><div class="pcard glass loading"><div class="sk a"></div><div class="sk b"></div><div class="sk c"></div><p class="scode">${esc(code)}</p></div></div>`);
      const known = (await products()).find(p => p.code === code);
      if (known) return show(known);
      const r = await lookup(code, state.lang);
      if (r.status === 'ok') { await keep(r.product); return show(r.product); }
      missing(r.status);
    }

    function show(p) {
      s.product = p;
      const choices = amountChoices(p);
      s.grams = choices[0]?.g || 100;
      paintProduct(true);
    }

    function paintProduct(first = false) {
      const p = s.product, n = forAmount(p, s.grams);
      const choices = amountChoices(p);
      const label = c => (c.kind === 'serving' ? t('scan.serving', { g: c.g }) : c.kind === 'pack' ? t('scan.pack', { g: c.g }) : '100 g');
      const html = `<div class="pwrap"><div class="pcard glass${first ? ' in' : ''}">
        <div class="phead">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<span class="picon">${BARCODE}</span>`}
          <div><strong>${esc(p.name || t('scan.unnamed'))}</strong><span>${esc([p.brand, t('scan.per100', { p: p.per100.protein, k: p.per100.kcal })].filter(Boolean).join(' · '))}</span></div></div>
        <div class="mnums">
          <div class="mnum hot"><b>${n.protein}</b><span>${t('meal.protein')}</span></div>
          <div class="mnum"><b>${n.kcal}</b><span>kcal</span></div>
          <div class="mnum sm"><b>${n.carbs}</b><span>${t('meal.carbs')}</span></div>
          <div class="mnum sm"><b>${n.fat}</b><span>${t('meal.fat')}</span></div>
        </div>
        <div class="amounts">${choices.map(c => `<button class="chip" data-g="${c.g}" aria-pressed="${c.g === s.grams}">${esc(label(c))}</button>`).join('')}
          <label class="gram"><input inputmode="numeric" data-s="grams" value="${choices.some(c => c.g === s.grams) ? '' : s.grams}" placeholder="${esc(t('scan.grams'))}" aria-label="${esc(t('scan.grams'))}"><span>g</span></label></div>
        <button class="log" data-s="add">${I.check}<span>${t('meal.save', { g: n.protein })}</span></button>
        <button class="linkbtn muted" data-s="again">${t('scan.again')}</button>
      </div></div>`;
      if (first) return render(html);
      // update numbers and chips in place
      const card = box.querySelector('.pcard');
      const nums = card.querySelectorAll('.mnum b');
      [n.protein, n.kcal, n.carbs, n.fat].forEach((v, i) => { if (nums[i].textContent !== String(v)) { nums[i].textContent = v; nums[i].classList.remove('tick'); void nums[i].offsetWidth; nums[i].classList.add('tick'); } });
      for (const c of card.querySelectorAll('[data-g]')) c.setAttribute('aria-pressed', String(Number(c.dataset.g) === s.grams));
      card.querySelector('[data-s=add] span').textContent = t('meal.save', { g: n.protein });
    }

    function missing(status) {
      const msg = status === 'missing' ? t('scan.missing') : status === 'offline' ? t('coach.offline') : t('scan.failed');
      render(`<div class="pwrap"><div class="pcard glass in"><div class="empty"><div class="emptyglyph">${BARCODE}</div><h2>${esc(msg)}</h2><p>${t('scan.missingSub')}</p></div>
        <button class="log" data-s="label">${I.camera}<span>${t('scan.label')}</span></button>
        <button class="linkbtn muted" data-s="again">${t('scan.again')}</button></div></div>`);
    }

    function manual(note = '') {
      stop();
      render(`<div class="pwrap"><div class="pcard glass in"><h2>${t('scan.type')}</h2>${note ? `<p class="lead">${esc(note)}</p>` : ''}
        <form class="mdesc solid" data-s="code"><input name="code" inputmode="numeric" autocomplete="off" placeholder="5701234567899" aria-label="${esc(t('scan.type'))}"><button class="send" aria-label="${esc(t('voice.send'))}">${I.fwd}</button></form>
        <p class="err" id="codeerr"></p>
        <button class="btn2 solid" data-s="label">${I.camera}<span>${t('scan.label')}</span></button></div></div>`);
    }

    async function readLabel(file) {
      const key = getKey('google');
      if (!key) { toast({ title: esc(t('meal.noKey')), error: true }); return; }
      render(`<div class="pwrap"><div class="pcard glass loading"><div class="sk a"></div><div class="sk b"></div><div class="sk c"></div><p class="scode">${t('scan.reading')}</p></div></div>`);
      try {
        const img = await prepImage(file);
        const raw = await withFallback(coachModels(state.settings), model => aiMeal({ key, model, image: { mime: img.mime, data: img.data }, prompt: labelPrompt(state.lang), schema: LABEL_SCHEMA }), { rounds: 2 });
        const p = fromLabel(raw, s.code);
        if (!p) return missing('label');
        await keep(p);
        haptic('success');
        show(p);
      } catch { missing('failed'); }
    }

    // ---------- events ----------
    box.addEventListener('click', async e => {
      const g = e.target.closest('[data-g]');
      if (g) { s.grams = Number(g.dataset.g); const inp = box.querySelector('[data-s=grams]'); if (inp) inp.value = ''; haptic('tap'); return paintProduct(); }
      const k = e.target.closest('[data-s]')?.dataset.s;
      if (k === 'torch') {
        const track = s.stream?.getVideoTracks()[0];
        s.torch = !s.torch;
        track?.applyConstraints({ advanced: [{ torch: s.torch }] }).catch(() => {});
        e.target.closest('button').classList.toggle('is-on', s.torch);
        haptic('tap');
      } else if (k === 'manual') manual();
      else if (k === 'label') {
        const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
        inp.setAttribute('capture', 'environment');
        inp.onchange = () => { if (inp.files?.[0]) { stop(); readLabel(inp.files[0]); } };
        inp.click();
      } else if (k === 'again') { s.product = null; s.code = ''; camera(); }
      else if (k === 'add') {
        const p = s.product, n = forAmount(p, s.grams);
        e.target.closest('button').disabled = true;
        const name = `${p.name || t('scan.unnamed')} · ${s.grams} g`;
        const thumb = await thumbOf(p.image);
        const meal = await store.logMeal({ name, ...n, source: 'barcode', thumb });
        await closeTop();
        haptic('success');
        toast({ title: `${esc(p.name || t('scan.unnamed'))} <span class="v">+${n.protein} g</span>`, sub: `${s.grams} g · ${n.kcal} kcal`, action: t('common.undo'), onAction: () => store.deleteMeal(meal.id) });
      }
    });
    box.addEventListener('input', e => {
      if (e.target.dataset.s !== 'grams') return;
      const v = Math.round(Number(e.target.value));
      if (v > 0 && v <= 3000) { s.grams = v; paintProduct(); }
    });
    box.addEventListener('submit', e => {
      e.preventDefault();
      const code = String(e.target.code?.value || '').replace(/\D/g, '');
      if (!validBarcode(code)) { box.querySelector('#codeerr').textContent = t('scan.badCode'); haptic('error'); return; }
      e.target.code.blur();
      find(code);
    });
    camera();
  }, { label: t('scan.title'), onClose: stop });
  api.sheet.classList.add('scansheet');
  document.addEventListener('visibilitychange', function hide() {
    if (document.visibilityState === 'hidden') { stop(); document.removeEventListener('visibilitychange', hide); }
  });
}
