// Food search: common Danish foods on the phone (instant, offline) and Danish products from
// Open Food Facts (online). Both come out as the same product shape the scanner uses. Pure (plus one fetch).
import { FOODS_DK } from '../data/foods-dk.js';
import { normalize } from './catalog.js';
import { fromOff } from './food.js';

const toProduct = (f, lang) => ({
  code: 'dk:' + f[0], name: lang === 'da' ? f[1] : f[2], alt: lang === 'da' ? f[2] : f[1], brand: '',
  per100: { kcal: f[3], protein: f[4], carbs: f[5], fat: f[6] },
  servingG: f[7], servingLabel: lang === 'da' ? f[8] : f[9], packG: null, image: null, source: 'dk'
});
// "rugbrod", "rugbroed" and "rugbrød" all find rugbrød
const fold = x => normalize(x).replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/aa/g, 'a');
const INDEX = FOODS_DK.map(f => ({ f, da: fold(f[1]), en: fold(f[2]), words: `${f[1]} ${f[2]}`.toLowerCase().split(/[^a-zæøå0-9]+/).filter(Boolean).map(fold) }));

export const localFood = (id, lang = 'en') => { const f = FOODS_DK.find(x => x[0] === id); return f ? toProduct(f, lang) : null; };

// Best matches first: a name that starts with it, a word that starts with it, then anywhere.
export function searchLocal(query, lang = 'en', limit = 25) {
  const terms = String(query || '').toLowerCase().split(/\s+/).map(fold).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const it of INDEX) {
    let score = 0;
    for (const q of terms) {
      const own = lang === 'da' ? it.da : it.en, other = lang === 'da' ? it.en : it.da;
      const s = own.startsWith(q) ? 100 : other.startsWith(q) ? 90 : it.words.some(w => w.startsWith(q)) ? 70 : own.includes(q) || other.includes(q) ? 40 : 0;
      if (!s) { score = 0; break; }
      score += s;
    }
    if (score) out.push({ p: toProduct(it.f, lang), score: score - it.f[1].length * 0.1 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.p);
}

export const OFF_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const FIELDS = 'code,product_name,product_name_da,product_name_en,brands,nutriments,serving_quantity,serving_size,product_quantity,quantity,image_front_small_url';
// Products sold in Denmark matching the words (brands work too: "arla skyr", "lurpak").
export async function searchOnline(query, lang = 'en', { fetchFn = globalThis.fetch, signal, limit = 20 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const url = `${OFF_SEARCH}?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${limit}` +
    `&tagtype_0=countries&tag_contains_0=contains&tag_0=denmark&fields=${FIELDS}`;
  const res = await fetchFn(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error('search ' + res.status);
  const data = await res.json();
  return (data.products || []).map(p => fromOff(p, lang)).filter(p => p && p.name && (p.per100.kcal || p.per100.protein));
}
