// Food: daily targets from the profile, day totals, meal slots, water and the week. Pure.
import { ageOf } from './profile.js';

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const GLASS_ML = 250;

// Where a meal logged at this time belongs.
export function slotAt(t = Date.now()) {
  const d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
  if (h >= 4.5 && h < 10.5) return 'breakfast';
  if (h >= 11 && h < 14.5) return 'lunch';
  if (h >= 17 && h < 21.5) return 'dinner';
  return 'snack';
}
export const slotOf = m => (SLOTS.includes(m?.slot) ? m.slot : slotAt(m?.t));

const round5 = v => Math.round(v / 5) * 5;

// Calories and macros for a day. Mifflin-St Jeor × activity from training days, then the goal:
// fat loss −20 %, muscle +10 %, strength +5 %. Protein per kg from settings, fat ≥ 0.8 g/kg and
// ≥ 25 % of energy, carbs take the rest. Missing profile bits fall back to typical values.
export function autoTargets({ profile = null, bodyweightKg = null, proteinPerKg = 1.8, now = Date.now() } = {}) {
  const kg = bodyweightKg || 80;
  const age = ageOf(profile, now) || 30;
  const cm = profile?.heightCm || 178;
  const female = profile?.sex === 'female';
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (female ? -161 : 5);
  const days = profile?.days ?? 3;
  const activity = Math.min(1.75, 1.3 + days * 0.055 + (profile?.cardio === 'lots' ? 0.08 : profile?.cardio === 'some' ? 0.04 : 0));
  const goal = { fatloss: 0.8, muscle: 1.1, strength: 1.05 }[profile?.goal] ?? 1;
  const kcal = Math.max(1200, round5(bmr * activity * goal / 5) * 5);
  const protein = round5(kg * proteinPerKg);
  const fat = round5(Math.max(kg * 0.8, (kcal * 0.25) / 9));
  const carbs = Math.max(0, round5((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, water: Math.round((kg * 35) / GLASS_ML) * GLASS_ML };
}

export const TARGET_LIMITS = { kcal: [1000, 6000], protein: [40, 400], carbs: [0, 900], fat: [20, 300], water: [1000, 6000] };
export function sanitizeTargets(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(TARGET_LIMITS)) if (Number.isFinite(t[k])) out[k] = Math.round(Math.min(hi, Math.max(lo, t[k])));
  return Object.keys(out).length ? out : null;
}
export const targetsFor = (auto, custom) => ({ ...auto, ...(custom || {}) });

// What was eaten on a day. Protein also counts the quick "+20 g" adds that aren't meals.
export function dayTotals(entry) {
  const meals = entry?.meals || [];
  const sum = k => meals.reduce((a, m) => a + (m[k] || 0), 0);
  const mealProtein = sum('protein');
  const protein = Math.max(entry?.protein || 0, mealProtein);
  return { kcal: Math.max(entry?.kcal || 0, sum('kcal')), protein, carbs: sum('carbs'), fat: sum('fat'), quickProtein: protein - mealProtein, water: entry?.water || 0, meals: meals.length };
}

// Meals grouped by slot, in time order.
export function bySlot(entry) {
  const out = Object.fromEntries(SLOTS.map(s => [s, []]));
  for (const m of [...(entry?.meals || [])].sort((a, b) => a.t - b.t)) out[slotOf(m)].push(m);
  return out;
}

// The last n days (oldest first) with totals, for the week chart.
export function weekOf(entries, today, n = 7) {
  const out = [];
  const [y, mo, d] = today.split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(y, mo - 1, d - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    out.push({ date: key, ...dayTotals(entries.find(e => e.date === key)) });
  }
  return out;
}

export function addWater(entries, date, ml) {
  const cur = entries.find(e => e.date === date);
  const water = Math.max(0, Math.min(8000, (cur?.water || 0) + Math.round(ml)));
  const next = { ...(cur || { protein: 0 }), date, water };
  return [...entries.filter(e => e.date !== date), next];
}

// Move a meal to another slot.
export function setSlot(entries, date, id, slot) {
  if (!SLOTS.includes(slot)) return entries;
  const cur = entries.find(e => e.date === date);
  if (!cur?.meals?.some(m => m.id === id)) return entries;
  return [...entries.filter(e => e.date !== date), { ...cur, meals: cur.meals.map(m => (m.id === id ? { ...m, slot } : m)) }];
}

// The share of energy from each macro (for the little split bar).
export function energySplit({ protein, carbs, fat }) {
  const p = protein * 4, c = carbs * 4, f = fat * 9, tot = p + c + f;
  return tot ? { protein: p / tot, carbs: c / tot, fat: f / tot } : { protein: 0, carbs: 0, fat: 0 };
}
