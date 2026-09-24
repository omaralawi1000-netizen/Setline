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
    notes: typeof p.notes === 'string' ? p.notes.trim().slice(0, 600) : '',
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

// ---------- "Tell me about yourself": free talk → profile fields ----------

export const PROFILE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', nullable: true },
    age: { type: 'INTEGER', nullable: true },
    sex: { type: 'STRING', enum: SEXES, nullable: true },
    heightCm: { type: 'INTEGER', nullable: true },
    weightKg: { type: 'NUMBER', nullable: true },
    level: { type: 'STRING', enum: LEVELS, nullable: true, description: 'new: under a year of training; some: 1-3 years; experienced: 3+ years' },
    goal: { type: 'STRING', enum: GOALS, nullable: true },
    days: { type: 'INTEGER', nullable: true, description: 'strength training days per week' },
    minutes: { type: 'INTEGER', nullable: true, description: 'minutes per session' },
    equipment: { type: 'STRING', enum: EQUIPMENT, nullable: true, description: 'gym: full gym; dumbbells: dumbbells at home; homebar: barbell and rack at home; bodyweight: none' },
    injuries: { type: 'ARRAY', items: { type: 'STRING', enum: INJURIES } },
    cardio: { type: 'STRING', enum: CARDIO, nullable: true, description: 'none: rarely; some: 1-2 sessions a week; lots: 3+' },
    notes: { type: 'STRING', description: 'everything else useful for a coach, in short phrases: preferences, favourite or disliked exercises, schedule, sports, targets, history. Empty if nothing.' }
  },
  required: ['injuries', 'notes']
};


// Merge what the model heard into the onboarding answers. Returns the ids of the questions it answered.
export function mergeHeard(a, raw) {
  const got = new Set();
  if (!raw || typeof raw !== 'object') return got;
  const set = (k, v) => { a[k] = v; got.add(k); };
  if (typeof raw.name === 'string' && raw.name.trim()) set('name', raw.name.trim().slice(0, 30));
  if (Number.isFinite(raw.age) && raw.age >= 13 && raw.age <= 90) { set('age', Math.round(raw.age)); a.ageSaid = true; }
  if (SEXES.includes(raw.sex)) set('sex', raw.sex);
  if (Number.isFinite(raw.heightCm) && raw.heightCm >= 140 && raw.heightCm <= 220) { set('height', Math.round(raw.heightCm)); a.heightSaid = true; }
  if (Number.isFinite(raw.weightKg) && raw.weightKg >= 35 && raw.weightKg <= 200) { set('weight', Math.round(raw.weightKg * 2) / 2); a.weightTouched = true; }
  if (LEVELS.includes(raw.level)) set('level', raw.level);
  if (GOALS.includes(raw.goal)) set('goal', raw.goal);
  if (Number.isFinite(raw.days) && raw.days >= 1 && raw.days <= 7) set('days', Math.round(raw.days));
  if (Number.isFinite(raw.minutes) && raw.minutes >= 15 && raw.minutes <= 180) set('minutes', MINUTES.reduce((b, m) => (Math.abs(m - raw.minutes) < Math.abs(b - raw.minutes) ? m : b)));
  if (EQUIPMENT.includes(raw.equipment)) set('equipment', raw.equipment);
  if (Array.isArray(raw.injuries) && raw.injuries.some(x => INJURIES.includes(x))) set('injuries', [...new Set(raw.injuries.filter(x => INJURIES.includes(x)))]);
  if (CARDIO.includes(raw.cardio)) set('cardio', raw.cardio);
  if (typeof raw.notes === 'string' && raw.notes.trim()) { a.notes = raw.notes.trim().slice(0, 600); got.add('notes'); }
  return got;
}

// ---------- the getting-to-know-you conversation ----------

export const INTERVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...PROFILE_SCHEMA.properties,
    notes: { type: 'STRING', description: 'everything else useful for a coach from the WHOLE conversation so far, in short phrases (preferences, favourite or disliked exercises, schedule, sports, targets, history). Empty if nothing.' },
    answered: { type: 'ARRAY', items: { type: 'STRING', enum: ['injuries', 'age', 'body', 'cardio'] }, description: 'topics the user has answered so far, even when the answer was "none" or "rather not say"' },
    reply: { type: 'STRING', description: 'what you say next, spoken aloud' },
    done: { type: 'BOOLEAN' }
  },
  required: ['injuries', 'notes', 'answered', 'reply', 'done']
};

// What the Coach still wants to know, most important first.
export function missingTopics(a) {
  const out = [];
  if (!a.name) out.push('their name');
  if (!a.goal) out.push('their main goal');
  if (!a.level) out.push('how long they have trained');
  if (!a.days) out.push('how many days a week they can train');
  if (!a.minutes) out.push('how long a session can be');
  if (!a.equipment) out.push('where they train / what equipment');
  if (!a.asked?.injuries && !a.injuries?.length) out.push('injuries or pain');
  if (!a.asked?.age && !a.age) out.push('age');
  if (!a.asked?.body) out.push('height and weight');
  if (!a.cardio) out.push('cardio they do');
  return out;
}

export const interviewSystem = lang => [
  'You are the user\'s new strength coach getting to know them in a relaxed voice chat, like a friend: warm, casual, curious, never a form.',
  `Speak ${lang === 'da' ? 'Danish' : 'English'}. Your reply is read aloud: plain words, no lists or emoji, at most two short sentences.`,
  'React briefly and genuinely to what they just said (a few words), then ask ONE question, or two that belong together (height and weight).',
  'Never ask again what you already know. If they give a vague answer, you may ask one natural follow-up.',
  'Also fill the profile fields from everything said so far (null when unknown; convert units; "a couple of years" → some).',
  'Set done=true when STILL TO LEARN is empty or they want to stop, and then reply with a short, warm wrap-up that says you\'ll use this for their plan (no question).'
].join(' ');

export function interviewPrompt(a, msgs) {
  const known = {
    name: a.name || null, age: a.ageSaid ? a.age : null, sex: a.sex, heightCm: a.heightSaid ? a.height : null, weightKg: a.weightTouched ? a.weight : null,
    level: a.level, goal: a.goal, days: a.days, minutes: a.minutes, equipment: a.equipment, injuries: a.injuries, cardio: a.cardio, notes: a.notes || ''
  };
  const talk = msgs.map(m => `${m.who === 'ai' ? 'COACH' : 'USER'}: ${m.text}`).join('\n');
  return `KNOWN SO FAR: ${JSON.stringify(known)}\nSTILL TO LEARN: ${missingTopics(a).join(', ') || 'nothing, wrap up'}\n\nCONVERSATION:\n${talk}`;
}

export const firstQuestion = lang => (lang === 'da'
  ? 'Hej! Jeg er din nye coach. Hvad skal jeg kalde dig, og hvad træner du efter lige nu?'
  : 'Hey! I\'m your new coach. What should I call you, and what are you training for right now?');
