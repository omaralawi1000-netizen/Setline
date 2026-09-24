// Meals: estimates from a photo or a description, kept per day with protein and calorie totals. Pure.

export const MEAL_LIMITS = { protein: 300, kcal: 5000, carbs: 800, fat: 400, items: 12, name: 60 };

const uid = () => 'm-' + globalThis.crypto.randomUUID();
const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, hi) => (Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);

// JSON schema for the model's answer.
export const MEAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    food: { type: 'BOOLEAN', description: 'false if the photo/text is not food' },
    name: { type: 'STRING', description: 'short name of the meal, in the user language' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, grams: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, kcal: { type: 'NUMBER' } },
        required: ['name', 'grams', 'protein', 'kcal']
      }
    },
    protein: { type: 'NUMBER', description: 'total protein, grams' },
    kcal: { type: 'NUMBER', description: 'total energy, kcal' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] }
  },
  required: ['food', 'name', 'items', 'protein', 'kcal', 'confidence']
};

export function mealPrompt(text, lang) {
  const l = lang === 'da' ? 'Danish' : 'English';
  return [
    'Estimate the nutrition of this meal for a strength athlete tracking protein.',
    'Identify each food, estimate its portion in grams from visual cues (plate ~26 cm, fork, hand), then protein and kcal from typical values.',
    'Be realistic, not optimistic: sauces and oil add calories; cooked weights, not raw.',
    text ? `The user says: "${String(text).slice(0, 300)}". Trust their description over the photo where they disagree.` : '',
    `Write names in ${l}. If it is not food, set food=false and zeros.`
  ].filter(Boolean).join('\n');
}

// Check and tidy the model's answer. Returns a meal draft or null.
export function validateMeal(raw) {
  if (!raw || typeof raw !== 'object' || raw.food === false) return null;
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, MEAL_LIMITS.items)
    .filter(i => i && typeof i.name === 'string' && i.name.trim())
    .map(i => ({ name: i.name.trim().slice(0, MEAL_LIMITS.name), grams: Math.round(clamp(i.grams, 3000)), protein: r1(clamp(i.protein, MEAL_LIMITS.protein)), kcal: Math.round(clamp(i.kcal, MEAL_LIMITS.kcal)) }));
  const sum = k => items.reduce((a, i) => a + i[k], 0);
  // totals from the items when the model's own totals disagree badly
  let protein = clamp(raw.protein, MEAL_LIMITS.protein), kcal = clamp(raw.kcal, MEAL_LIMITS.kcal);
  if (items.length && Math.abs(sum('protein') - protein) > Math.max(8, protein * 0.25)) protein = sum('protein');
  if (items.length && Math.abs(sum('kcal') - kcal) > Math.max(80, kcal * 0.25)) kcal = sum('kcal');
  if (!protein && !kcal) return null;
  const name = (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : items.map(i => i.name).join(', ')).slice(0, MEAL_LIMITS.name);
  return {
    name, items,
    protein: Math.round(clamp(protein, MEAL_LIMITS.protein)), kcal: Math.round(clamp(kcal, MEAL_LIMITS.kcal)),
    carbs: Math.round(clamp(raw.carbs, MEAL_LIMITS.carbs)), fat: Math.round(clamp(raw.fat, MEAL_LIMITS.fat)),
    confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'medium'
  };
}

// Scale a draft to a portion (0.5×, 1.5×…), from the original estimate.
export function scaleMeal(draft, factor) {
  const f = Math.max(0.25, Math.min(4, factor));
  return {
    ...draft, portion: f,
    protein: Math.round(draft.protein * f), kcal: Math.round(draft.kcal * f), carbs: Math.round(draft.carbs * f), fat: Math.round(draft.fat * f),
    items: draft.items.map(i => ({ ...i, grams: Math.round(i.grams * f), protein: r1(i.protein * f), kcal: Math.round(i.kcal * f) }))
  };
}

