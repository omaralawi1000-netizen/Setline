// Exercise lookup and search over the built-in catalog plus custom exercises. Pure.
import { EXERCISES } from '../data/exercises.js';

export const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'core', 'traps'];
export const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'ezbar', 'smith', 'trapbar'];

// Lowercase, fold Danish letters and accents, drop punctuation and spaces.
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function createCatalog(custom = []) {
  const all = [...EXERCISES, ...custom.map(c => ({ ...c, custom: true }))];
  const byId = new Map(all.map(e => [e.id, e]));
  const keys = all.map(e => ({
    e,
    terms: [...new Set([e.en, e.da, ...(e.aliases || [])].filter(Boolean).map(normalize))]
  }));

  const get = id => byId.get(id) || null;
  const name = (id, lang) => {
    const e = byId.get(id);
    if (!e) return id;
    return (lang === 'da' ? e.da : e.en) || e.en || e.da;
  };

  // Score one term against the query; higher is better, 0 = no match.
  function score(term, q) {
    if (term === q) return 100;
    if (term.startsWith(q)) return 80 - Math.min(20, term.length - q.length);
    const at = term.indexOf(q);
    if (at > 0) return 60 - Math.min(20, at);
    if (q.length >= 4) {
      const d = levenshtein(term.slice(0, q.length + 1), q);
      const d2 = levenshtein(term, q);
      const dist = Math.min(d, d2);
      if (dist <= Math.floor(q.length / 4)) return 40 - dist * 5;
    }
    return 0;
  }

  // Scored matches, best first: [{e, s}]. usage: {exerciseId: count} nudges frequent picks up.
  function rank(query, { usage = {}, lang = 'en', boost = null } = {}) {
    const q = normalize(query);
    if (!q) return [];
    const words = String(query).trim().split(/\s+/).map(normalize).filter(Boolean);
    const out = [];
    for (const { e, terms } of keys) {
      let s = 0;
      for (const t of terms) s = Math.max(s, score(t, q));
      // every word appears somewhere in the display names: "press bench" still finds Bench press
      if (!s && words.length > 1) {
        const hay = terms.join(' ');
        if (words.every(w => hay.includes(w))) s = 30;
      }
      if (s) out.push({ e, s: s + Math.min(10, (usage[e.id] || 0)) + (boost?.has(e.id) ? 8 : 0) });
    }
    out.sort((a, b) => b.s - a.s || name(a.e.id, lang).localeCompare(name(b.e.id, lang)));
    return out;
  }

  function search(query, { usage = {}, limit = 40, lang = 'en' } = {}) {
    if (!normalize(query)) {
      return [...all]
        .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || name(a.id, lang).localeCompare(name(b.id, lang)))
        .slice(0, limit);
    }
    return rank(query, { usage, lang }).slice(0, limit).map(o => o.e);
  }

  // Exact name match (any language or alias), for duplicate checks.
  function findExact(text) {
    const q = normalize(text);
    if (!q) return null;
    return keys.find(k => k.terms.includes(q))?.e || null;
  }

  return { all, get, name, search, rank, findExact };
}

// Build a custom exercise record from user input. Returns {ok, exercise?, error?}.
export function makeCustom({ name, muscle, equipment }, id = 'c-' + globalThis.crypto.randomUUID()) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 60) return { ok: false, error: 'name' };
  if (!MUSCLES.includes(muscle)) return { ok: false, error: 'muscle' };
  if (!EQUIPMENT.includes(equipment)) return { ok: false, error: 'equipment' };
  return { ok: true, exercise: { id, en: n, da: n, muscles: [muscle], equipment, aliases: [], createdAt: Date.now() } };
}
