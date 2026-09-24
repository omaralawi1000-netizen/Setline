// Body measurements (cm, one entry per date) and progress photo bookkeeping. Pure.

export const SITES = ['waist', 'chest', 'arm', 'thigh', 'hips', 'neck'];
export const CM = { min: 10, max: 250 };
export const POSES = ['front', 'side', 'back'];

export const validCm = v => Number.isFinite(v) && v >= CM.min && v <= CM.max;

// Merge one day's values; a site set to null is removed. Empty days disappear.
export function upsertMeasures(list, date, patch) {
  const cur = { ...(list.find(m => m.date === date) || {}), date };
  for (const [k, v] of Object.entries(patch)) {
    if (!SITES.includes(k)) continue;
    if (v == null) delete cur[k];
    else if (validCm(v)) cur[k] = Math.round(v * 10) / 10;
  }
  const rest = list.filter(m => m.date !== date);
  return (Object.keys(cur).length > 1 ? [...rest, cur] : rest).sort((a, b) => a.date.localeCompare(b.date));
}

// Latest value per site with the change since the first time it was measured.
export function measureSummary(list) {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  return SITES.map(site => {
    const pts = sorted.filter(m => m[site] != null).map(m => ({ date: m.date, v: m[site] }));
    if (!pts.length) return { site, latest: null };
    const first = pts[0], latest = pts[pts.length - 1];
    return { site, latest: latest.v, date: latest.date, change: pts.length > 1 ? Math.round((latest.v - first.v) * 10) / 10 : null, series: pts.map(p => ({ t: Date.parse(p.date), v: p.v })) };
  });
}

// Photos grouped by date, newest first: [{date, photos: [...]}]
export function photoDays(photos) {
  const by = new Map();
  for (const p of [...photos].sort((a, b) => b.t - a.t)) {
    if (!by.has(p.date)) by.set(p.date, []);
    by.get(p.date).push(p);
  }
  return [...by].map(([date, list]) => ({ date, photos: list.sort((a, b) => POSES.indexOf(a.pose) - POSES.indexOf(b.pose)) }));
}

// Default comparison: the first and the latest photo in the same pose (front preferred).
export function comparePair(photos) {
  for (const pose of POSES) {
    const list = photos.filter(p => p.pose === pose).sort((a, b) => a.t - b.t);
    if (list.length >= 2 && list[0].date !== list[list.length - 1].date) return [list[0], list[list.length - 1]];
  }
  const all = [...photos].sort((a, b) => a.t - b.t);
  return all.length >= 2 ? [all[0], all[all.length - 1]] : null;
}

const DAY = 86_400_000;

// This month side by side: your latest photo and the one closest to a month before it, same pose
// (front first). Needs three weeks or more between them. {before, after, days} | null
export function monthlyPair(photos) {
  let best = null;
  for (const pose of POSES) {
    const list = photos.filter(p => p.pose === pose).sort((a, b) => a.t - b.t);
    if (list.length < 2) continue;
    const after = list[list.length - 1];
    const earlier = list.filter(p => after.t - p.t >= 21 * DAY);
    if (!earlier.length) continue;
    const before = earlier.reduce((x, p) => (Math.abs(after.t - 30 * DAY - p.t) < Math.abs(after.t - 30 * DAY - x.t) ? p : x));
    const pair = { before, after, days: Math.round((after.t - before.t) / DAY) };
    if (!best || after.t > best.after.t + DAY) best = pair; // the most recent pose wins; ties keep front
  }
  return best;
}

// Weight and waist between two dates: the nearest entries on or before each (a few days' slack after).
export function changeBetween(bodyweight, measures, fromDate, toDate) {
  const near = (list, date, get) => {
    const pts = list.filter(x => get(x) != null).sort((a, b) => a.date.localeCompare(b.date));
    const on = pts.filter(x => x.date <= date).pop();
    const after = pts.find(x => x.date > date && Date.parse(x.date) - Date.parse(date) <= 4 * DAY);
    return on && Date.parse(date) - Date.parse(on.date) <= 10 * DAY ? get(on) : after ? get(after) : null;
  };
  const r1 = v => Math.round(v * 10) / 10;
  const kg = [near(bodyweight, fromDate, x => x.kg), near(bodyweight, toDate, x => x.kg)];
  const waist = [near(measures, fromDate, x => x.waist), near(measures, toDate, x => x.waist)];
  return {
    kg: kg[0] != null && kg[1] != null ? { from: kg[0], to: kg[1], change: r1(kg[1] - kg[0]) } : null,
    waist: waist[0] != null && waist[1] != null ? { from: waist[0], to: waist[1], change: r1(waist[1] - waist[0]) } : null
  };
}
