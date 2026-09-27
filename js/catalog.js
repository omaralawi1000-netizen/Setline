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

// ---------- word by word ----------
// Speech-to-text gets gym words wrong in the same ways ("preacher kill", "lateral rays", "cable
// flies"): folded to one form before matching. Keys and values are normalized words.
const WORD_FOLD = {
  kill: 'curl', kills: 'curl', girl: 'curl', girls: 'curl', kurl: 'curl', kurls: 'curl', coil: 'curl', coils: 'curl', cool: 'curl', kerl: 'curl', curls: 'curl', curling: 'curl', karl: 'curl', carl: 'curl', kel: 'curl',
  flies: 'fly', flys: 'fly', flyes: 'fly', flye: 'fly', rows: 'row', rowing: 'row', rose: 'row', raises: 'raise', rays: 'raise', race: 'raise', raise: 'raise', raze: 'raise',
  presses: 'press', pressing: 'press', pres: 'press', prez: 'press', squats: 'squat', squad: 'squat', squads: 'squat', lunges: 'lunge', dips: 'dip', extensions: 'extension',
  pushdowns: 'pushdown', pulldowns: 'pulldown', shrugs: 'shrug', deadlifts: 'deadlift', thrusts: 'thrust', crunches: 'crunch', teacher: 'preacher', preachers: 'preacher', preecher: 'preacher', breacher: 'preacher', creature: 'preacher',
  hammers: 'hammer', machines: 'machine', maskinen: 'maskine', cables: 'cable', dumbbells: 'dumbbell', dumbell: 'dumbbell', dumbel: 'dumbbell', barbells: 'barbell', tricep: 'triceps', trycep: 'triceps', bicep: 'biceps',
  peck: 'pec', pek: 'pec', pecs: 'pec', calves: 'calf', calfs: 'calf', legs: 'leg', inclined: 'incline', declined: 'decline', sitting: 'seated', laying: 'lying', kickbacks: 'kickback', pullovers: 'pullover',
  laterals: 'lateral', latteral: 'lateral', pulls: 'pull', pushes: 'push', extentions: 'extension', extention: 'extension'
};
const STOP = new Set(['i', 'med', 'with', 'the', 'a', 'on', 'paa', 'til', 'af', 'of', 'in', 'my', 'min', 'mit', 'some', 'nogle', 'en', 'et', 'and', 'og', 'for', 'at']);
// kit and position words matter less than the movement: "machine" alone never picks an exercise
const MOD = new Set(['machine', 'maskine', 'cable', 'kabel', 'dumbbell', 'haandvaegt', 'haandvaegte', 'barbell', 'stang', 'smith', 'smithmaskine', 'seated', 'siddende', 'standing', 'staaende', 'lying', 'liggende', 'single', 'arm', 'etarms', 'one']);
// numbers are weights and reps in what you say, but part of a name ("45° leg press")
const wordsOf = (text, keepNum = false) => String(text || '').toLowerCase().split(/[^a-zæøå0-9]+/).map(normalize).filter(w => w && !STOP.has(w) && (keepNum || !/^\d+$/.test(w))).map(w => WORD_FOLD[w] || w);
const stem = w => w.replace(/(es|s)$/, '');
function wordSim(a, b) {
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && stem(a) === stem(b)) return 0.95;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 4 && l.startsWith(s) && l.length - s.length <= 3) return 0.85;
  if (s.length >= 4) { const d = levenshtein(a, b); if (d <= 1) return 0.8; if (d <= 2 && s.length >= 7) return 0.7; }
  return 0;
}
const weightOf = w => (MOD.has(w) ? 0.6 : 1);
// 0..100: how much of the exercise's name was said, less for each word said that isn't in it
export function wordScore(termWords, queryWords) {
  if (!termWords.length || !queryWords.length) return 0;
  let have = 0, all = 0, core = false;
  for (const t of termWords) {
    const best = Math.max(0, ...queryWords.map(q => wordSim(t, q)));
    all += weightOf(t);
    if (best >= 0.7) { have += weightOf(t) * best; if (!MOD.has(t)) core = true; }
  }
  if (!core || have / all < 0.5) return 0;
  // a word said that isn't in the name: a kit word costs a little ("machine" preacher curl → Preacher
  // curl if there's no machine one), any other word a lot ("zottman curl" is not a barbell curl)
  const extras = queryWords.filter(q => !termWords.some(t => wordSim(t, q) >= 0.7));
  if (extras.some(q => !MOD.has(q))) return 0; // (the words around a name are tried on their own by the parser)
  return Math.max(0, Math.round(100 * (have / all) - 15 * extras.length)) + (extras.length ? 0.5 : 0); // .5: said more than its name
}

export function createCatalog(custom = []) {
  const all = [...EXERCISES, ...custom.map(c => ({ ...c, custom: true }))];
  const byId = new Map(all.map(e => [e.id, e]));
  const keys = all.map(e => {
    const names = [e.en, e.da, ...(e.aliases || [])].filter(Boolean);
    return { e, terms: [...new Set(names.map(normalize))], wordTerms: names.map(n => wordsOf(n, true)).filter(w => w.length) };
  });

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
    const qWords = wordsOf(query);
    const raw = [];
    for (const { e, terms, wordTerms } of keys) {
      let s = 0;
      for (const t of terms) s = Math.max(s, score(t, q));
      // word by word, forgiving misheard words and word order ("preacher kill machine")
      for (const wt of wordTerms) s = Math.max(s, wordScore(wt, qWords));
      // every word appears somewhere in the display names: "press bench" still finds Bench press
      if (!s && words.length > 1) {
        const hay = terms.join(' ');
        if (words.every(w => hay.includes(w))) s = 30;
      }
      if (s) raw.push({ e, s });
    }
    // what you use, and what's in this workout, only decide between near-equal matches: a better
    // match of what was said always wins
    const top = Math.floor(Math.max(0, ...raw.map(r => r.s)));
    // an exercise in the workout that fits well (the name said, less maybe the kit word) beats one that isn't:
    // "preacher curl" is the machine preacher curl you're doing today
    const out = raw.map(({ e, s }) => ({ e, s: Math.floor(s) + (boost?.has(e.id) && s >= 70 && s % 1 === 0 ? 30 : 0) + (Math.floor(s) >= top - 12 ? Math.min(10, (usage[e.id] || 0)) + (boost?.has(e.id) && s < 70 ? 8 : 0) : 0) }));
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
