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
  return scoredLocal(query, lang, limit).map(x => x.p);
}
function scoredLocal(query, lang = 'en', limit = 25) {
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
    if (score) out.push({ p: toProduct(it.f, lang), raw: score, score: score - it.f[1].length * 0.1 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(x => ({ ...x, per: x.raw / terms.length }));
}

// ---------- "2 eggs and 200 g skyr" → a meal from the list above, no AI needed ----------

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, couple: 2,
  en: 1, et: 1, én: 1, ét: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10, halv: 0.5, halvt: 0.5, par: 2 };
const UNIT = { g: 1, gr: 1, gram: 1, grams: 1, kg: 1000, ml: 1, l: 1000, dl: 100, cl: 10, liter: 1000 };
const COUNT = /^(stk|pcs|pieces?|slices?|skiver?|skive|glass(?:es)?|glas|cups?|kop|kopper|scoops?|portions?|servings?|bowls?|skåle?|skål|handful|håndfuld|stykker?)$/;
// everyday words that mean one thing in particular
const ALIAS = { egg: 'aeg', æg: 'aeg', aeg: 'aeg', milk: 'letmaelk', mælk: 'letmaelk', oatmeal: 'havregrod-maelk', porridge: 'havregrod-maelk', havregrød: 'havregrod-maelk',
  oats: 'havregryn', rice: 'ris-kogt', ris: 'ris-kogt', pasta: 'pasta-kogt', chicken: 'kyllingebryst', kylling: 'kyllingebryst', 'chicken breast': 'kyllingebryst',
  banana: 'banan', banan: 'banan', apple: 'aeble', æble: 'aeble', toast: 'toast', 'rye bread': 'rugbrod', rugbrød: 'rugbrod' };
const FILL = new Set(['of', 'af', 'some', 'lidt', 'my', 'min', 'mit', 'the', 'with', 'large', 'small', 'big', 'stor', 'lille', 'stort', 'plain']);

export function parseMealLocal(text, lang = 'en') {
  const raw = String(text || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2').replace(/[.!?]+$/, '').trim();
  if (!raw) return null;
  const parts = raw.split(/\s*(?:,|&|\+|\band\b|\bog\b|\bwith\b|\bmed\b|\bplus\b)\s*/).map(x => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const items = [];
  for (const part of parts) {
    let words = part.split(/\s+/), qty = null, unit = null;
    const first = words[0];
    const m = /^(\d+(?:\.\d+)?)(g|gr|kg|ml|l|dl|cl)?$/.exec(first);
    if (m) { qty = Number(m[1]); unit = m[2] || null; words = words.slice(1); }
    else if (WORD_NUM[first] != null) { qty = WORD_NUM[first]; words = words.slice(1); }
    if (words[0] && UNIT[words[0]] && !unit) { unit = words[0]; words = words.slice(1); }
    else if (words[0] && COUNT.test(words[0])) words = words.slice(1);
    words = words.filter(w => !FILL.has(w));
    const name = words.join(' ');
    if (name.length < 2) return null;
    const alias = ALIAS[name] || ALIAS[name.replace(/s$/, '')];
    const hit = alias ? { p: localFood(alias, lang), per: 100 }
      : [scoredLocal(name, lang, 1)[0], scoredLocal(name.replace(/s\b/g, ''), lang, 1)[0]].filter(Boolean).sort((a, b) => b.per - a.per || a.p.name.length - b.p.name.length)[0];
    if (!hit?.p || hit.per < 70) return null; // not sure what this is: let the AI estimate it
    const p = hit.p;
    const grams = unit ? (qty ?? 1) * UNIT[unit] : (qty ?? 1) * (p.servingG || 100);
    if (!(grams > 0 && grams <= 3000)) return null;
    items.push({ product: p, grams: Math.round(grams) });
  }
  const sum = k => Math.round(items.reduce((a, i) => a + i.product.per100[k] * i.grams / 100, 0));
  const label = items.map(i => i.product.name.split(',')[0]).join(', ');
  return { name: label.charAt(0).toUpperCase() + label.slice(1), kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), items };
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
