// Cardio: types, live sessions (with pause), pace/speed, zones, records, weekly minutes. Pure.

// metric: how speed is shown. pace = min/km, pace100 = min/100 m, split = min/500 m, speed = km/h, null = time only.
export const CARDIO_TYPES = [
  { id: 'run', en: 'Run', da: 'Løb', metric: 'pace', aliases: ['running', 'jog', 'jogging', 'jogged', 'løbe', 'løbetur', 'løbede', 'ran', 'løbet'] },
  { id: 'walk', en: 'Walk', da: 'Gåtur', metric: 'pace', aliases: ['walking', 'gå', 'gik', 'walked'] },
  { id: 'hike', en: 'Hike', da: 'Vandretur', metric: 'pace', aliases: ['hiking', 'hiked', 'vandring', 'vandre'] },
  { id: 'bike', en: 'Bike', da: 'Cykel', metric: 'speed', aliases: ['cycling', 'cycle', 'cycled', 'biking', 'biked', 'ride', 'rode', 'cykling', 'cykle', 'cyklede', 'cykeltur'] },
  { id: 'spin', en: 'Indoor bike', da: 'Motionscykel', metric: 'speed', aliases: ['spinning', 'spin bike', 'exercise bike', 'stationary bike', 'kondicykel', 'spinningcykel', 'watt bike'] },
  { id: 'row', en: 'Rower', da: 'Romaskine', metric: 'split', aliases: ['rowing', 'rowed', 'row', 'rowing machine', 'erg', 'concept2', 'roede'] },
  { id: 'swim', en: 'Swim', da: 'Svømning', metric: 'pace100', aliases: ['swimming', 'swam', 'svømme', 'svømmede'] },
  { id: 'elliptical', en: 'Elliptical', da: 'Crosstrainer', metric: null, aliases: ['cross trainer', 'crosstrainer', 'elliptisk'] },
  { id: 'stairs', en: 'Stair climber', da: 'Trappemaskine', metric: null, aliases: ['stairs', 'stairmaster', 'stair master', 'trapper', 'trappe'] },
  { id: 'hiit', en: 'Intervals', da: 'Intervaller', metric: null, aliases: ['hiit', 'interval', 'intervals', 'intervaltræning', 'circuit'] },
  { id: 'other', en: 'Other cardio', da: 'Anden kondition', metric: null, aliases: ['cardio', 'kondition', 'konditionstræning'] }
];
export const cardioType = id => CARDIO_TYPES.find(c => c.id === id) || CARDIO_TYPES[CARDIO_TYPES.length - 1];
export const cardioName = (id, lang) => { const c = cardioType(id); return lang === 'da' ? c.da : c.en; };

// Heart-rate style zones by feel. Zone 2 is "can still hold a conversation".
export const ZONES = [1, 2, 3, 4, 5];

export const CARDIO_LIMITS = { minSec: 60, maxSec: 12 * 3600, maxKm: 400 };

const uid = () => globalThis.crypto.randomUUID();

// ---------- live session: timestamps only, elapsed is derived ----------

export function startCardio(type, now = Date.now(), id = uid()) {
  return { id, type, startedAt: now, pausedAt: null, pausedMs: 0 };
}
export const cardioElapsed = (a, now = Date.now()) =>
  Math.max(0, Math.floor(((a.pausedAt ?? now) - a.startedAt - a.pausedMs) / 1000));
export const pauseCardio = (a, now = Date.now()) => (a.pausedAt ? a : { ...a, pausedAt: now });
export const resumeCardio = (a, now = Date.now()) => (a.pausedAt ? { ...a, pausedAt: null, pausedMs: a.pausedMs + (now - a.pausedAt) } : a);

// ---------- sessions ----------

