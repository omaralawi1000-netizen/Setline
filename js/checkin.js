// Morning check-in: sleep, energy, soreness → a readiness score for the day. Pure.
import { GROUPS } from './insights.js';

export const SORE_GROUPS = Object.keys(GROUPS); // chest, back, shoulders, arms, legs, core
export const SLEEP = { min: 0, max: 14 };

const clampSleep = h => Math.max(SLEEP.min, Math.min(SLEEP.max, Math.round(h * 2) / 2));

// Tidy a check-in (partial input merges into what's there for the day).
export function mergeCheckin(prev, patch, date, now = Date.now()) {
  const next = { date, t: now, sleepH: prev?.sleepH ?? null, energy: prev?.energy ?? null, sore: prev?.sore ?? [] };
  if (Number.isFinite(patch.sleepH)) next.sleepH = clampSleep(patch.sleepH);
  if (Number.isInteger(patch.energy) && patch.energy >= 1 && patch.energy <= 5) next.energy = patch.energy;
  if (Array.isArray(patch.sore)) next.sore = [...new Set(patch.sore.filter(g => SORE_GROUPS.includes(g)))];
  if (patch.addSore) next.sore = [...new Set([...next.sore, ...patch.addSore.filter(g => SORE_GROUPS.includes(g))])];
  return next;
}

const sleepScore = h => (h == null ? null : h >= 8 ? 5 : h >= 7 ? 4 : h >= 6 ? 3 : h >= 5 ? 2 : 1);

// Muscle groups a routine works (primary muscles only).
export function routineGroups(routine, catalog) {
  const out = new Set();
  for (const e of routine?.exercises || []) {
    const m = catalog.get(e.exerciseId)?.muscles?.[0];
    const g = SORE_GROUPS.find(k => GROUPS[k].includes(m));
    if (g) out.add(g);
  }
  return [...out];
}

// 1–5 from whatever was answered, and which of today's groups are sore.
// {score, sleep, energy, soreHit: [groups], advice: 'push'|'normal'|'easy'} or null with nothing answered.
export function readiness(c, groupsToday = []) {
  if (!c) return null;
  const parts = [];
  const s = sleepScore(c.sleepH);
  if (s != null) parts.push([s, 0.35]);
  if (c.energy != null) parts.push([c.energy, 0.4]);
  const soreHit = (c.sore || []).filter(g => groupsToday.includes(g));
  if (c.sore?.length) parts.push([Math.max(1, 4 - soreHit.length * 1.5), 0.25]); // only soreness you mention counts
  if (!parts.length) return null;
  const w = parts.reduce((a, [, k]) => a + k, 0);
  const score = Math.max(1, Math.min(5, Math.round(parts.reduce((a, [v, k]) => a + v * k, 0) / w)));
  return { score, soreHit, advice: score >= 4 ? 'push' : score <= 2 ? 'easy' : 'normal' };
}

// Average sleep over the last n check-ins with sleep, and a series for a small chart.
export function sleepTrend(list, n = 14) {
  const withSleep = [...list].filter(c => c.sleepH != null).sort((a, b) => a.date.localeCompare(b.date)).slice(-n);
  if (!withSleep.length) return null;
  return { avg: Math.round((withSleep.reduce((a, c) => a + c.sleepH, 0) / withSleep.length) * 10) / 10, series: withSleep.map(c => ({ date: c.date, v: c.sleepH })) };
}

// Speech is matched after æ/ø/å → ae/oe/aa, so word boundaries work for Danish too.
const ascii = s => String(s || '').toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa');

// Words for sore spots in speech (EN/DA) → groups.
const SORE_WORDS = [
  ['legs', /\b(legs?|quads?|hamstrings?|glutes?|calves|calf|thighs?|ben(ene)?|laar(ene)?|baller|laeg(gene)?)\b/],
  ['back', /\b(back|lats?|lower back|ryg(gen)?|laend(en)?)\b/],
  ['chest', /\b(chest|pecs?|bryst(et)?)\b/],
  ['shoulders', /\b(shoulders?|delts?|skuldre(ne)?|skulder(en)?)\b/],
  ['arms', /\b(arms?|biceps|triceps|forearms?|arme(ne)?|underarme)\b/],
  ['core', /\b(abs|core|stomach|mave(n)?|mavemuskler)\b/]
];
export const soreFromText = s => { const a = ascii(s); return SORE_WORDS.filter(([, re]) => re.test(a)).map(([g]) => g); };

const ENERGY_WORDS = [[5, /\b(great|amazing|fantastic|super|fresh|frisk|fantastisk)\b/], [4, /\b(good|fine|godt|fin)\b/], [3, /\b(ok|okay|alright|so so|middel|nogenlunde)\b/], [2, /\b(tired|low|flat|traet|sloej)\b/], [1, /\b(wrecked|exhausted|dead|destroyed|smadret|udmattet|faerdig)\b/]];
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, en: 1, et: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10 };

// "slept 6 hours, legs sore", "sov 7 timer og er øm i benene", "energy 3". Null if it isn't a check-in.
export function parseCheckin(s) {
  const text = ascii(s).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|tre|fire|fem|seks|syv|otte|ni|ti)\b(?= ?(?:and a half |og en halv |½ ?)?(?:hours?|hrs?|timer))/g, w => NUM[w]);
  const out = {};
  const sleep = /\b(?:i )?(?:slept|sleep|got|sov|fik)(?: only| just| about| around| kun| cirka| omkring| ca\.?)? (\d+(?:[.,]\d+)?)(?: and a half| og en halv|½)? ?(?:hours?|hrs?|h|timer|t)\b(?: of sleep| soevn)?/.exec(text) ||
    /\b(\d+(?:[.,]\d+)?)(?: and a half| og en halv|½)? ?(?:hours?|timer) (?:of )?(?:sleep|soevn)\b/.exec(text);
  if (sleep) {
    let h = Number(String(sleep[1]).replace(',', '.'));
    if (/and a half|og en halv|½/.test(sleep[0])) h += 0.5;
    if (Number.isFinite(h) && h >= 0 && h <= 14) out.sleepH = h;
  }
  const en = /\b(?:energy|energi)(?: is| er| level| niveau)? (\d)\b/.exec(text);
  if (en && +en[1] >= 1 && +en[1] <= 5) out.energy = +en[1];
  else if (/\b(feel|feeling|foeler|har det)\b/.test(text)) { const e = ENERGY_WORDS.find(([, re]) => re.test(text)); if (e) out.energy = e[0]; }
  if (/\b(sore|aching|stiff|oem|oemme|stiv|stive|ondt)\b/.test(text)) {
    const g = soreFromText(text);
    if (g.length) out.addSore = g;
  }
  if (/\b(not sore|no soreness|nothing sore|ikke oem|ingen oemhed)\b/.test(text)) { out.sore = []; delete out.addSore; }
  return Object.keys(out).length ? out : null;
}
