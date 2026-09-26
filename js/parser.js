// Voice command parser, English and Danish. Pure: text + context in, intent out.
//
// ctx = {
//   lang: 'auto'|'da'|'en', unit: 'kg'|'lb', catalog, usage,
//   current: {exerciseId, lastSet: {kg, reps}|null, planned: {kg, reps}|null} | null,
//   workoutExerciseIds: [...], routines: [{id, name, names}], restRunning: bool
// }
// Intent shapes are shared with the AI fallback (phase 3).
import { parseGoalDate } from './goals.js';
import { parseCheckin } from './checkin.js';
import { normalize } from './catalog.js';
import { lbToKg, round } from './units.js';
import { CARDIO_TYPES } from './cardio.js';
import { parseMealLocal } from './fooddb.js';

export const INTENTS = ['LogSet', 'LogSetNo', 'LogSets', 'LogBatch', 'LogCardio', 'StartCardio', 'LogBodyweight', 'LogProtein', 'LogMeal', 'LogWater', 'SetTarget', 'CheckIn', 'LogRel', 'SetGoal', 'RepeatLast', 'AdjustLast', 'EditLast', 'DeleteLast', 'Undo', 'NextExercise', 'PrevExercise',
  'AddWarmup', 'WarmupDone', 'AddExercise', 'SwapExercise', 'StartRoutine', 'StartEmpty', 'Finish', 'Discard', 'StartRest', 'AdjustRest', 'SkipRest',
  'Query', 'Cancel', 'Help', 'Ask', 'Unknown'];

// ---------- text cleanup ----------

