// The user's profile: who they are and what they train for. Asked once at the start, editable in
// Settings, and given to the Coach so plans and answers fit. Pure.

export const SEXES = ['male', 'female', 'other'];
export const LEVELS = ['new', 'some', 'experienced'];           // <1 y, 1–3 y, 3+ y
export const GOALS = ['muscle', 'strength', 'fatloss', 'fitness', 'endurance'];
export const EQUIPMENT = ['gym', 'dumbbells', 'homebar', 'bodyweight'];
export const INJURIES = ['shoulder', 'elbow', 'wrist', 'lowerback', 'hip', 'knee', 'neck'];
export const MINUTES = [30, 45, 60, 75, 90];
export const CARDIO = ['none', 'some', 'lots'];                // 0, 1–2, 3+ sessions a week

const pick = (v, list) => (list.includes(v) ? v : null);
const int = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : null);

export function sanitizeProfile(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return null;
  const year = new Date(now).getFullYear();
  const out = {
    name: typeof p.name === 'string' ? p.name.trim().replace(/\s+/g, ' ').slice(0, 30) : '',
    birthYear: int(p.birthYear, year - 100, year - 10),
    sex: pick(p.sex, SEXES),
    heightCm: int(p.heightCm, 120, 230),
    level: pick(p.level, LEVELS),
    goal: pick(p.goal, GOALS),
    days: int(p.days, 1, 7),
    minutes: MINUTES.includes(p.minutes) ? p.minutes : null,
    equipment: pick(p.equipment, EQUIPMENT),
    injuries: Array.isArray(p.injuries) ? [...new Set(p.injuries.filter(x => INJURIES.includes(x)))] : [],
    notes: typeof p.notes === 'string' ? p.notes.trim().slice(0, 200) : '',
    cardio: pick(p.cardio, CARDIO),
    at: Number.isFinite(p.at) ? p.at : now
  };
  return out;
}

export const ageOf = (p, now = Date.now()) => (p?.birthYear ? new Date(now).getFullYear() - p.birthYear : null);

// Settings that follow from the answers.
export function derivedSettings(p) {
  const out = {};
  if (p.days) out.weeklyGoal = Math.min(7, Math.max(1, p.days));
  if (p.goal) out.proteinPerKg = { fatloss: 2.2, muscle: 1.8, strength: 1.8, fitness: 1.6, endurance: 1.6 }[p.goal];
  if (p.cardio) out.cardioGoal = { none: 60, some: 150, lots: 240 }[p.cardio];
  return out;
}

// A starter program for someone without a Gemini key.
export function programFor(p) {
  if (p.days >= 5 || p.days === 3 && p.goal === 'muscle' && p.level !== 'new') return 'ppl';
  if (p.days === 4) return 'ul';
  return 'fb3';
}

// One paragraph for the Coach's context.
export function profileText(p, now = Date.now()) {
  if (!p) return 'PROFILE: not filled in.';
  const age = ageOf(p, now);
  const bits = [
    p.name && `name ${p.name}`,
    age && `${age} years old`,
    p.sex && p.sex !== 'other' && p.sex,
    p.heightCm && `${p.heightCm} cm tall`,
    p.level && { new: 'training under a year', some: 'training 1-3 years', experienced: 'training 3+ years' }[p.level],
    p.goal && `main goal: ${{ muscle: 'build muscle', strength: 'get stronger', fatloss: 'lose fat while keeping muscle', fitness: 'general fitness', endurance: 'endurance' }[p.goal]}`,
    p.days && `trains ${p.days} days a week`,
    p.minutes && `${p.minutes}-minute sessions`,
    p.equipment && `equipment: ${{ gym: 'full gym', dumbbells: 'dumbbells at home', homebar: 'barbell and rack at home', bodyweight: 'bodyweight only' }[p.equipment]}`,
    p.injuries?.length && `take care with: ${p.injuries.join(', ')}`,
    p.cardio && `cardio: ${{ none: 'little', some: '1-2 sessions a week', lots: '3+ sessions a week' }[p.cardio]}`,
    p.notes && `notes: ${p.notes}`
  ].filter(Boolean);
  return `PROFILE: ${bits.join('; ')}.`;
}

// The request that asks the Coach to build a plan from the profile.
export function planRequest(p, lang = 'en') {
  const goal = { muscle: 'build muscle', strength: 'get stronger', fatloss: 'lose fat and keep muscle', fitness: 'general fitness', endurance: 'endurance' }[p.goal] || 'build muscle';
  const eq = { gym: 'a full gym', dumbbells: 'dumbbells only', homebar: 'a barbell, rack and bench', bodyweight: 'bodyweight only' }[p.equipment] || 'a full gym';
  if (lang === 'da') {
    const goalDa = { muscle: 'bygge muskler', strength: 'blive stærkere', fatloss: 'tabe fedt og beholde muskler', fitness: 'generel form', endurance: 'udholdenhed' }[p.goal] || 'bygge muskler';
    return `Lav en ${p.days || 3}-dages træningsplan til mig, ${p.minutes || 60} minutter pr. træning, mål: ${goalDa}, udstyr: ${eq}${p.injuries?.length ? `, pas på: ${p.injuries.join(', ')}` : ''}.`;
  }
  return `Make me a ${p.days || 3}-day training plan, ${p.minutes || 60} minutes per session, goal: ${goal}, equipment: ${eq}${p.injuries?.length ? `, avoid aggravating: ${p.injuries.join(', ')}` : ''}.`;
}
