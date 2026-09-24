// Meal logging: snap a photo (or describe it) and Gemini estimates protein and calories.
import * as store from '../store.js';
import { state } from '../store.js';
import { aiMeal, withFallback, AiError } from '../ai.js';
import { coachModels } from '../settings.js';
import { getKey } from '../keys.js';
import { MEAL_SCHEMA, mealPrompt, validateMeal, scaleMeal, dayOf } from '../meals.js';
import { dateKey } from '../body.js';
import { haptic } from '../haptics.js';
import { esc } from './dom.js';
import { I } from './icons.js';
import { toast } from './toast.js';
import { openSheet, closeTop } from './sheet.js';

const PORTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FRAC = { 0.5: '½', 0.75: '¾', 1: '1', 1.25: '1¼', 1.5: '1½', 2: '2' };

// ---------- image prep: downscale on the phone, so uploads are small and fast ----------

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

function draw(src, max) {
  const w = src.width, h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// {data: base64 JPEG ~1024 px, mime, thumb: small data URL, preview: data URL}
export async function prepImage(file) {
  const bmp = await loadBitmap(file);
  const big = draw(bmp, 1024);
  const url = big.toDataURL('image/jpeg', 0.82);
  const thumb = draw(bmp, 132).toDataURL('image/jpeg', 0.7);
  bmp.close?.();
  return { mime: 'image/jpeg', data: url.split(',')[1], preview: url, thumb };
}

// ---------- the sheet ----------

export function openMealSheet({ text = '' } = {}) {
  const { t } = state;
  openSheet(box => {
    const s = { draft: null, base: null, portion: 1, image: null, text: '', ctl: null };
    const chooser = () => {
      box.innerHTML = `<div class="sbody meal">
        <h2>${t('meal.title')}</h2><p class="lead">${t('meal.sub')}</p>
        <div class="mpick">
          <label class="mbig glass">${I.camera}<span>${t('meal.photo')}</span><input type="file" accept="image/*" capture="environment" hidden data-m="file"></label>
          <label class="mbig solid">${I.image}<span>${t('meal.gallery')}</span><input type="file" accept="image/*" hidden data-m="file"></label>
        </div>
        <form class="mdesc solid" data-m="describe"><input name="q" enterkeyhint="send" autocomplete="off" placeholder="${esc(t('meal.describePh'))}" aria-label="${esc(t('meal.describe'))}"><button class="send" aria-label="${esc(t('voice.send'))}">${I.fwd}</button></form>
        ${todayHTML()}
      </div>`;
    };
    const analysing = () => {
      box.innerHTML = `<div class="sbody meal">
        <div class="mphoto${s.image ? '' : ' text'}">${s.image ? `<img src="${esc(s.image.preview)}" alt="">` : `<p>“${esc(s.text)}”</p>`}<i class="scan"></i></div>
        <p class="mthink"><span class="dots"><i></i><i></i><i></i></span>${t('meal.reading')}</p>
        <button class="linkbtn muted" data-m="cancel">${t('common.cancel')}</button>
      </div>`;
    };
    const result = () => {
      const d = s.draft;
      box.innerHTML = `<div class="sbody meal">
        <div class="mhead">${s.image ? `<img class="mthumb" src="${esc(s.image.thumb)}" alt="">` : `<span class="mthumb icon">${I.meal}</span>`}
          <div><h2>${esc(d.name)}</h2><span class="mconf ${d.confidence}">${t('meal.conf.' + d.confidence)}</span></div></div>
        <div class="mnums">
          <div class="mnum hot"><b data-count="${d.protein}">${d.protein}</b><span>${t('meal.protein')}</span></div>
          <div class="mnum"><b data-count="${d.kcal}">${d.kcal}</b><span>kcal</span></div>
          <div class="mnum sm"><b>${d.carbs}</b><span>${t('meal.carbs')}</span></div>
          <div class="mnum sm"><b>${d.fat}</b><span>${t('meal.fat')}</span></div>
        </div>
        <div class="field"><label>${t('meal.portion')}</label><div class="mport" role="group">${PORTIONS.map(p => `<button class="chip" data-p="${p}" aria-pressed="${p === s.portion}">${FRAC[p]}×</button>`).join('')}</div></div>
        ${d.items.length ? `<ul class="mitems">${d.items.map((i, k) => `<li style="--i:${k}"><span>${esc(i.name)}</span><em>${i.grams} g</em><b>${Math.round(i.protein)} g</b></li>`).join('')}</ul>` : ''}
        <form class="mdesc solid" data-m="fix"><input name="q" enterkeyhint="send" autocomplete="off" placeholder="${esc(t('meal.fixPh'))}" aria-label="${esc(t('meal.fix'))}"><button class="send" aria-label="${esc(t('voice.send'))}">${I.fwd}</button></form>
        <div class="acts"><button class="log" data-m="save">${I.check}<span>${t('meal.save', { g: d.protein })}</span></button>
          <button class="linkbtn muted" data-m="again">${t('meal.again')}</button></div>
      </div>`;
    };
    const failed = (code) => {
      const msg = code === 'nokey' ? t('meal.noKey') : code === 'notfood' ? t('meal.notFood') : code === 'offline' || code === 'network' ? t('coach.offline') : code === 'busy' ? t('coach.busy') : t('meal.failed');
      box.innerHTML = `<div class="sbody meal"><div class="empty"><div class="emptyglyph">${I.meal}</div><h2>${esc(msg)}</h2></div>
        <div class="acts">${code === 'nokey' ? '' : `<button class="log" data-m="retry"><span>${t('coach.retry')}</span></button>`}<button class="linkbtn muted" data-m="again">${t('meal.again')}</button></div></div>`;
    };

    async function estimate() {
      const key = getKey('google');
      if (!key) return failed('nokey');
      analysing();
      s.ctl?.abort();
      const ctl = s.ctl = new AbortController();
      try {
        const raw = await withFallback(coachModels(state.settings), model => aiMeal({
          key, model, image: s.image ? { mime: s.image.mime, data: s.image.data } : null,
          prompt: mealPrompt(s.text, state.lang), schema: MEAL_SCHEMA, signal: ctl.signal
        }), { rounds: 2 });
        if (ctl !== s.ctl) return;
        const d = validateMeal(raw);
        if (!d) return failed('notfood');
        s.base = d; s.portion = 1; s.draft = d;
        haptic('success');
        result();
      } catch (e) {
        if (ctl !== s.ctl || e?.code === 'aborted') return;
        failed(e instanceof AiError ? e.code : 'failed');
      }
    }

    box.addEventListener('change', async e => {
      const f = e.target.closest('[data-m=file]');
      if (!f?.files?.[0]) return;
      try { s.image = await prepImage(f.files[0]); } catch { return failed('failed'); }
      s.text = '';
      estimate();
    });
    box.addEventListener('submit', e => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      if (!q) return;
      e.target.q.blur();
      if (e.target.dataset.m === 'describe') { s.image = null; s.text = q; }
      else s.text = q; // a correction keeps the photo
      estimate();
    });
    box.addEventListener('click', async e => {
      const p = e.target.closest('[data-p]');
      if (p) { s.portion = Number(p.dataset.p); s.draft = scaleMeal(s.base, s.portion); haptic('tap'); return result(); }
      const del = e.target.closest('[data-meal-del]');
      if (del) { await store.deleteMeal(del.dataset.mealDel); haptic('tap'); return chooser(); }
      const k = e.target.closest('[data-m]')?.dataset.m;
      if (k === 'cancel') { s.ctl?.abort(); s.ctl = null; return chooser(); }
      if (k === 'again') { s.image = null; s.text = ''; s.draft = null; return chooser(); }
      if (k === 'retry') return estimate();
      if (k === 'save') {
        const d = s.draft;
        e.target.closest('button').disabled = true;
        const meal = await store.logMeal({ ...d, source: s.image ? 'photo' : 'text', thumb: s.image?.thumb });
        await closeTop();
        haptic('success');
        toast({ title: `${esc(d.name)} <span class="v">+${d.protein} g</span>`, sub: `${d.kcal} kcal`, action: t('common.undo'), onAction: () => store.deleteMeal(meal.id) });
      }
    });
    if (text) { s.text = text; estimate(); } else chooser();
  }, { label: t('meal.title') });
}

function todayHTML() {
  const { t } = state;
  const d = dayOf(state.nutrition, dateKey());
  const meals = d.meals || [];
  if (!meals.length) return '';
  return `<div class="section"><span class="label">${t('meal.today')}</span><span class="mtot">${d.protein || 0} g · ${d.kcal || 0} kcal</span></div>
    <ul class="mlist">${[...meals].reverse().map(m => `<li>${m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : `<span class="mthumb icon sm">${I.meal}</span>`}
      <span class="l"><strong>${esc(m.name)}</strong><span>${m.protein} g · ${m.kcal} kcal</span></span>
      <button class="iconbtn" data-meal-del="${esc(m.id)}" aria-label="${esc(t('common.delete'))}">${I.trash}</button></li>`).join('')}</ul>`;
}
