// Bodyweight and a daily protein target. Pure.
export const BW_LIMITS = { min: 20, max: 400 };
export const PROTEIN_PER_KG = { min: 1.2, max: 2.6 };

export const dateKey = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function validBodyweight(kg) {
  return Number.isFinite(kg) && kg >= BW_LIMITS.min && kg <= BW_LIMITS.max;
}

// One entry per date: a new value for a date replaces the old one.
export function upsertBodyweight(list, date, kg) {
  const rest = list.filter(e => e.date !== date);
  return [...rest, { date, kg: Math.round(kg * 100) / 100 }].sort((a, b) => a.date.localeCompare(b.date));
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Latest weight, 7-entry average, and change over ~30 days.
export function bodyTrend(list, today = dateKey()) {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const latest = sorted[sorted.length - 1];
  const recent = sorted.slice(-7);
  const avg = recent.reduce((a, e) => a + e.kg, 0) / recent.length;
  const old = [...sorted].reverse().find(e => daysBetween(e.date, latest.date) >= 21);
  return {
    latest, avg: Math.round(avg * 10) / 10,
    change30: old ? Math.round((latest.kg - old.kg) * 10) / 10 : null,
    loggedToday: latest.date === today,
    series: sorted.slice(-14).map(e => ({ t: Date.parse(e.date), v: e.kg }))
  };
}

// Daily protein target in grams from bodyweight.
export function proteinTarget(bodyweightKg, perKg = 1.8) {
  if (!validBodyweight(bodyweightKg)) return null;
  return Math.round((bodyweightKg * perKg) / 5) * 5;
}

export function addProtein(entries, date, grams) {
  const g = Math.round(grams);
  if (!Number.isFinite(g) || g <= 0 || g > 300) return entries;
  const cur = entries.find(e => e.date === date);
  const next = { ...(cur || {}), date, protein: Math.min(600, (cur?.protein || 0) + g) }; // meals and kcal stay
  return [...entries.filter(e => e.date !== date), next];
}
