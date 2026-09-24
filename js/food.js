// Packaged food: barcodes, Open Food Facts products, nutrition for an amount. Pure (plus one fetch).

export const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'code,product_name,product_name_da,product_name_en,generic_name,brands,nutriments,serving_quantity,serving_size,product_quantity,quantity,image_front_small_url';

// EAN-13, EAN-8, UPC-A (12) and UPC-E (8) with a valid check digit.
export function validBarcode(code) {
  const s = String(code || '').replace(/\s/g, '');
  if (!/^\d{8}$|^\d{12,14}$/.test(s)) return false;
  const d = [...s].map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const num = v => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v; return Number.isFinite(n) && n >= 0 ? n : null; };
const grams = v => { const n = num(v); return n && n > 0 && n <= 5000 ? Math.round(n) : null; };
const packGrams = q => { const m = /([\d.,]+)\s*(kg|g|ml|l|cl)\b/i.exec(String(q || '')); if (!m) return null; const v = num(m[1]); const f = { kg: 1000, g: 1, ml: 1, l: 1000, cl: 10 }[m[2].toLowerCase()]; return v ? grams(v * f) : null; };

// Open Food Facts product → ours. Null when it has no usable nutrition.
export function fromOff(p, lang = 'en') {
  if (!p || typeof p !== 'object') return null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && num(n.energy_100g) != null) kcal = num(n.energy_100g) / 4.184; // kJ
  const protein = num(n.proteins_100g);
  if (kcal == null && protein == null) return null;
  const name = String((lang === 'da' ? p.product_name_da : p.product_name_en) || p.product_name || p.generic_name || '').trim();
  return {
    code: String(p.code || ''),
    name: name.slice(0, 60) || null,
    brand: String(p.brands || '').split(',')[0].trim().slice(0, 40),
    image: typeof p.image_front_small_url === 'string' && /^https:\/\/images\.openfoodfacts\.org\//.test(p.image_front_small_url) ? p.image_front_small_url : null,
    per100: { protein: r1(protein ?? 0), kcal: Math.round(kcal ?? 0), carbs: r1(num(n.carbohydrates_100g) ?? 0), fat: r1(num(n.fat_100g) ?? 0) },
    servingG: grams(p.serving_quantity) || packGrams(p.serving_size),
    packG: grams(p.product_quantity) || packGrams(p.quantity),
    source: 'off'
  };
}
const r1 = v => Math.round(v * 10) / 10;

// Nutrition for an amount in grams.
export function forAmount(product, g) {
  const k = Math.max(0, g) / 100, p = product.per100;
  return { protein: Math.round(p.protein * k), kcal: Math.round(p.kcal * k), carbs: Math.round(p.carbs * k), fat: Math.round(p.fat * k) };
}

// Amounts to offer: a serving, 100 g, the whole pack, in that order, without duplicates.
export function amountChoices(product) {
  const out = [];
  const add = (g, kind) => { if (g && !out.some(x => x.g === g)) out.push({ g, kind }); };
  add(product.servingG, 'serving');
  add(100, '100');
  if (product.packG && product.packG <= 2000) add(product.packG, 'pack');
  return out;
}

// Label read by the model → a product (per 100 g).
export const LABEL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label: { type: 'BOOLEAN', description: 'false if no nutrition label is readable' },
    name: { type: 'STRING', description: 'product name, if visible' },
    protein100: { type: 'NUMBER' }, kcal100: { type: 'NUMBER' }, carbs100: { type: 'NUMBER' }, fat100: { type: 'NUMBER' },
    servingG: { type: 'NUMBER', description: 'serving size in grams, if printed' },
    packG: { type: 'NUMBER', description: 'pack weight in grams, if printed' }
  },
  required: ['label', 'protein100', 'kcal100']
};
export const labelPrompt = lang => `Read the nutrition label in this photo. Give values per 100 g (or 100 ml); if only per serving is printed, convert using the serving size. kcal, not kJ. Product name in ${lang === 'da' ? 'Danish' : 'English'} if visible. If there is no readable nutrition label, set label=false.`;

export function fromLabel(raw, code = '') {
  if (!raw || raw.label === false) return null;
  const protein = num(raw.protein100), kcal = num(raw.kcal100);
  if (protein == null || kcal == null || protein > 100 || kcal > 950) return null;
  return {
    code: String(code || ''), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : null, brand: '', image: null,
    per100: { protein: r1(protein), kcal: Math.round(kcal), carbs: r1(Math.min(100, num(raw.carbs100) ?? 0)), fat: r1(Math.min(100, num(raw.fat100) ?? 0)) },
    servingG: grams(raw.servingG), packG: grams(raw.packG), source: 'label'
  };
}

// Look a barcode up. {status: 'ok', product} | {status: 'missing'} | {status: 'offline'|'failed'}
export async function lookup(code, lang = 'en', fetchFn = globalThis.fetch) {
  let res;
  try { res = await fetchFn(`${OFF_URL}${encodeURIComponent(code)}.json?fields=${FIELDS}`); }
  catch { return { status: navigator?.onLine === false ? 'offline' : 'failed' }; }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'failed' };
  const data = await res.json().catch(() => null);
  if (!data || data.status === 0 || !data.product) return { status: 'missing' };
  const product = fromOff({ code, ...data.product }, lang);
  return product ? { status: 'ok', product } : { status: 'missing' };
}

// Remembered products: newest first, at most 200, so a second scan is instant (and works offline).
export function remember(list, product, now = Date.now()) {
  const rest = (list || []).filter(p => !(product.code && p.code === product.code));
  return [{ ...product, seen: now }, ...rest].slice(0, 200);
}
