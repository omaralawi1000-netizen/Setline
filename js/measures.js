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
