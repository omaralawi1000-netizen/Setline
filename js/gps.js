// GPS distance for outdoor cardio: a filtered haversine sum. Pure; the watcher lives in the UI.
//
// Phone fixes wander a few metres even standing still, so a fix only counts when it is
// accurate enough, has moved further than its own uncertainty, and implies a believable speed.

const R = 6371008.8; // mean Earth radius, m
const rad = d => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// top speeds in m/s a fix may imply before it's treated as a jump
const MAX_SPEED = { run: 9, walk: 3.5, hike: 3.5, bike: 22 };
export const GPS_TYPES = Object.keys(MAX_SPEED);
export const MAX_ACCURACY = 30; // m

// track: {m, last: {lat, lon, t, acc} | null, fixes}
export const newTrack = () => ({ m: 0, last: null, fixes: 0 });

// Add a fix {lat, lon, acc, t}. Returns a new track (or the same one when the fix is dropped).
export function addFix(track, fix, type = 'run') {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t)) return track;
  if (!(fix.acc <= MAX_ACCURACY)) return track;
  const p = { lat: fix.lat, lon: fix.lon, t: fix.t, acc: fix.acc };
  if (!track.last) return { ...track, last: p, fixes: track.fixes + 1 };
  const d = haversine(track.last, p);
  const dt = (p.t - track.last.t) / 1000;
  if (dt <= 0) return track;
  // inside the noise: keep the anchor, but take a sharper fix of the same spot
  if (d < Math.max(4, (track.last.acc + p.acc) / 2)) return p.acc < track.last.acc ? { ...track, last: { ...p, t: track.last.t } } : track;
  if (d / dt > (MAX_SPEED[type] ?? 9)) return track;
  return { m: track.m + d, last: p, fixes: track.fixes + 1 };
}

// After a pause the next fix starts a new segment, so the paused stretch isn't counted.
export const breakTrack = track => ({ ...track, last: null });

export const trackKm = track => Math.round(track.m) / 1000;