export function validateCardio({ type, durationSec, distanceKm = null, zone = null }) {
  if (!CARDIO_TYPES.some(c => c.id === type)) return { ok: false, error: 'type' };
  if (!Number.isFinite(durationSec) || durationSec < CARDIO_LIMITS.minSec || durationSec > CARDIO_LIMITS.maxSec) return { ok: false, error: 'duration' };
  if (distanceKm != null && (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > CARDIO_LIMITS.maxKm)) return { ok: false, error: 'distance' };
  if (zone != null && !ZONES.includes(zone)) return { ok: false, error: 'zone' };
  // a sanity check on speed: nobody runs a 1 minute km for an hour
  if (distanceKm != null) {
    const kmh = distanceKm / (durationSec / 3600);
    const max = { run: 25, walk: 10, hike: 10, swim: 8, row: 25, bike: 70, spin: 70 }[type] ?? 60;
    if (kmh > max) return { ok: false, error: 'speed' };
  }
  return { ok: true };
}

export function makeCardioSession({ type, startedAt, durationSec, distanceKm = null, zone = null, note = '', source = 'manual' }, id = uid()) {
  return {
    id, type, startedAt, endedAt: startedAt + durationSec * 1000, durationSec: Math.round(durationSec),
    distanceKm: distanceKm == null ? null : Math.round(distanceKm * 1000) / 1000, zone, note, source
  };
}

export function finishCardio(a, { distanceKm = null, zone = null } = {}, now = Date.now()) {
  const durationSec = cardioElapsed(a, now);
  return makeCardioSession({ type: a.type, startedAt: a.startedAt, durationSec, distanceKm, zone, source: 'live' }, a.id);
}

// ---------- pace and speed ----------

// seconds per km (or per 100 m / 500 m), km/h
export function paceOf(s) {
  if (!s.distanceKm) return null;
  const m = cardioType(s.type).metric;
  if (m === 'pace') return s.durationSec / s.distanceKm;
  if (m === 'pace100') return s.durationSec / (s.distanceKm * 10);
  if (m === 'split') return s.durationSec / (s.distanceKm * 2);
  if (m === 'speed') return s.distanceKm / (s.durationSec / 3600);
  return null;
}

const mmss = sec => { sec = Math.round(sec); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

// "5:12 /km", "28.4 km/h", "1:58 /500 m", "2:05 /100 m"
export function paceText(s, lang = 'en') {
  const p = paceOf(s);
  if (p == null) return '';
  const m = cardioType(s.type).metric;
  if (m === 'speed') return `${new Intl.NumberFormat(lang === 'da' ? 'da-DK' : 'en-GB', { maximumFractionDigits: 1 }).format(p)} ${lang === 'da' ? 'km/t' : 'km/h'}`;
  return `${mmss(p)} ${m === 'pace' ? '/km' : m === 'pace100' ? '/100 m' : '/500 m'}`;
}

// ---------- records ----------

const faster = (type, a, b) => (cardioType(type).metric === 'speed' ? a > b : a < b);

// Records a finished session sets against earlier ones of the same type: ['distance', 'duration', 'pace']
export function cardioRecords(session, earlier) {
  const same = earlier.filter(e => e.type === session.type && e.id !== session.id && e.startedAt < session.startedAt);
  if (!same.length) return [];
  const out = [];
  const maxDist = Math.max(0, ...same.map(e => e.distanceKm || 0));
  if (session.distanceKm && maxDist && session.distanceKm > maxDist) out.push('distance');
  if (session.durationSec > Math.max(...same.map(e => e.durationSec))) out.push('duration');
  const minKm = cardioType(session.type).metric === 'speed' ? 5 : 1;
  const p = session.distanceKm >= minKm ? paceOf(session) : null;
  const paces = same.filter(e => (e.distanceKm || 0) >= minKm).map(paceOf).filter(v => v != null);
  if (p != null && paces.length && paces.every(q => faster(session.type, p, q))) out.push('pace');
  return out;
}

// ---------- weekly ----------

export function cardioMinutes(sessions, from, to) {
  let min = 0, z2 = 0, km = 0, n = 0;
  for (const s of sessions) {
    if (s.startedAt < from || s.startedAt >= to) continue;
    n++;
    min += s.durationSec / 60;
    if (s.zone != null && s.zone <= 2) z2 += s.durationSec / 60;
    km += s.distanceKm || 0;
  }
  return { minutes: Math.round(min), zone2: Math.round(z2), km: Math.round(km * 10) / 10, sessions: n };
}