export function clean(text) {
  let s = String(text || '').toLowerCase().normalize('NFC');
  s = s.replace(/[’'`´]/g, '');
  s = s.replace(/(\d):(?=\d\d)/g, '$1\u0002');                        // times: 24:30, 1:05:30
  s = s.replace(/(\d)[,.](\d)/g, '$1\u0001$2');                     // decimals: 82,5 / 82.5 ("10, 9" stays a list)
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/(^|\s)\+\s*(\d)/g, '$1plus $2').replace(/(^|\s)-\s*(\d)/g, '$1minus $2');
  s = s.replace(/[×*]/g, ' x ');
  s = s.replace(/(\d)\s*x\s*(\d)/g, '$1 x $2').replace(/(^|\s)x(\d)/g, '$1x $2');
  s = s.replace(/(\d)([a-zæøå]+)/g, '$1 $2');                       // 80kg -> 80 kg
  s = s.replace(/@/g, ' at ');
  s = s.replace(/[^\p{L}\p{N}\u0001\u0002\s]/gu, ' ');              // punctuation, hyphens
  s = s.replace(/\u0001/g, '.').replace(/\u0002/g, ':');
  return s.replace(/\s+/g, ' ').trim();
}

// ---------- language ----------

const DA_WORDS = new Set(('gentagelser gentagelse gentagelserne sæt samme igen læg til mere mindre næste forrige øvelse øvelsen pause pausen ' +
  'spring over færdig afslut og af med hvad hvor mange sidst sidste gang tilbage lavede jeg er det var faktisk ret slet fjern tilføj ' +
  'skift byt træning træningen tom ny fortryd annuller glem hjælp sekunder sekund minutter minut halv halvt halvandet komma tre fem seks ' +
  'syv otte ni ti elleve tolv tretten fjorten femten seksten sytten atten nitten tyve tredive fyrre halvtreds tres halvfjerds firs ' +
  'halvfems hundrede på rekord bedste kassér kasser gør lige tag træk fra kiloene pund færre videre begynd kør nu så gerne min mit en et ' +
  'halvanden halvandet timer løb løbetur løbede cykling cyklede cykel svømning svømmede gåtur gik vejer vægt romaskine motionscykel crosstrainer intervaller').split(' '));
const EN_WORDS = new Set(('same again add more less next previous exercise rest skip finish done the for and what how many much ' +
  'last time left did do is was actually correct delete remove swap switch change workout empty new undo cancel never mind help ' +
  'seconds second minutes minute half point one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty ' +
  'sixty seventy eighty ninety hundred pounds sets of at with my best record discard take off another repeat log start begin ' +
  'kilos fewer extra give me remaining go back move on up down').split(' '));

export function detectLang(s, setting = 'auto') {
  if (setting === 'da' || setting === 'en') return setting;
  let da = 0, en = 0;
  if (/[æøå]/.test(s)) da += 2;
  for (const w of s.split(' ')) { if (DA_WORDS.has(w)) da++; if (EN_WORDS.has(w)) en++; }
  return da > en ? 'da' : 'en';
}

// ---------- numbers ----------

const EN_UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const EN_TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const EN_TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const DA_UNITS = { nul: 0, en: 1, et: 1, én: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9 };
const DA_TEENS = { ti: 10, elleve: 11, tolv: 12, tretten: 13, fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19 };
const DA_TENS = { tyve: 20, tredive: 30, tredve: 30, fyrre: 40, fyrretyve: 40, halvtreds: 50, halvtredsindstyve: 50, tres: 60,
  tresindstyve: 60, halvfjerds: 70, halvfjerdsindstyve: 70, firs: 80, firsindstyve: 80, halvfems: 90, halvfemsindstyve: 90 };
const DA_COMPOUND = new RegExp(`^(${Object.keys(DA_UNITS).filter(k => DA_UNITS[k] > 0).join('|')})og(${Object.keys(DA_TENS).join('|')})$`);
const DIGIT = /^\d+(\.\d+)?$/;

function tables(lang) {
  return lang === 'da'
    ? { units: DA_UNITS, teens: DA_TEENS, tens: DA_TENS, hundred: ['hundrede', 'hundred'], and: 'og', point: 'komma' }
    : { units: EN_UNITS, teens: EN_TEENS, tens: EN_TENS, hundred: ['hundred'], and: 'and', point: 'point' };
}

// Read one number at tokens[i]. Returns {value, len} or null.
function readNumber(tok, i, lang) {
  const T = tables(lang);
  const unitOf = w => (w in T.units ? T.units[w] : DIGIT.test(w) && Number(w) < 10 && !w.includes('.') ? Number(w) : null);
  const tensOf = w => (w in T.tens ? T.tens[w] : DIGIT.test(w) && Number(w) % 10 === 0 && Number(w) >= 20 && Number(w) <= 90 ? Number(w) : null);
  let j = i, value = null;

  // below 100
  const small = k => {
    const w = tok[k];
    if (w == null) return null;
    if (lang === 'da') {
      const m = DA_COMPOUND.exec(w);
      if (m) return { v: DA_UNITS[m[1]] + DA_TENS[m[2]], n: 1 };
      const u = unitOf(w);
      if (u != null && u > 0 && tok[k + 1] === 'og' && tensOf(tok[k + 2] ?? '') != null) return { v: u + tensOf(tok[k + 2]), n: 3 };
    } else {
      const t = tensOf(w);
      if (w in T.tens && t != null) {
        const u = tok[k + 1] in T.units ? T.units[tok[k + 1]] : null;
        if (u != null && u > 0) return { v: t + u, n: 2 };
      }
    }
    if (w in T.teens) return { v: T.teens[w], n: 1 };
    if (w in T.tens) return { v: T.tens[w], n: 1 };
    if (w in T.units) return { v: T.units[w], n: 1 };
    if (DIGIT.test(w)) return { v: Number(w), n: 1 };
    return null;
  };

  // "a hundred" / "et hundrede"
  if ((tok[j] === 'a' || tok[j] === 'et' || tok[j] === 'en') && T.hundred.includes(tok[j + 1])) { value = 100; j += 2; }
  else if (T.hundred.includes(tok[j])) { value = 100; j += 1; }
  else {
    const s = small(j);
    if (!s) return null;
    value = s.v; j += s.n;
    if (value < 10 && T.hundred.includes(tok[j])) { value *= 100; j++; }
  }
  if (value >= 100 && value % 100 === 0) {
    let k = j;
    if (tok[k] === T.and) k++;
    const s = small(k);
    if (s && s.v < 100) { value += s.v; j = k + s.n; }
  }

  // decimals: "komma fem", "point two five"
  if (tok[j] === T.point || (lang === 'da' && tok[j] === 'point') || (lang === 'en' && tok[j] === 'komma')) {
    let k = j + 1, digits = '';
    while (tok[k] != null) {
      const u = tok[k] in T.units ? T.units[tok[k]] : /^\d$/.test(tok[k]) ? Number(tok[k]) : null;
      if (u == null) { if (/^\d+$/.test(tok[k]) && !digits) { digits = tok[k]; k++; } break; }
      digits += u; k++;
    }
    if (digits) { value = Number(`${Math.floor(value)}.${digits}`); j = k; }
  }
  // halves: "and a half", "og en halv", "og halvt", "a half"
  const half = lang === 'da' ? [['og', 'en', 'halv'], ['og', 'et', 'halvt'], ['og', 'halv'], ['og', 'halvt'], ['en', 'halv']] : [['and', 'a', 'half'], ['and', 'half'], ['a', 'half']];
  for (const h of half) {
    if (h.every((w, n) => tok[j + n] === w) && Number.isInteger(value)) { value += 0.5; j += h.length; break; }
  }
  return { value, len: j - i };
}

const SPECIAL_DA = { halvandet: 1.5, halvanden: 1.5 };

// Replace number words with digits. Danish "to" is 2; English "to" stays a word.
export function wordsToNumbers(s, lang) {
  const tok = s.split(' ');
  const out = [];
  for (let i = 0; i < tok.length;) {
    const w = tok[i];
    if (lang === 'da' && w in SPECIAL_DA) { out.push(String(SPECIAL_DA[w])); i++; continue; }
    if (lang === 'da' && (w === 'et' || w === 'en') && tok[i + 1] === 'halvt') { out.push('0.5'); i += 2; continue; }
    if (lang === 'en' && w === 'half' && tok[i + 1] === 'a') { out.push('0.5'); i += 2; continue; }
    const n = readNumber(tok, i, lang);
    if (n && n.len > 0) { out.push(String(round(n.value, 3))); i += n.len; continue; }
    out.push(w); i++;
  }
  return out.join(' ');
}

// ---------- vocab ----------

const KG = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kiloer', 'kilogramm', 'kiloene', 'k', 'kilon']);
const LB = new Set(['lb', 'lbs', 'pound', 'pounds', 'pund']);
const REPS = new Set(['rep', 'reps', 'repetition', 'repetitions', 'gentagelse', 'gentagelser', 'gentagelserne', 'rips', 'wraps', 'raps', 'reps.', 'reb', 'repper']);
const SETS = new Set(['set', 'sets', 'sæt', 'sættet']);
const JOIN = new Set(['for', 'x', 'at', 'with', 'med', 'på', 'i', 'of', 'af', 'and', 'og', 'times', 'gange', 'by']);
const EDGE_FILLER = new Set(['log', 'logged', 'logging', 'did', 'just', 'i', 'jeg', 'lavede', 'tog', 'tager', 'okay', 'ok', 'so', 'så', 'now', 'nu',
  'please', 'tak', 'then', 'and', 'og', 'the', 'a', 'an', 'on', 'for', 'at', 'with', 'med', 'på', 'af', 'of', 'til', 'to', 'in', 'um', 'uh', 'øh', 'ehm', 'hmm',
  'lige', 'gerne', 'did', 'do', 'made', 'got', 'fik', 'of', 'set', 'sæt']);
const BODYWEIGHT = /\b(bodyweight|body weight|no weight|kropsvægt|uden vægt|bw)\b/;

const TIME_SEC = new Set(['s', 'sec', 'secs', 'second', 'seconds', 'sekund', 'sekunder', 'sekunders']);
const TIME_MIN = new Set(['min', 'mins', 'minute', 'minutes', 'minut', 'minutter', 'minutters']);

const isNum = w => DIGIT.test(w);

// ---------- exercise matching ----------

export function matchExercise(phrase, ctx) {
  const cat = ctx.catalog;
  if (!cat || !normalize(phrase)) return null;
  const boost = new Set(ctx.workoutExerciseIds || []);
  const ranked = cat.rank(phrase, { usage: ctx.usage || {}, boost });
  if (!ranked.length) return null;
  const [a, b] = ranked;
  if (a.s < 35) return null;
  if (b && b.e.id !== a.e.id && b.s >= 35 && a.s - b.s < 8 && a.s < 100) {
    return { exerciseId: null, choices: ranked.filter(r => a.s - r.s < 8).slice(0, 3).map(r => r.e.id), score: a.s };
  }
  return { exerciseId: a.e.id, choices: null, score: a.s };
}

// ---------- set values ----------

// Pull weight/reps/count from the token list. Returns {kg, reps, count, rest (leftover tokens), unit}
function setValues(tok, ctx) {
  const used = new Array(tok.length).fill(false);
  let kg = null, reps = null, count = null, unit = null;
  const take = (...ix) => ix.forEach(i => { used[i] = true; });
  const toKg = (v, u) => (u === 'lb' || (!u && ctx.unit === 'lb') ? round(lbToKg(v), 4) : v);

  // "3 sets of 8", "3 sæt af 8", "3 sæt med 8"
  for (let i = 0; i < tok.length - 2; i++) {
    if (isNum(tok[i]) && SETS.has(tok[i + 1])) {
      let k = i + 2;
      if (['of', 'af', 'med', 'x', 'á', 'a', 'på'].includes(tok[k])) k++;
      if (isNum(tok[k] ?? '') && (KG.has(tok[k + 1]) || LB.has(tok[k + 1]))) { count = Number(tok[i]); take(i, i + 1); if (k - i === 3) take(i + 2); } // "3 sets of 100 kilos (for 8)"
      else if (isNum(tok[k] ?? '')) { count = Number(tok[i]); reps = Number(tok[k]); take(i, i + 1, k); if (k - i === 3) take(i + 2); if (REPS.has(tok[k + 1])) take(k + 1); }
    }
  }
  // labeled numbers
  for (let i = 0; i < tok.length; i++) {
    if (used[i] || !isNum(tok[i])) continue;
    const next = tok[i + 1];
    if (KG.has(next) || LB.has(next)) {
      if (kg == null) { unit = LB.has(next) ? 'lb' : 'kg'; kg = toKg(Number(tok[i]), unit); take(i, i + 1); }
    } else if (REPS.has(next)) {
      if (reps == null) { reps = Number(tok[i]); take(i, i + 1); }
    }
  }
  // "A x B"
  for (let i = 0; i < tok.length - 2; i++) {
    if (tok[i + 1] === 'x' && isNum(tok[i]) && isNum(tok[i + 2]) && !used[i + 2]) {
      const a = Number(tok[i]), b = Number(tok[i + 2]);
      if (used[i]) { if (reps == null) { reps = b; take(i + 1, i + 2); } continue; }
      if (a <= 5 && Number.isInteger(a) && kg == null) { count = a; reps = b; }
      else { if (kg == null) kg = toKg(a, null); reps = b; }
      take(i, i + 1, i + 2);
    }
  }
  // "80 4 8": 'for' misheard as 4, only when there are exactly three bare numbers
  const bare = () => tok.map((w, i) => (!used[i] && isNum(w) ? i : -1)).filter(i => i >= 0);
  let b = bare();
  if (b.length === 3 && kg == null && reps == null && tok[b[1]] === '4' && b[1] === b[0] + 1 && b[2] === b[1] + 1) {
    kg = toKg(Number(tok[b[0]]), null); reps = Number(tok[b[2]]); take(...b); b = [];
  }
  // remaining bare numbers
  b = bare();
  if (b.length === 1) {
    const v = Number(tok[b[0]]);
    if (kg != null && reps == null) { reps = v; take(b[0]); }
    else if (reps != null && kg == null) { kg = toKg(v, null); take(b[0]); }
  } else if (b.length === 2 && kg == null && reps == null) {
    let [x, y] = b.map(i => Number(tok[i]));
    if (Number.isInteger(x) && x <= 30 && y > 30) [x, y] = [y, x]; // "8 på 80"
    kg = toKg(x, null); reps = y; take(...b);
  }
  // join words between consumed numbers
  for (let i = 1; i < tok.length - 1; i++) if (!used[i] && JOIN.has(tok[i]) && used[i - 1] && used[i + 1]) used[i] = true;
  for (let i = 0; i < tok.length; i++) if (!used[i] && (REPS.has(tok[i]) || KG.has(tok[i]) || LB.has(tok[i])) && (used[i - 1] || used[i + 1])) used[i] = true;
  const left = tok.filter((_, i) => !used[i]);
  return { kg, reps, count, unit, left, bareLeft: bare().length };
}

function trimFiller(words) {
  let a = 0, z = words.length;
  while (a < z && EDGE_FILLER.has(words[a])) a++;
  while (z > a && EDGE_FILLER.has(words[z - 1])) z--;
  return words.slice(a, z);
}

// ---------- plates and plan-relative sets ----------

// "4 plates" → kg. One-end loaded (T-bar, landmine) and machines: the plates themselves. Barbells: the
// gym meaning (plates on each side) plus the bar. Standard plate: 20 kg / 45 lb unless said.
export function platesToKg({ n, size, perSide }, ex, exId = '', unit = 'kg') {
  const lb = unit === 'lb';
  const plate = size ?? (lb ? 45 : 20);
  const oneEnd = /t-bar|landmine/.test(exId || '') || ex?.equipment === 'machine';
  const bars = lb ? { barbell: 45, trapbar: 55, ezbar: 25, smith: 35 } : { barbell: 20, trapbar: 25, ezbar: 10, smith: 15 };
  const bar = oneEnd ? 0 : bars[ex?.equipment] ?? null;
  const total = bar == null ? n * plate : bar + n * plate * (perSide || bar ? 2 : 1);
  return lb ? round(lbToKg(total), 4) : total;
}

// "2 kg more", "one rep short", "9 reps with 2 kilos more" → {kg?, reps?, kgDelta?, repsDelta?, relative}
const UNIT = '(?:kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pounds?|pund)';
function relPart(p, ctx) {
  let m;
  const toKg = (v, u) => ((u && /^(lb|lbs|pound|pounds|pund)$/.test(u)) || (!u && ctx.unit === 'lb') ? round(lbToKg(v), 4) : v);
  if ((m = new RegExp(`^(\\d+(?:\\.\\d+)?) ?(${UNIT.slice(3, -1)}) (?:more|extra|heavier|up|mere|ekstra|tungere|op)$`).exec(p))) return { kgDelta: toKg(Number(m[1]), m[2]) };
  if ((m = new RegExp(`^(\\d+(?:\\.\\d+)?) ?(${UNIT.slice(3, -1)}) (?:less|lighter|down|mindre|lettere|ned)$`).exec(p))) return { kgDelta: -toKg(Number(m[1]), m[2]) };
  if ((m = /^(\d+) (?:more|extra|ekstra|mere|flere) (?:reps?|repetitions?|gentagelser?)$|^(\d+) (?:reps?|gentagelser?) (?:more|extra|mere|ekstra|til|over)$|^(\d+) (?:more|mere|til|ekstra)$/.exec(p))) return { repsDelta: Number(m[1] ?? m[2] ?? m[3]) };
  if ((m = /^(\d+) (?:reps? )?(?:less|fewer|short|under|mindre|færre)(?: reps?)?$|^(\d+) (?:færre|mindre) (?:reps?|gentagelser?)$/.exec(p))) return { repsDelta: -Number(m[1] ?? m[2]) };
  if ((m = /^(\d+) (?:reps?|repetitions?|gentagelser?)$/.exec(p))) return { reps: Number(m[1]) };
  if ((m = new RegExp(`^(\\d+(?:\\.\\d+)?) ?(${UNIT.slice(3, -1)})$`).exec(p))) return { kg: toKg(Number(m[1]), m[2]) };
  return null;
}
export function relPhrase(text, ctx = {}) {
  const parts = String(text || '').split(/ (?:with|and|but|at|med|og|men|på) /).map(x => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  const out = {};
  for (const p of parts) {
    const r = relPart(p, ctx);
    if (!r) return null;
    for (const [k, v] of Object.entries(r)) { if (out[k] != null) return null; out[k] = v; }
  }
  out.relative = out.kgDelta != null || out.repsDelta != null;
  return out;
}

// ---------- rest durations ----------

function readDuration(s) {
  const m = /(\d+(?:\.\d+)?) ?(s|sec|secs|seconds?|sekund(?:er)?|min|mins|minutes?|minut(?:ter)?)\b/.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  return Math.round(TIME_MIN.has(m[2]) ? v * 60 : v);
}

// ---------- cardio ----------

const CARDIO_WORDS = (() => {
  const list = [];
  for (const c of CARDIO_TYPES) for (const w of [c.en, c.da, ...c.aliases]) list.push([w.toLowerCase(), c.id]);
  return list.sort((a, b) => b[0].length - a[0].length); // longest first: "indoor bike" before "bike"
})();

export function findCardioType(s) {
  for (const [w, id] of CARDIO_WORDS) if (new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(s)) return { id, word: w };
  return null;
}

// Duration in seconds from "30 minutes", "1 hour", "1.5 timer", "24:30", "1:05:30", "45 min".
export function readCardioDuration(s) {
  let m;
  if (/\b(an? )?hour and a half\b|\b1 and a half hours?\b/.test(s)) return 5400;
  if (/\bhalf an? hour\b|\bhalv time\b|\b0\.5 time\b/.test(s)) return 1800;
  if (/\b(an|a|one|1) hour\b/.test(s) && !/\d+ ?(minutes?|mins?)/.test(s)) return 3600;
  if ((m = /(?:^|\s)(\d+):(\d\d):(\d\d)(?:\s|$)/.exec(s))) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  if ((m = /(?:^|\s)(\d+):(\d\d)(?:\s|$)/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  let sec = 0, hit = false;
  const h = /(\d+(?:\.\d+)?) ?(hours?|hrs?|h|timer|time|timers)\b/.exec(s);
  if (h) { sec += Number(h[1]) * 3600; hit = true; }
  const mm = /(\d+(?:\.\d+)?) ?(minutes?|mins?|minutter|minut|m)\b(?! ?(?:meter|meters))/.exec(s);
  if (mm && !/(\d+) ?m\b/.test(s.replace(mm[0], '')) ) { sec += Number(mm[1]) * 60; hit = true; }
  else if (mm) { sec += Number(mm[1]) * 60; hit = true; }
  const ss = /(\d+) ?(seconds?|secs?|sekunder)\b/.exec(s);
  if (ss && hit) sec += Number(ss[1]);
  return hit ? Math.round(sec) : null;
}

// Distance in km from "5 km", "5k", "10 kilometer", "3 miles", "2000 meter", "400 m".
export function readCardioDistance(s) {
  let m;
  if ((m = /(\d+(?:\.\d+)?) ?(km|kilometers?|kilometer|kilometre|kilometres|k)\b/.exec(s))) return Number(m[1]);
  if ((m = /(\d+(?:\.\d+)?) ?(miles?)\b/.exec(s))) return round(Number(m[1]) * 1.609344, 3);
  if ((m = /(\d+) ?(meters?|meter|metres?|m)\b/.exec(s)) && Number(m[1]) >= 50) return Number(m[1]) / 1000;
  return null;
}

function readZone(s) {
  const m = /\b(?:zone|zon) ?([1-5])\b/.exec(s);
  if (m) return Number(m[1]);
  if (/\b(easy|recovery|rolig|roligt|let|nem)\b/.test(s)) return 2;
  if (/\b(hard|hårdt|hård|tempo|threshold)\b/.test(s)) return 4;
  return null;
}

// ---------- main ----------

const R = (re, s) => re.exec(s);

// Long, natural sentences ("just started my back workout, I'm on T-bar row, I've got 80 kilos on,
// did 9 reps") parse as one command when they can; otherwise the gist is pulled out of them.
export function parse(text, ctx = {}) {
  const batch = parseBatch(text, ctx);
  if (batch) return batch;
  const said = String(text || '').trim();
  const pre = foodAndWater(said, ctx); // water, calorie targets
  if (pre) return pre;
  text = shortBy(text);
  const r = parseOne(text, ctx);
  r.heard = said;
  if (r.type === 'Unknown') {
    const named = relOnExercise(text, ctx, r); // "I did one more rep on tricep pushdowns today"
    if (named) return named;
    const meal = mealPhrase(said, ctx, r); // "log 2 eggs and toast", "for lunch chicken and rice", "200 g skyr"
    if (meal) return meal;
    const g = gist(text, ctx, r); // "I'm on C bar row" names the exercise better than word matching
    if (g?.exerciseId) return g;
    return slots(text, ctx, r) || g || r;
  }
  // a set that lost its exercise or its count to word order: fill in what the slots found
  if (r.type === 'LogSet') {
    const f = slots(text, ctx, r);
    if (f && f.kg === r.kg && f.reps === r.reps) {
      if (!r.exerciseId && f.exerciseId) r.exerciseId = f.exerciseId;
      if ((r.count || 1) === 1 && f.count > 1) r.count = f.count;
    }
  }
  return r;
}

// ---------- food, water and targets ----------

const WATER_WORDS = /\b(water|vand|danskvand)\b/;
const numWord = w => ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, et: 1, en: 1, to: 2, tre: 3, fire: 4, fem: 5 })[w] ?? Number(w);
function foodAndWater(text, ctx) {
  const s = clean(text);
  const lang = detectLang(s, ctx.lang);
  const out = (type, f) => ({ type, ...f, lang, heard: String(text).trim() });
  let m;
  // "drank 500 ml water", "2 glasses of water", "a bottle of water", "et glas vand", "water 750"
  if (WATER_WORDS.test(s) && !/\b(ate|had|spiste)\b.*\b(and|og)\b/.test(s)) {
    if ((m = /(\d+(?:\.\d+)?) ?(ml|l|liter|litre|dl|cl)\b/.exec(s))) return out('LogWater', { ml: Math.round(Number(m[1]) * { ml: 1, l: 1000, liter: 1000, litre: 1000, dl: 100, cl: 10 }[m[2]]) });
    if ((m = /\b(a|an|one|two|three|four|five|\d+|et|en|to|tre|fire|fem) (glass|glasses|glas|cups?|kopper|kop|bottles?|flasker?|flaske)\b/.exec(s))) {
      const per = /bottle|flask/.test(m[2]) ? 500 : 250;
      return out('LogWater', { ml: numWord(m[1]) * per });
    }
    if ((m = /^(?:water|vand) (\d{2,4})$/.exec(s))) return out('LogWater', { ml: Number(m[1]) });
  }
  // "set my calories to 2400", "protein 180 grams", "sæt kalorier til 2400"
  if ((m = /^(set|change|make|put|sæt|ændr|skift)?\s*(?:my |mine |min )?(calories|calorie|kcal|kalorier|protein|carbs|kulhydrater|fat|fedt)( target| goal| mål| målet)?(?: to| til| at| på)? (\d{2,4})(?: ?(?:kcal|calories|kalorier|g|gram|grams))?$/.exec(s)) && (m[1] || m[3])) {
    m = [m[0], m[2], m[4]]; // a target needs "set …" or "… target": "protein 30 g" alone is food
    const key = { calories: 'kcal', calorie: 'kcal', kcal: 'kcal', kalorier: 'kcal', protein: 'protein', carbs: 'carbs', kulhydrater: 'carbs', fat: 'fat', fedt: 'fat' }[m[1]];
    return out('SetTarget', { key, value: Number(m[2]) });
  }
  return null;
}

// A question, a greeting or talk ("what's going on?", "how am I doing", "hi coach", "thanks"), not a meal.
const CHAT_START = /^(?:hey |hi |yo |ok |okay |so |and |but )?(?:what|what's|whats|how|how's|why|when|where|who|which|should|could|would|can|can't|is|are|am|do|does|did|will|tell me|explain|help|i want|i need|i feel|i'm|im|i am|let's|lets|hi|hey|hello|yo|thanks|thank you|ok|okay|good morning|good night|sup|hvad|hvordan|hvorfor|hvornår|hvor|hvem|hvilken|skal|kan|bør|er|vil|fortæl|forklar|hjælp|jeg vil|jeg har brug|jeg føler|hej|tak|godmorgen|godnat)\b/i;
export function isChat(text) {
  const s = String(text || '').toLowerCase().trim();
  if (!s) return false;
  if (/\?\s*$/.test(s)) return true;
  // "I'm eating …", "I had …", "I ate …" are meals even though they start like talk
  if (/^(?:i'm |im |i am |jeg )?(?:eating|having|had|ate|drinking|drank|spiser|spiste|drikker|drak|fik)\b/.test(s)) return false;
  return CHAT_START.test(s);
}

const SLOT_WORDS = { breakfast: 'breakfast', morgenmad: 'breakfast', lunch: 'lunch', frokost: 'lunch', dinner: 'dinner', aftensmad: 'dinner', supper: 'dinner', snack: 'snack', mellemmåltid: 'snack' };
function mealPhrase(text, ctx, unknown) {
  const s = String(text || '').toLowerCase().trim().replace(/[.!?]+$/, '');
  const lang = unknown.lang;
  const out = (food, slot) => ({ type: 'LogMeal', text: food, ...(slot ? { slot } : {}), lang, heard: String(text).trim() });
  let m;
  // "for lunch I had chicken and rice", "til frokost fik jeg …", "breakfast: skyr and oats"
  if ((m = /^(?:for |to |til )?(breakfast|lunch|dinner|supper|snack|morgenmad|frokost|aftensmad|mellemmåltid)\b[:,]?\s*(?:i had|i ate|was|i got|fik jeg|spiste jeg|var|havde jeg|jeg fik|jeg spiste)?\s*(.{3,})$/.exec(s))) return out(m[2].trim(), SLOT_WORDS[m[1]]);
  // "log 2 eggs and toast", "add a banana", "track 200 g skyr"
  if ((m = /^(?:log|add|track|record|note|put in|notér|noter|tilføj|registrer|skriv)(?: me)?(?: down)? (.{3,})$/.exec(s))) {
    const rest = m[1].replace(/\s+(?:to|til) (?:my )?(?:food|meals|mad)$/, '');
    if (parseMealLocal(rest, lang) || ctx.screen === 'food' || /\b(for (?:breakfast|lunch|dinner)|meal|food|måltid|mad)\b/.test(s)) return out(rest);
  }
  // said on its own: "2 eggs and toast", "200 g skyr og en banan"
  if (parseMealLocal(s, lang)) return out(s);
  // on the Food screen, anything that isn't a command, a question or small talk is food
  if (ctx.screen === 'food' && /[a-zæøå]{3}/.test(s) && !/\b(reps?|sets?|sæt|gentagelser|km|minutes?|minutter)\b/.test(s) && !isChat(text)) return out(s);
  return null;
}

// "I needed one more rep" / "missed one rep" / "manglede en gentagelse": one short of the plan.
const shortBy = text => String(text || '')
  .replace(/\b(?:i )?(?:needed|was|came up|fell)(?: just)? (one|1|two|2) (?:more )?reps?(?: short)?\b/gi, '$1 rep less')
  .replace(/\bmissed(?: by)? (one|1|two|2)(?: reps?)?\b/gi, '$1 rep less')
  .replace(/\b(?:jeg )?manglede (en|én|1|to|2) (?:gentagelser?|reps?)\b/gi, '$1 gentagelse mindre');

// A change told about a named lift: "one more rep on pushdowns", "I did 2 kg more on the leg press
// today", "på triceps pushdown tog jeg en gentagelse mere". The lift is found, the rest is read as if
// that lift were the current one.
const REL_WORD = /\b(more|less|fewer|extra|again|same|planned|mere|mindre|færre|igen|samme|planlagt)\b/;
function relOnExercise(text, ctx, unknown) {
  const s = wordsToNumbers(clean(String(text || '')), unknown.lang);
  const rel = REL_WORD.test(s);
  const tail = /\s+(?:today|tonight|this time|this week|again|i dag|idag|denne gang)$/;
  const tries = [];
  const m = /^(.*?)\s+(?:on|for|at|with|during|in|doing|på|til|ved|i|med)\s+(?:the |my |those |de |mine |min )?(.+)$/.exec(s.replace(tail, ''));
  if (m) tries.push([m[2], m[1]]);
  const lead = /^(?:on|for|with|på|til|ved|i)\s+(?:the |my )?(.+)$/.exec(s.replace(tail, ''));
  const words = (lead ? lead[1] : s.replace(tail, '')).split(' ');
  for (let n = 4; n >= 1; n--) if (words.length > n) tries.push([words.slice(0, n).join(' '), words.slice(n).join(' ').replace(/^(?:i |jeg )?(?=\S)/, m => m)]);
  for (const [phrase, rest] of tries) {
    const ph = phrase.replace(tail, '').trim();
    const hit = [matchExercise(ph, ctx), matchExercise(ph.replace(/s\b/g, ''), ctx)].filter(h => h?.exerciseId).sort((x, y) => y.score - x.score)[0]; // "triceps pushdowns"
    if (!hit || hit.score < 50 || !rest.trim()) continue;
    const sub = { ...ctx, current: { exerciseId: hit.exerciseId, lastSet: null, planned: null } };
    const n = /^(?:i |jeg )?(?:did|got|hit|made|managed|tog|lavede|fik|klarede) (\d+)$/.exec(rest.trim());
    const r = n ? { type: 'LogRel', reps: Number(n[1]) } : parseOne(rest.trim(), sub);
    if (!['LogRel', 'AdjustLast', 'RepeatLast', 'LogSet'].includes(r.type) || (!rel && r.type !== 'LogRel' && r.type !== 'LogSet')) continue;
    const type = r.type === 'AdjustLast' ? 'LogRel' : r.type;
    return { ...r, type, exerciseId: r.exerciseId || hit.exerciseId, lang: unknown.lang, heard: unknown.heard };
  }
  return null;
}

// A whole session in one go: "bench 3x8 at 80, then rows 3x10 at 60, then lateral raises 3 by 15 with 10".
// Each piece that names its own lift and numbers becomes one item; needs two or more different lifts.
const STRONG_SPLIT = /\b(?:and then|then|after that|afterwards|next|followed by|og så|så|derefter|bagefter|efter det)\b|[;\n]|[.!?](?=\s|$)/i;
export function parseBatch(text, ctx = {}) {
  const raw = String(text || '').trim();
  const one = t => {
    const r = parseOne(t, ctx);
    if (r.type === 'LogSet' && r.exerciseId) return r;
    const f = slots(t, ctx, r);
    return f?.exerciseId ? f : null;
  };
  for (const splitter of [STRONG_SPLIT, /,/]) {
    const parts = raw.split(new RegExp(splitter.source, 'gi')).map(x => x.trim()).filter(x => /\d/.test(x) || /[a-zæøå]{3}/i.test(x));
    if (parts.length < 2) continue;
    const items = [];
    for (const p of parts) {
      const r = one(p);
      if (r) items.push({ exerciseId: r.exerciseId, kg: r.kg, reps: r.reps, count: r.count || 1 });
      else if (/\d/.test(p)) { items.length = 0; break; } // a piece with numbers we can't read: not a batch
    }
    if (items.length >= 2 && new Set(items.map(i => i.exerciseId)).size >= 2) {
      return { type: 'LogBatch', items: items.slice(0, 12), lang: detectLang(clean(raw), ctx.lang), heard: raw };
    }
  }
  return null;
}

// Word order doesn't matter: "tricep pushdowns with two sets and 50 kilograms for eight reps",
// "two sets of tricep pushdowns at 50 kilos for 8", "rope pushdown 25 kg 12 reps 3 sets".
// Finds the sets, the weight, the reps and the exercise wherever they are.
const FILLER = new Set(('i did just my the a an of with and at for on then on the some reps rep sets set kilos kilo kg kgs kilograms pounds lbs each ' +
  'jeg lavede tog med og på af til sæt gentagelser kilo hver').split(' '));
function slots(text, ctx, base) {
  let s = verbsToLifts(wordsToNumbers(clean(String(text || '')), base.lang));
  const tok = s.split(' ');
  const used = new Array(tok.length).fill(false);
  let kg = null, reps = null, count = null;
  const at = (test, fn) => { for (let i = 0; i < tok.length; i++) if (!used[i] && test(i)) { fn(i); return true; } return false; };
  const num = i => /^\d+(\.\d+)?$/.test(tok[i] || '');
  // N sets (of M)
  at(i => num(i) && /^(sets?|sæt|rounds?)$/.test(tok[i + 1] || ''), i => {
    count = Number(tok[i]); used[i] = used[i + 1] = true;
    if (['of', 'af', 'med', 'x'].includes(tok[i + 2]) && num(i + 3) && !KG.has(tok[i + 4]) && !LB.has(tok[i + 4])) { reps = Number(tok[i + 3]); used[i + 2] = used[i + 3] = true; }
  });
  // N kg / lb
  at(i => num(i) && (KG.has(tok[i + 1]) || LB.has(tok[i + 1])), i => {
    kg = LB.has(tok[i + 1]) || (ctx.unit === 'lb' && !KG.has(tok[i + 1])) ? round(lbToKg(Number(tok[i])), 4) : Number(tok[i]); used[i] = used[i + 1] = true;
  });
  // N reps
  if (reps == null) at(i => num(i) && REPS.has(tok[i + 1] || ''), i => { reps = Number(tok[i]); used[i] = used[i + 1] = true; });
  // "for 8", "x 8"
  if (reps == null) at(i => ['for', 'x', 'gange'].includes(tok[i]) && num(i + 1) && !KG.has(tok[i + 2]), i => { reps = Number(tok[i + 1]); used[i] = used[i + 1] = true; });
  // a bare number left over: the weight if we have reps, the reps if we have the weight
  const bare = tok.map((x, i) => (!used[i] && num(i) ? i : -1)).filter(i => i >= 0);
  if (bare.length === 1 && kg == null && reps != null) { kg = Number(tok[bare[0]]); used[bare[0]] = true; }
  else if (bare.length === 1 && reps == null && kg != null) { reps = Number(tok[bare[0]]); used[bare[0]] = true; }
  if (reps == null || !Number.isInteger(reps) || reps < 1 || reps > 100) return null;
  // the exercise: the best-matching run of the words that are left
  const words = tok.map((x, i) => (used[i] || FILLER.has(x) || EDGE_FILLER.has(x) || /^\d/.test(x) ? null : x));
  let best = null;
  for (let len = 4; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const run = words.slice(i, i + len);
      if (run.some(x => !x)) continue;
      const hit = matchExercise(run.join(' '), ctx);
      if (hit?.exerciseId && hit.score >= (len >= 2 ? 35 : 50) && (!best || hit.score + len * 4 > best.v)) best = { id: hit.exerciseId, v: hit.score + len * 4 };
    }
  }
  const exerciseId = best?.id || null;
  const bw = exerciseId && ctx.catalog?.get(exerciseId)?.equipment === 'bodyweight';
  if (kg == null && !bw) return null;
  return { type: 'LogSet', kg: kg ?? 0, reps, count: Math.max(1, Math.min(10, count || 1)), ...(exerciseId ? { exerciseId } : {}), lang: base.lang, heard: base.heard, slots: true };
}

const KG_RE = /(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|kilogram|kilograms|kilo s|kiloer|pounds?|lbs?)\b/;
const REPS_RE = /(\d+)\s*(reps?|repetitions?|gentagelser|gentagelse|times|gange)\b|\b(?:did|made|got|hit|lavede|tog|fik)\s+(\d+)\b(?!\s*(?:kg|kilo|kilos|pounds|lbs|sets?|sæt))/;
const CUE_RE = /(?:^|\b)(?:i am on|im on|i m on|i am doing|im doing|doing|now on|on to|onto|moving to|starting with|next is|jeg er på|jeg er i gang med|jeg laver|nu)\s+(?:the\s+|some\s+)?(.+)$/;
const START_RE = /\b(?:start(?:ed|ing)?|began|begin|kicked off|startede|starter|begyndte)\b.*?\b([a-zæøå]+)?\s*(?:workout|session|day|træning|dag)\b/;

function gist(text, ctx, unknown) {
  const raw = String(text || '');
  const parts = raw.split(/[.!?;\n]+|,\s+/).map(x => wordsToNumbers(clean(x), unknown.lang)).filter(Boolean);
  const all = parts.join(' . ');
  if (parts.length < 2) { // one clause: only "start(ed) my back workout" is worth guessing at
    const m1 = START_RE.exec(all);
    if (!m1 || ctx.active) return null;
    const rid = m1[1] ? (ctx.routines || []).find(r => normalize(r.name || '').includes(m1[1]))?.id : null;
    return rid ? { type: 'StartRoutine', routineId: rid, lang: unknown.lang, heard: unknown.heard, gist: true } : { type: 'StartEmpty', lang: unknown.lang, heard: unknown.heard, gist: true };
  }
  const out = (type, fields = {}) => ({ type, ...fields, lang: unknown.lang, heard: unknown.heard, gist: true });
  let kg = null, reps = null, exerciseId = null, routineWord = null;
  let m;
  if ((m = KG_RE.exec(all))) kg = /pound|lb/.test(m[2]) || (ctx.unit === 'lb' && !/kg|kilo/.test(m[2])) ? round(lbToKg(Number(m[1])), 4) : Number(m[1]);
  if ((m = REPS_RE.exec(all))) reps = Number(m[1] || m[3]);
  // the exercise: a clause that names one after a cue ("I'm on C bar row"), else any clause that is one
  for (const p of parts) {
    const c = CUE_RE.exec(p);
    const phrase = (c ? c[1] : p).replace(/\b\d+(\.\d+)?\b.*$/, '').trim();
    if (!phrase || phrase.split(' ').length > 5) continue;
    const hit = matchExercise(phrase, ctx);
    if (hit?.exerciseId && (c || hit.score >= 60)) { exerciseId = hit.exerciseId; break; }
  }
  if ((m = START_RE.exec(all))) routineWord = m[1] || '';
  const routineId = routineWord ? (ctx.routines || []).find(r => normalize(r.name || '').includes(routineWord))?.id || null : null;
  if (kg != null && reps && Number.isInteger(reps) && reps > 0 && reps <= 100) return out('LogSet', { kg, reps, count: 1, ...(exerciseId ? { exerciseId } : {}), ...(routineId ? { routineId } : {}) });
  if (exerciseId) return out('AddExercise', { exerciseId, ...(routineId ? { routineId } : {}) });
  if (routineId) return out('StartRoutine', { routineId });
  if (routineWord != null && !ctx.active) return out('StartEmpty');
  return null;
}

// "I benched 100", "squatted 140 for 5", "deadlifted 180": the verb names the lift.
const LIFT_VERBS = [
  [/\bbench(?:ed|ing)\b/g, 'bench'], [/\bsquat(?:ted|ting)\b/g, 'squat'], [/\bdeadlift(?:ed|ing)\b/g, 'deadlift'],
  [/\bcurl(?:ed|ing)\b/g, 'curl'], [/\bshoulder press(?:ed|ing)\b/g, 'shoulder press'],
  [/\boverhead press(?:ed|ing)\b/g, 'overhead press'], [/\bleg press(?:ed|ing)\b/g, 'leg press'], [/\blunged\b/g, 'lunge'],
  [/\bhip thrust(?:ed|ing)\b/g, 'hip thrust'], [/\bpull(?:ed)? ups\b/g, 'pull ups'], [/\bshrugged\b/g, 'shrug']
];
export const verbsToLifts = s => LIFT_VERBS.reduce((a, [re, to]) => a.replace(re, to), s).replace(/\b(\d+) by (\d+)\b/g, '$1 x $2');

function parseOne(text, ctx = {}) {
  const heard = String(text || '').trim();
  const base = clean(heard);
  const lang = detectLang(base, ctx.lang);
  let s = verbsToLifts(wordsToNumbers(base, lang));
  const out = (type, fields = {}) => ({ type, ...fields, lang, heard });
  if (!s) return out('Unknown');
  // "4 plates", "2 plates a side", "3 plader": weight from plates, worked out once we know the exercise
  let plates = null;
  { const pm = /(?:(?:with|med|at|på) )?\b(\d+) (?:plates?|plader|pladerne|skiver)(?: (?:of|på|a) (\d+(?:\.\d+)?)(?: ?(?:kg|kilo|kilos|lb|lbs))?)?((?: (?:a|per|each|on each|på hver|hver|pr) side)?)/.exec(s);
    if (pm && !/\b(sets?|sæt)\b/.test(s.slice(pm.index + pm[0].length, pm.index + pm[0].length + 5))) {
      plates = { n: Number(pm[1]), size: pm[2] ? Number(pm[2]) : null, perSide: !!pm[3].trim() };
      s = (s.slice(0, pm.index) + ' ' + s.slice(pm.index + pm[0].length)).replace(/\s+/g, ' ').trim();
    } }
  const plateKg = exId => plates && platesToKg(plates, ctx.catalog?.get(exId || ctx.current?.exerciseId), exId || ctx.current?.exerciseId, ctx.unit);
  if (plates && !s) {
    const reps = ctx.current?.planned?.reps ?? ctx.current?.shown?.reps ?? null;
    return reps ? out('LogSet', { kg: plateKg(null), reps, count: 1, exerciseId: null }) : out('Ask', { reason: 'reps', then: { type: 'LogSet', kg: plateKg(null), reps: null, count: 1, exerciseId: null } });
  }

  const exercise = phrase => matchExercise(phrase, ctx);
  const withExercise = (type, phrase) => {
    const m = exercise(phrase);
    if (!m) return null;
    return m.exerciseId ? out(type, { exerciseId: m.exerciseId }) : out('Ask', { reason: 'exercise', choices: m.choices, then: { type } });
  };

  // --- exact short commands ---
  if (/^(cancel|never ?mind|forget (it|that)|stop|nope|no|annuller|glem det|lad være|nej|stop det)$/.test(s)) return out('Cancel');
  if (/^(help|hjælp|what can i say|hvad kan jeg sige|commands)$/.test(s)) return out('Help');
  if (/^(undo|undo that|undo last|fortryd|fortryd det|fortryd sidste)$/.test(s)) return out('Undo');
  if (/^(delete|remove|slet|fjern)( the| det)?( last| sidste| that| det)( set| sæt)?$/.test(s)) return out('DeleteLast');
  if (/^(discard|throw away|scrap|cancel|delete|trash)( the| this| my)? (workout|session|training)$/.test(s) ||
      /^(kassér|kasser|slet|annuller|smid)( hele)?( den| denne)?( her)? (træningen|træning)( væk| ud)?$/.test(s)) return out('Discard');
  if (/^(finish|end|complete|stop|wrap up|close)( the| this| my)?( workout| session| training)?$/.test(s) ||
      /^(im |i am )?(done|finished)( with( the| this| my)? (workout|session|training))?$/.test(s) ||
      /^(afslut|stop|slut|færdig|jeg er færdig|vi er færdige)( med)?( træningen| træning)?$/.test(s) ||
      /^(finish|afslut) (workout|træning|træningen)( now| nu)?$/.test(s)) return out('Finish');

  // --- warm-ups ---
  if (/^((ok |okay )?(next|done|finished)( with)?( the| my)? warm ?ups?( set)?|warm ?ups?( set)? (done|finished|complete|ok|klar))$/.test(s) ||
      /^((opvarmning(en)?|opvarmningssæt(tet)?) (færdig|klar|done|ok)|færdig med opvarmning(en|ssættet)?|næste opvarmning(ssæt)?)$/.test(s)) return out('WarmupDone');
  if (/^((add|give me|do|start|lets do|i need)( a| the| some| my)? )?warm ?ups?( sets?)?( please| first)?$/.test(s) || /^(let me |lets |i need to |i want to )warm up( first)?$/.test(s) ||
      /^((tilføj|giv mig|lav|start)( en| nogle)? )?(opvarmning|opvarmningssæt)( først)?$/.test(s) || /^(jeg skal |lad mig |lad os )?varme op( først)?$/.test(s)) return out('AddWarmup');

  // --- rest ---
  if (/^(skip|stop|end|drop|cancel|no|kill)( the)? (rest|timer|pause|break|breast|test|chest)$/.test(s) || /^skip( it)?$/.test(s) ||
      /^(spring|skip) (pausen |over pausen|pause )?over$/.test(s) || /^spring pausen over$/.test(s) || /^spring over$/.test(s) ||
      /^(stop|drop|slut|afbryd|skip) (pausen|timeren|pause)$/.test(s) || /^ingen pause$/.test(s) || /^(im )?ready$|^klar$/.test(s)) return out('SkipRest');

  let m;
  if ((m = R(/^(add |plus |give me |another |extra )?(\d+(?:\.\d+)?) ?(more )?(s|sec|secs|seconds?|min|mins|minutes?)( more)?( of)?( to)?( the)?( rest| break)?$/, s)) && (m[1] || m[3] || m[5] || m[7])) {
    return out('AdjustRest', { sec: readDuration(`${m[2]} ${m[4]}`) });
  }
  if ((m = R(/^(minus|less|remove|take off|cut|subtract) ?(\d+(?:\.\d+)?) ?(s|sec|secs|seconds?|min|mins|minutes?)( from)?( the)?( rest| break)?$/, s))) {
    return out('AdjustRest', { sec: -readDuration(`${m[2]} ${m[3]}`) });
  }
  if ((m = R(/^(læg |giv mig |plus )?(\d+(?:\.\d+)?) ?(sekunder|sekund|minut|minutter)( mere| ekstra)?( til| på)?( pausen)?$/, s)) && (m[1] || m[4] || m[5])) {
    return out('AdjustRest', { sec: readDuration(`${m[2]} ${m[3]}`) });
  }
  if ((m = R(/^(træk |tag |minus )?(\d+(?:\.\d+)?) ?(sekunder|sekund|minut|minutter)( mindre)?( fra| af)?( pausen)?$/, s)) && /(træk|tag|minus|mindre)/.test(s)) {
    return out('AdjustRest', { sec: -readDuration(`${m[2]} ${m[3]}`) });
  }
  if (/^(more rest|longer rest|mere pause|længere pause)$/.test(s)) return out('AdjustRest', { sec: 30 });
  if (/^(less rest|shorter rest|mindre pause|kortere pause)$/.test(s)) return out('AdjustRest', { sec: -30 });
  if (ctx.restRunning && (m = R(/^(plus|minus) (\d+)$/, s)) && Number(m[2]) % 15 === 0 && Number(m[2]) <= 120) {
    return out('AdjustRest', { sec: (m[1] === 'minus' ? -1 : 1) * Number(m[2]) });
  }
  if ((m = R(/^(start |begin |begynd |start på )?(the |a |1 )?(rest|timer|pause|pausen|break|hvil|timeren|rest timer)( for| i| på)?( (\d+(?:\.\d+)?) ?(s|sec|secs|seconds?|min|mins|minutes?|sekunder|sekund|minut|minutter))?$/, s))) {
    return out('StartRest', { sec: m[5] ? readDuration(m[5]) : null });
  }
  if ((m = R(/^(\d+(?:\.\d+)?) ?(s|sec|secs|seconds?|min|mins|minutes?|sekunder|sekund|minut|minutter)(?:( of)? (rest|pause|break))?$/, s))) {
    return out('StartRest', { sec: readDuration(`${m[1]} ${m[2]}`) });
  }

  // --- queries ---
  if (/(how (much|long)|whats|what is|how many seconds).*(rest|time|break).*(left|remaining)|^(rest|time) (left|remaining)$|^how long left$/.test(s) ||
      /^hvor (lang|meget|længe)( tid)?( pause)?( er der)?( tilbage| igen)( af pausen| på pausen)?$|^(hvor lang )?pause tilbage$|hvor lang tid.*(tilbage|igen)/.test(s)) {
    return out('Query', { what: 'restLeft' });
  }
  if (/how many (sets|more sets)|sets (left|remaining|to go)|^how many (left|more)$/.test(s) ||
      /hvor mange (sæt|flere sæt)|sæt (tilbage|mangler|igen)|hvor mange (mangler|er der tilbage)/.test(s)) {
    return out('Query', { what: 'setsLeft' });
  }
  if ((m = R(/^(whats |what is |what s |tell me )?(my )?(pr|p r|personal record|personal best|record|best|max)( on| for| in| at)?( the)?( ?(.*))?$/, s)) ||
      (m = R(/^(hvad er )?(min |mit |mine )?(rekord|pr|personlige rekord|bedste|max)( i| på| til| for)?( ?(.*))?$/, s))) {
    const phrase = (m[7] ?? m[6] ?? '').trim();
    const hit = phrase ? exercise(phrase) : null;
    if (phrase && !hit?.exerciseId) { if (hit?.choices) return out('Ask', { reason: 'exercise', choices: hit.choices, then: { type: 'Query', what: 'pr' } }); }
    else return out('Query', { what: 'pr', exerciseId: hit?.exerciseId ?? null });
  }
  if ((m = R(/^(?:whats |what is |what s |tell me )?(?:my )?(.+?) (?:pr|p r|personal record|personal best|record|max)$/, s)) ||
      (m = R(/^(?:hvad er )?(?:min |mit )?(.+?) ?(?:rekord|pr)$/, s))) {
    const hit = exercise(m[1]);
    if (hit?.exerciseId) return out('Query', { what: 'pr', exerciseId: hit.exerciseId });
    if (hit?.choices) return out('Ask', { reason: 'exercise', choices: hit.choices, then: { type: 'Query', what: 'pr' } });
  }
  if ((m = R(/^(what did i do|what did i lift|what was|how did i do|what were|what did i)( on| for| with)?( my)?( the)?( ?(.*?))? ?(last time|last session|last week)$/, s)) ||
      (m = R(/^(last time)( on| for| with)?( my)?( the)?( ?(.*))?$/, s)) ||
      (m = R(/^(hvad (lavede|tog|løftede|tog jeg|gjorde) (jeg )?)?(i |på |med |til )?(( ?.*?))? ?(sidst|sidste gang|sidste træning)$/, s))) {
    const phrase = trimFiller((m[6] ?? m[5] ?? '').trim().split(' ').filter(Boolean)).join(' ');
    const hit = phrase ? exercise(phrase) : null;
    if (!phrase || hit?.exerciseId) return out('Query', { what: 'last', exerciseId: hit?.exerciseId ?? null });
    if (hit?.choices) return out('Ask', { reason: 'exercise', choices: hit.choices, then: { type: 'Query', what: 'last' } });
  }

  // --- morning check-in: "slept 6 hours, legs are sore", "sov 7 timer", "energy 3" ---
  { const ci = parseCheckin(s); if (ci) return out('CheckIn', ci); }

  // --- a goal: "goal 100 kg bench by december", "i want to squat 140 by christmas", "mål 100 kilo bænkpres til jul" ---
  if ((m = R(/^(?:(?:set |new |make )?(?:a |my |the )?goal(?: of| to| is)?|my goal is(?: to)?|i want to|i wanna|mål(?:et er)?|mit mål er(?: at)?|jeg vil(?: gerne)?)(?: hit| lift| do| have| reach| nå| løfte| tage| kunne)? (.+?) (?:by|before|til|inden|før|in|om) (.+)$/, s))) {
    const deadline = parseGoalDate(m[2], ctx.now ?? Date.now());
    const wm = /(\d+(?:\.\d+)?) ?(kg|kilo|kilos|lb|lbs|pounds|pund)?(?: (?:for|x|gange) (\d+)(?: reps?| gentagelser?)?)?/.exec(m[1]);
    if (deadline && wm) {
      const kg = (wm[2] && /^(lb|lbs|pounds|pund)$/.test(wm[2])) || (!wm[2] && ctx.unit === 'lb') ? round(lbToKg(Number(wm[1])), 4) : Number(wm[1]);
      let phrase = (m[1].slice(0, wm.index) + ' ' + m[1].slice(wm.index + wm[0].length)).trim();
      const rm = wm[3] ? null : /(?:^| )(?:for|x|gange) (\d+)(?: reps?| gentagelser?)?(?= |$)/.exec(phrase); // "bench press for 5"
      const reps = wm[3] ? Number(wm[3]) : rm ? Number(rm[1]) : 1;
      if (rm) phrase = phrase.replace(rm[0], ' ');
      phrase = trimFiller(phrase.split(' ').filter(Boolean)).join(' ');
      const hit = phrase ? exercise(phrase) : null;
      const exerciseId = hit?.exerciseId || (!phrase ? ctx.current?.exerciseId : null);
      if (exerciseId) return out('SetGoal', { exerciseId, kg, reps, deadline });
      if (hit?.choices) return out('Ask', { reason: 'exercise', choices: hit.choices, then: { type: 'SetGoal', kg, reps, deadline } });
    }
  }

  // --- bodyweight and protein ---
  if ((m = R(/^(?:i )?(?:weigh|weighed|weight|my weight is|my weight|bodyweight|body weight|jeg vejer|vejer|vægt|min vægt er|kropsvægt)(?: is| er| i dag| today)? (\d+(?:\.\d+)?) ?(kg|kilo|kilos|lb|lbs|pounds|pund)?$/, s))) {
    const v = Number(m[1]);
    return out('LogBodyweight', { kg: m[2] && /^(lb|lbs|pounds|pund)$/.test(m[2]) || (!m[2] && ctx.unit === 'lb') ? round(lbToKg(v), 2) : v });
  }
  if ((m = R(/^(?:i |jeg )?(?:log |add |ate |had |spiste |fik )?(\d+) ?(?:g|gram|grams|gr) (?:of )?protein$|^protein (\d+) ?(?:g|gram|grams)?$/, s))) {
    return out('LogProtein', { grams: Number(m[1] ?? m[2]) });
  }

  // --- a meal to estimate: "i ate 3 eggs and toast", "jeg spiste kylling og ris" ---
  if ((m = R(/^(?:i |jeg )?(?:just |lige )?(?:ate|had|have eaten|spiste|har spist|fik)(?: an?| some| en| et| lidt)? (.{3,})$/, s)) &&
      !/^\d+ ?(?:g|gram|grams|gr) (?:of )?protein$/.test(m[1]) &&
      !/\b(reps?|kilo|kilos|kg|lb|lbs|sets?|sæt|gentagelser|minutes?|minutter|km)\b/.test(m[1])) {
    return out('LogMeal', { text: m[1] });
  }

  // --- what to lift next ---
  if (/^(what should i (lift|do|use|go for)|what weight( should i use| next| now)?|what s next|whats next|hvad skal jeg løfte|hvad skal jeg tage|hvilken vægt( skal jeg tage)?|hvad nu)$/.test(s)) return out('Query', { what: 'suggest' });

  // --- cardio ---
  {
    const ct = findCardioType(s);
    if (ct) {
      if ((m = R(/^(?:start|begin|begynd|start en|start 1|start a|start an)(?: new| ny)? (.+)$/, s)) && !/\d/.test(m[1]) && findCardioType(m[1])?.id === ct.id) {
        return out('StartCardio', { cardioType: ct.id });
      }
      const durationSec = readCardioDuration(s);
      const distanceKm = readCardioDistance(s);
      if (durationSec) return out('LogCardio', { cardioType: ct.id, durationSec, distanceKm, zone: readZone(s) });
      if (distanceKm) return out('Ask', { reason: 'duration', then: { type: 'LogCardio', cardioType: ct.id, distanceKm, zone: readZone(s) } });
    } else if (/^(start|begin|begynd) (?:some |en |1 )?(cardio|kondition|konditionstræning)$/.test(s)) {
      return out('StartCardio', { cardioType: 'other' });
    }
  }

  // --- navigation ---
  if (/^(next|next exercises?|next one|go to (the )?next( exercise)?|move on|moving on|næste|næste øvelse|videre|gå videre|til næste|næste 1)$/.test(s)) return out('NextExercise');
  if (/^(previous|prev|back|previous exercise|go back|go back 1|last exercise|forrige|forrige øvelse|tilbage|gå tilbage)$/.test(s)) return out('PrevExercise');

  // --- start ---
  if (/^(start|begin|begynd|kør|lets do|let s do|start på|start en|start 1)( a| an| 1| en| et)?( new| empty| blank| ny| tom)? ?(workout|session|training|træning|træningen)$/.test(s)) {
    return out('StartEmpty');
  }
  if ((m = R(/^(start|begin|begynd|kør|lets do|let s do|start på)( the| en| et| a| 1)? (.+)$/, s))) {
    const want = normalize(m[3].replace(/\b(workout|training|træning|træningen|routine|rutine|rutinen)\b/g, ''));
    for (const r of ctx.routines || []) {
      const names = [r.name, ...Object.values(r.names || {})].map(normalize);
      const variants = names.flatMap(n => [n, n.replace(/(day|dag)$/, '')]);
      if (variants.some(v => v && (v === want || v === want.replace(/(day|dag)$/, '')))) return out('StartRoutine', { routineId: r.id });
    }
  }

  // --- exercise changes ---
  const swap = R(/^(?:swap|switch|change|replace)(?: this| it| that| the exercise| exercise)?(?: to| with| for| over to| out for)? (.+)$/, s) ||
    R(/^(?:skift|byt|udskift)(?: øvelsen| den| det| denne)?(?: ud)?(?: til| med)? (.+)$/, s);
  if (swap && !/\d/.test(swap[1])) { const r = withExercise('SwapExercise', swap[1]); if (r) return r; }
  if ((m = R(/^(add|tilføj|also|and also|now|next up|next is|nu|lets do|let s do|go to|gå til|hop til)( exercise| øvelse| øvelsen| an exercise| en øvelse| some| er)? (.+)$/, s))) {
    if (!/\d/.test(m[3])) { const r = withExercise('AddExercise', m[3]); if (r) return r; }
  }

  // --- a set by its number: "set one is done", "set 2 done, only 9 reps instead of 10", "first set done at 82.5",
  // "sæt 1 er færdigt, men kun 9 gentagelser". Logs that set of the current lift (or corrects it if it's done). ---
  {
    const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6,
      første: 1, anden: 2, andet: 2, tredje: 3, fjerde: 4, femte: 5, sjette: 6 };
    const m = /(?<!\d )\b(?:set|sæt|sættet)(?: (?:number|no|nr|nummer))? (\d{1,2})\b(?! ?(?:kg|kilo|kilos|lbs?|pounds?|x|×|for|sets?|sæt|reps?|gentagelser))/.exec(s)
      || /\b(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th|første|anden|andet|tredje|fjerde|femte|sjette) (?:set|sæt)\b/.exec(s);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ORD[m[1]];
      let rest = ` ${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)} `.replace(/\s+/g, ' ');
      const said = /\b(?:done|finished|complete|completed|over|did|hit|got|made|færdig|færdigt|færdige|klaret|klar|lavet|taget|gennemført|lavede|tog|fik|klarede)\b/.test(rest);
      rest = rest.replace(/\b(?:instead of|rather than|not|i stedet for|frem for|ikke) \d+(?:\.\d+)?(?: ?(?:reps?|gentagelser))?/g, ' ');
      const kgM = /(\d+(?:\.\d+)?) ?(kg|kilo|kilos|kilogram|lbs?|pounds?|pund)\b/.exec(rest) || /\b(?:at|with|på|med) (\d+(?:\.\d+)?)\b(?! ?(?:reps?|gentagelser|gange))/.exec(rest);
      if (kgM) rest = rest.replace(kgM[0], ' ');
      const repsM = /(\d+) ?(?:reps?|repetitions?|gentagelser|gange)\b/.exec(rest) || /\b(?:only|just|kun|bare) (?:did |got |lavede |tog |fik )?(\d+)\b/.exec(rest) || (said ? /\b(\d+)\b/.exec(rest) : null);
      if (n >= 1 && n <= 12 && (said || repsM || kgM)) {
        const lb = kgM ? /^(lbs?|pounds?|pund)$/.test(kgM[2] || '') || (!kgM[2] && ctx.unit === 'lb') : false;
        const kg = kgM ? (lb ? Math.round(Number(kgM[1]) * 0.45359237 * 10000) / 10000 : Number(kgM[1])) : null;
        return out('LogSetNo', { n, ...(repsM ? { reps: Number(repsM[1]) } : {}), ...(kg != null ? { kg } : {}) });
      }
    }
  }

  // --- a set you just did, told naturally: "i got 9 reps this time", "did 2 kg more", "as planned" ---
  {
    const PERF = /^(?:and |so |okay |ok )?(?:i |jeg )?(?:just |lige |then )?(?:got|get|did|do|hit|made|managed|completed|finished|lifted|pressed|repped|had|tog|lavede|fik|klarede|nåede|løftede|gennemførte|tager)(?: it)?(?: again| igen)? (.+)$/;
    const TAIL = / (?:this time|that time|this set|on this set|on that set|on that one|for that set|there|this round|denne gang|den gang|i det sæt|på det sæt|nu)$/;
    const PLANNED = /^(?:as planned|like planned|as prescribed|what was planned|the planned set|planned set(?: done)?|done as planned|all(?: of)?(?: the)? reps|all of them|full set|the whole set|som planlagt|det planlagte|hele sættet|alle gentagelser|alle)$/;
    const pm = PERF.exec(s);
    let rest = pm ? pm[1].replace(TAIL, '').trim() : null;
    if (rest != null && /^(the )?same(?: again)?$|^samme(?: igen)?$/.test(rest)) return out('RepeatLast', { count: 1 });
    if (rest != null && PLANNED.test(rest)) return out('LogRel', {});
    if (/^(?:as planned|planned set done|done as planned|som planlagt)$/.test(s) ||
        /^(?:i |jeg )?(?:just |lige )?(?:did|hit|nailed|crushed|smashed|made|klarede|lavede|tog) (?:it|that|them|den|det|dem)(?: all| alle)?$/.test(s)) return out('LogRel', {});
    const rel = relPhrase(rest ?? s, ctx);
    if (rel && (rest != null || rel.relative)) {
      const kg = rel.kg ?? (plates ? plateKg(null) : undefined);
      const f = { ...(kg != null ? { kg } : {}), ...(rel.reps != null ? { reps: rel.reps } : {}), ...(rel.kgDelta ? { kgDelta: rel.kgDelta } : {}), ...(rel.repsDelta ? { repsDelta: rel.repsDelta } : {}) };
      // told as something you did → a new set; said on its own → the command decides (fix the last, or a new set)
      if (rest != null) return out('LogRel', f);
      if (rel.relative) return out('AdjustLast', f);
    }
    if (rest != null) s = rest.replace(/^(?:the )?same weight(?: but| and| with)? |^samme vægt(?: men| og| med)? /, '').trim(); // "i got 9 reps on the t-bar row" → "9 reps on the t-bar row"
    else s = s.replace(/^(?:the )?same weight(?: but| and| with)? (?=\d)|^samme vægt(?: men| og| med)? (?=\d)/, '');
  }

  // --- adjust / repeat / edit the last set ---
  if ((m = R(/^(\d+) (more|extra) (reps?|repetitions?|gentagelser?)$|^(\d+) (reps?|gentagelser?) (more|mere|til|ekstra|extra)$|^(\d+) (mere|ekstra) (rep|reps|gentagelser?)$|^(\d+) more rep$/, s))) {
    return out('AdjustLast', { repsDelta: Number(m[1] ?? m[4] ?? m[7] ?? m[10]) });
  }
  if ((m = R(/^(\d+) (less|fewer) (reps?|gentagelser?)$|^(\d+) (reps?|gentagelser?) (less|fewer|mindre|færre)$|^(\d+) (færre|mindre) (reps?|gentagelser?)$/, s))) {
    return out('AdjustLast', { repsDelta: -Number(m[1] ?? m[4] ?? m[7]) });
  }
  const unitRe = '(kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pounds?|pund)';
  const kgDelta = (v, u) => (u && /^(lb|lbs|pound|pounds|pund)$/.test(u)) || (!u && ctx.unit === 'lb') ? round(lbToKg(v), 4) : v;
  if ((m = R(new RegExp(`^(add|plus|put on|up|increase|increase by|go up|go up by|another) (\\d+(?:\\.\\d+)?) ?${unitRe}?( more)?$`), s)) ||
      (m = R(new RegExp(`^(læg|sæt|plus|put) (\\d+(?:\\.\\d+)?) ?${unitRe}? ?(til|på|mere|ekstra)?$`), s)) ||
      (m = R(new RegExp(`^()(\\d+(?:\\.\\d+)?) ?${unitRe} (more|mere|ekstra|til)$`), s))) {
    return out('AdjustLast', { kgDelta: kgDelta(Number(m[2]), m[3]) });
  }
  if ((m = R(new RegExp(`^(minus|remove|take off|subtract|drop|down|go down|go down by|decrease|decrease by|less|træk|tag) (\\d+(?:\\.\\d+)?) ?${unitRe}? ?(fra|af|off|less|mindre)?$`), s)) ||
      (m = R(new RegExp(`^()(\\d+(?:\\.\\d+)?) ?${unitRe} (less|mindre)$`), s))) {
    return out('AdjustLast', { kgDelta: -kgDelta(Number(m[2]), m[3]) });
  }

  if ((m = R(/^(same|samme)( again| igen| as before| as last( set| time)?| som sidst| som før| weight| vægt)?( (\d+) (more )?(times|sets|gange|sæt)( mere| til)?)?$/, s)) ||
      /^(again|repeat|repeat that|repeat last( set)?|one more( set)?|1 more( set)?|another( set| 1)?|do it again|igen|1 gang til|en gang til|gentag|gentag det|1 til|1 mere|1 sæt til|1 sæt mere|same game|same gain|same a gain|samme i gen)$/.test(s)) {
    return out('RepeatLast', { count: m?.[5] ? Number(m[5]) : 1 });
  }
  if ((m = R(/^(\d+) (more sets|sets more|sæt mere|sæt til|flere sæt)$/, s))) return out('RepeatLast', { count: Number(m[1]) });

  if ((m = R(/^(correct|correction|actually|fix|fix it|fix that|change( the)? last( set)?( to)?|edit( the)? last( set)?( to)?|last set was|the last set was|that was|it was|make it|make that|ret( det| sidste| sidste sæt)?( til)?|det var( faktisk)?|faktisk|sidste sæt var|lav det om til|ændr( det| sidste| sidste sæt)?( til)?|nej det var)( to| til)? (.+)$/, s))) {
    const tail = m[m.length - 1];
    const v = setValues(tail.split(' '), ctx);
    if (!trimFiller(v.left).length && (v.kg != null || v.reps != null)) return out('EditLast', { kg: v.kg, reps: v.reps });
    // a single bare number: reps if it's near the last reps, otherwise weight
    const lone = /^(\d+(?:\.\d+)?)$/.exec(tail.trim());
    if (lone) {
      const n = Number(lone[1]);
      const last = ctx.current?.lastSet;
      const asReps = Number.isInteger(n) && n <= 30 && (!last || Math.abs(n - last.reps) <= 5 || Math.abs(n - last.kg) > Math.abs(n - last.reps));
      return out('EditLast', asReps ? { reps: n, kg: null } : { kg: kgDelta(n, null), reps: null });
    }
  }

  // --- several sets with different reps: "9, 8 and 8 reps at 100 kg" / "9 8 og 8 gentagelser med 100 kilo" ---
  {
    const tk = s.split(' ');
    const ri = tk.findIndex((w, i) => REPS.has(w) && isNum(tk[i - 1] ?? ''));
    if (ri > 0) {
      const reps = [];
      let i = ri - 1;
      while (i >= 0 && (isNum(tk[i]) || ['and', 'og', 'then', 'så', 'x'].includes(tk[i]))) { if (isNum(tk[i])) reps.unshift(Number(tk[i])); i--; }
      const listStart = i + 1;
      if (reps.length >= 2 && reps.length <= 10 && reps.every(r => Number.isInteger(r) && r >= 1 && r <= 300)) {
        const rest = [...tk.slice(0, listStart), ...tk.slice(ri + 1)];
        // weight: a labeled number, or one after at/with/med/på
        let kg = null, unitWord = null;
        const kept = [];
        for (let k = 0; k < rest.length; k++) {
          if (isNum(rest[k]) && (KG.has(rest[k + 1]) || LB.has(rest[k + 1]))) { unitWord = rest[k + 1]; kg = Number(rest[k]); k++; continue; }
          if (isNum(rest[k]) && ['at', 'with', 'med', 'på'].includes(rest[k - 1]) && kg == null) { kg = Number(rest[k]); kept.pop(); continue; }
          kept.push(rest[k]);
        }
        const leftover = trimFiller(kept.filter(w => !SETS.has(w) && !isNum(w) && !['of', 'af', 'sets', 'sæt'].includes(w)));
        const counted = kept.find(isNum);
        if (!counted || Number(counted) === reps.length) {
          let exerciseId = null, ok = true;
          if (leftover.length) { const hit = exercise(leftover.join(' ')); if (hit?.exerciseId) exerciseId = hit.exerciseId; else ok = false; }
          if (ok) {
            if (kg != null) kg = unitWord && LB.has(unitWord) || (!unitWord && ctx.unit === 'lb') ? round(lbToKg(kg), 4) : kg;
            const sameEx = !exerciseId || exerciseId === ctx.current?.exerciseId;
            kg ??= sameEx ? (ctx.current?.lastSet?.kg ?? ctx.current?.planned?.kg ?? null) : null;
            if (kg == null) return out('Ask', { reason: 'weight', then: { type: 'LogSets', sets: reps.map(r => ({ kg: null, reps: r })), exerciseId } });
            return out('LogSets', { sets: reps.map(r => ({ kg, reps: r })), exerciseId });
          }
        }
      }
    }
  }

  // --- log a set ---
  const tok = s.split(' ');
  const bw = BODYWEIGHT.test(s);
  const v = setValues(tok.filter(w => !['bodyweight', 'kropsvægt', 'bw'].includes(w)), ctx);
  if (bw && v.kg == null) v.kg = 0;
  let words = trimFiller(v.left.filter(w => !['body', 'weight', 'no', 'uden', 'vægt'].includes(w) || !bw));
  // "10 pull-ups": one bare number with a bodyweight exercise is reps
  if (v.kg == null && v.reps == null && v.count == null && v.bareLeft === 1) {
    const phrase = trimFiller(v.left.filter(w => !isNum(w))).join(' ');
    const hit = phrase ? exercise(phrase) : null;
    const exId = hit?.exerciseId || (!phrase ? ctx.current?.exerciseId : null);
    if (exId && ctx.catalog?.get(exId)?.equipment === 'bodyweight') {
      const n = Number(v.left.find(isNum));
      if (Number.isInteger(n) && n > 0) {
        const last = exId === ctx.current?.exerciseId ? ctx.current?.lastSet?.kg : null;
        return out('LogSet', { kg: last ?? 0, reps: n, count: 1, exerciseId: hit?.exerciseId ?? null });
      }
    }
  }
  // with plates giving the weight, one bare number is the reps: "t-bar row 3 plates for 10"
  if (plates && v.kg == null && v.reps == null && v.bareLeft === 1) {
    const n = Number(v.left.find(isNum));
    if (Number.isInteger(n) && n >= 1 && n <= 100) { v.reps = n; v.left = v.left.filter(w => !isNum(w) && !['for', 'x', 'gange', 'times'].includes(w)); v.bareLeft = 0; words = trimFiller(v.left); }
  }
  if (v.kg == null && v.reps == null && v.count == null && plates && !words.length) {
    const kg = plateKg(null), reps = ctx.current?.planned?.reps ?? ctx.current?.shown?.reps ?? null;
    if (kg != null && reps != null) return out('LogSet', { kg, reps, count: 1, exerciseId: null });
  }
  if (v.kg == null && v.reps == null && v.count == null) {
    // just an exercise name: jump to it or add it
    if (words.length && !/\d/.test(words.join(' '))) {
      const hit = exercise(words.join(' '));
      if (hit?.exerciseId && plates) {
        const same = hit.exerciseId === ctx.current?.exerciseId;
        const reps = same ? ctx.current?.planned?.reps ?? ctx.current?.shown?.reps ?? null : null;
        const f = { kg: plateKg(hit.exerciseId), reps, count: 1, exerciseId: hit.exerciseId };
        return reps ? out('LogSet', f) : out('Ask', { reason: 'reps', then: { type: 'LogSet', ...f } });
      }
      if (hit?.exerciseId && hit.score >= 60) return out('AddExercise', { exerciseId: hit.exerciseId });
      if (hit?.choices) return out('Ask', { reason: 'exercise', choices: hit.choices, then: { type: 'AddExercise' } });
    }
    return out('Unknown');
  }
  if (v.bareLeft > 0) return out('Unknown');
  let exerciseId = null;
  if (words.length) {
    const hit = exercise(words.join(' '));
    if (!hit) return out('Unknown');
    if (!hit.exerciseId) return out('Ask', { reason: 'exercise', choices: hit.choices, then: { type: 'LogSet', kg: v.kg, reps: v.reps, count: v.count } });
    exerciseId = hit.exerciseId;
  }
  let { kg, reps } = v;
  if (kg == null && plates) kg = plateKg(exerciseId);
  const count = v.count ?? 1;
  const sameEx = !exerciseId || exerciseId === ctx.current?.exerciseId;
  // what's on screen wins: the steppers show the planned set (or what you dialed in)
  const lastKg = sameEx ? (ctx.current?.shown?.kg ?? ctx.current?.lastSet?.kg ?? ctx.current?.planned?.kg ?? null) : null;
  const bodyweightEx = ctx.catalog?.get(exerciseId || ctx.current?.exerciseId)?.equipment === 'bodyweight';
  if (kg == null) kg = lastKg ?? (bodyweightEx ? 0 : null);
  if (reps == null && sameEx) reps = ctx.current?.planned?.reps ?? ctx.current?.shown?.reps ?? null;
  if (reps != null && (!Number.isInteger(reps) || reps < 1)) return out('Unknown');
  if (kg == null) return out('Ask', { reason: 'weight', then: { type: 'LogSet', kg, reps, count, exerciseId } });
  if (reps == null) return out('Ask', { reason: 'reps', then: { type: 'LogSet', kg, reps, count, exerciseId } });
  return out('LogSet', { kg, reps, count, exerciseId });
}