// Add a meal to a day: the meal is kept, and the day's protein and kcal go up.
export function addMeal(entries, date, meal, now = Date.now(), id = uid()) {
  const m = {
    id, t: now, name: String(meal.name || '').slice(0, MEAL_LIMITS.name),
    protein: Math.round(clamp(meal.protein, MEAL_LIMITS.protein)), kcal: Math.round(clamp(meal.kcal, MEAL_LIMITS.kcal)),
    carbs: Math.round(clamp(meal.carbs, MEAL_LIMITS.carbs)), fat: Math.round(clamp(meal.fat, MEAL_LIMITS.fat)),
    source: ['photo', 'barcode'].includes(meal.source) ? meal.source : 'text', ...(validThumb(meal.thumb) ? { thumb: meal.thumb } : {}),
    ...(['breakfast', 'lunch', 'dinner', 'snack'].includes(meal.slot) ? { slot: meal.slot } : {})
  };
  const cur = entries.find(e => e.date === date) || { date, protein: 0 };
  const next = { ...cur, protein: Math.min(1000, (cur.protein || 0) + m.protein), kcal: Math.min(20000, (cur.kcal || 0) + m.kcal), meals: [...(cur.meals || []), m] };
  return { entries: [...entries.filter(e => e.date !== date), next], meal: m };
}

// Change a logged meal (the estimate was off); the day's totals move by the difference.
export function editMeal(entries, date, id, patch) {
  const cur = entries.find(e => e.date === date);
  const m = cur?.meals?.find(x => x.id === id);
  if (!m) return entries;
  const next = {
    ...m,
    ...(typeof patch.name === 'string' && patch.name.trim() ? { name: patch.name.trim().slice(0, MEAL_LIMITS.name) } : {}),
    protein: Math.round(clamp(patch.protein ?? m.protein, MEAL_LIMITS.protein)), kcal: Math.round(clamp(patch.kcal ?? m.kcal, MEAL_LIMITS.kcal)),
    carbs: Math.round(clamp(patch.carbs ?? m.carbs, MEAL_LIMITS.carbs)), fat: Math.round(clamp(patch.fat ?? m.fat, MEAL_LIMITS.fat))
  };
  const day = {
    ...cur, protein: Math.max(0, Math.min(1000, (cur.protein || 0) - m.protein + next.protein)),
    kcal: Math.max(0, Math.min(20000, (cur.kcal || 0) - m.kcal + next.kcal)), meals: cur.meals.map(x => (x.id === id ? next : x))
  };
  return [...entries.filter(e => e.date !== date), day];
}

export function removeMeal(entries, date, id) {
  const cur = entries.find(e => e.date === date);
  const m = cur?.meals?.find(x => x.id === id);
  if (!m) return entries;
  const next = { ...cur, protein: Math.max(0, (cur.protein || 0) - m.protein), kcal: Math.max(0, (cur.kcal || 0) - m.kcal), meals: cur.meals.filter(x => x.id !== id) };
  return [...entries.filter(e => e.date !== date), next];
}

// a small JPEG data URL and nothing else
export const validThumb = v => typeof v === 'string' && v.length < 40000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v);

export const dayOf = (entries, date) => entries.find(e => e.date === date) || { date, protein: 0, kcal: 0, meals: [] };

// Favourites: starred meals first, then what you log again and again (twice or more in 60 days).
export const mealKey = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
export function favouriteMeals(entries, starred = [], now = Date.now(), n = 6) {
  const since = now - 60 * 86_400_000;
  const by = new Map();
  for (const day of entries) for (const m of day.meals || []) {
    const k = mealKey(m.name);
    if (!k) continue;
    const cur = by.get(k) || { key: k, count: 0, last: null };
    if (m.t >= since) cur.count++;
    if (!cur.last || m.t > cur.last.t) cur.last = m;
    by.set(k, cur);
  }
  const star = new Set(starred.map(mealKey));
  return [...by.values()]
    .filter(f => star.has(f.key) || f.count >= 2)
    .sort((a, b) => (star.has(b.key) - star.has(a.key)) || b.count - a.count || b.last.t - a.last.t)
    .slice(0, n)
    .map(f => ({ key: f.key, starred: star.has(f.key), count: f.count, meal: f.last }));
}
