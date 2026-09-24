// Coach: the system prompt, a compact context summary built locally (not raw history),
// question detection, and a tiny safe formatter for answers. Pure.
import { volume, counts, elapsedSec } from './workout.js';
import { e1rm, bestsFrom } from './pr.js';
import { weekStart, weekStreak } from './stats.js';
import { cardioName, paceText, cardioMinutes } from './cardio.js';
import { bodyTrend, proteinTarget, dateKey } from './body.js';
import { autoTargets, targetsFor, dayTotals } from './nutrition.js';
import { sleepTrend } from './checkin.js';
import { profileText } from './profile.js';
import { deloadStatus, muscleBalance, usualMinutes } from './insights.js';
import { measureSummary } from './measures.js';
import { nextRoutine, routineDay } from './routines.js';
import { stalledLifts } from './plateau.js';
import { EQUIPMENT, MUSCLES, makeCustom, normalize } from './catalog.js';

export const MAX_CONTEXT_CHARS = 22000; // ~6k tokens
export const CHAT_TURNS = 12;

export function systemPrompt(lang) {
  return [
    'You are an experienced strength coach inside a workout logging app.',
    `Answer in ${lang === 'da' ? 'Danish' : 'English'} unless the user writes in the other language; then answer in theirs.`,
    'Answers are often spoken aloud: be voice-friendly, three sentences or fewer unless the user asks for detail. No tables, no headings.',
    'Use only the training data provided below. If the data needed is missing, say so plainly instead of guessing.',
    'If there is a COACH BRIEF, it is the user\'s own description of who they are, what they want and how to coach them: follow it in every answer. Newer logged data and MEMORIES win over it where they differ.',
    'Coach like a sharp, honest human coach who knows this person: judge trends (bodyweight over weeks, each lift over sessions, weekly volume), never a single workout or weigh-in.',
    'Be proactive: when the data shows a problem that matters for their goal (a stalled lift, weight dropping too fast or not at all, protein short, sessions missed, recovery or sleep suffering, other sports adding fatigue, junk volume), say it briefly with one concrete fix, even if they didn\'t ask.',
    'Do not just agree. If something they do or propose works against their goal, say so and give the better option.',
    'Never invent numbers (calorie or macro targets, maxes, weights): use the targets and data shown, or say what is missing and how to add it in the app.',
    'Refer to their own routines, exercises and recent numbers by name when you advise; be specific (sets, reps, kg, grams, days).',
    'Weights are in kg in the data; answer in the user\'s unit.',
    'For pain or injury, give general guidance only and suggest seeing a physiotherapist or doctor.',
    'Use the PROFILE (age, goal, experience, days, equipment, injuries) to tailor every answer. "Planned" sets are what the plan says for the workout in progress.',
    'You can see the data but cannot change it yourself: when something should be logged or changed, say exactly what to tap or say.',
    'MEMORY: when the user tells you something lasting about themselves (a preference, dislike, injury or pain, schedule, event or deadline, equipment, sport, how they like to train), add at the very end of your reply one line per new fact: "REMEMBER: <the fact in a few words>" (at most two, only facts not already in MEMORIES). The app saves these and hides the line; never mention it. Use MEMORIES in every answer.',
    'The user is already talking to you in the Coach. Never tell them to go to the Coach tab. When they want a training plan, the app builds it from their request automatically; if a request reaches you anyway, say you will build it when they ask for it, e.g. "make me a 5-day plan".',
    APP_GUIDE
  ].join(' ');
}

// What the app can do and where, so the Coach can explain it.
export const APP_GUIDE = [
  'APP GUIDE (Setline, a voice-first gym app).',
  'The orb next to the bottom bar is the Coach: tap it to open this chat (everything said stays here to read), hold it to give a quick voice command from anywhere (pull up while holding for the full voice screen). Tabs: Today, Train, Food.',
  'Things to say during a workout: "one more rep on tricep pushdowns" or "2 kg more on leg press" (relative to that lift\'s plan), "80 kilo 8", "same again", "I got 9 reps", "2 kg more" or "one rep more" (relative to the planned set), "as planned", "4 plates", "9, 8 and 8 at 100", "next exercise", "skip rest", "add 30 seconds", "swap to incline press", "undo", "finish".',
  'A whole session at once: "bench 3x8 at 80, then rows 3x10 at 60, then lateral raises 3 by 15 with 10" logs every lift and set (it starts a workout if none is running). Sets can be said in any word order.',
  'Paste a routine into the Coach ("this is my routine: …") and it becomes your routines with your weights (Replace or Add). Settings → What your coach knows holds the COACH BRIEF (paste who you are and how to be coached) and MEMORIES. The Coach keeps MEMORIES and writes a weekly check-in every Monday (shown on Today until read).',
  'Other voice: "start push day", "30 minutes zone 2 on the bike", "slept 7 hours, legs sore", "I ate 3 eggs and toast", "30 g protein", "I weigh 82", "what should I lift?", or any question for you.',
  'Headphones button on the workout screen: hands-free mode listens for sets and speaks rest cues.',
  'Workout screen: steppers and Log set, rest timer (+15/-15 teaches that exercise its rest), warm-up ramp, plate calculator, swipe a set left to delete, tap a set to edit, auto-advance after the last planned set, Finish.',
  'Routines can belong to a weekday (a weekday in the name, or the day chips in the routine editor): Up next picks today\'s routine, and "Your week" (Workout tab and Today) shows the week. After each workout the Coach writes a short debrief with targets for next time. The Coach composer has its own small orb: tap it to dictate. A rest bell with 3-2-1 ticks rings when rest ends (Settings → Workout). Food targets: calories and macros move together.',
  'The orb understands food too: "2 eggs and toast", "for lunch chicken and rice", "two glasses of water", "set my calories to 2400" are logged or set at once with Undo (foods on the built-in Danish list are counted exactly, others estimated). Typing a clear command in this chat does it too. In the Coach, the small orb in the message box starts a spoken conversation: it sends when you pause, the answer is spoken and it listens again. Food: "Same breakfast as yesterday" rows, and a bookmark on a meal group saves it as a one-tap Saved meal. With Rest alerts on, the rest timer counts down on the lock screen.',
  'Navigation: History is the clock button on the Workout tab (and Last session on Today).',
  'Workout: smart warm-ups are added before the first lift for each muscle (Settings → Workout → Smart warm-ups), spoken in hands-free; say "warm up" to add them, "warm-up done" to tick one off. Today: one-tap morning check-in (how you feel, sleep, sore spots → readiness), Up next routine, cardio start and "again" chip, week ring and cardio minutes, muscles this week, deload suggestion after 6 steady weeks, a Plateau card when a planned lift stalls (one tap switches its rep range or swaps it for a close variation in every routine, with undo), bodyweight, a Food card (calories left, protein) that opens the Food tab. Food tab: calorie ring and protein/carbs/fat against daily targets (from the profile, editable by tapping the ring), Scan barcode / Photo / Say it / Search (a built-in list of ~250 common Danish foods with typical values, plus Danish products from Open Food Facts while online; tap one to pick the amount; anything not found can be estimated by AI), favourite meals, quick add buttons (calories or protein, your own amounts), water glasses, meals by breakfast/lunch/dinner/snacks (tap to move, log again, favourite, delete), a 7-day chart.',
  'Plans: asking for one in plain words here ("I need a 5-day plan", "make my plan 4 days") builds a plan card right away, with Replace my routines or Add.',
  'History: every workout and cardio session, "Do this again". Progress: volume, cardio, bodyweight, sleep, muscles, lifts with e1RM curves and records. Body & photos: measurements, progress photos (on the phone only), before/after compare.',
  'Customize (Today and Food): show/hide and reorder sections; Food can track calories or only protein, carbs, fat, water. Tap a meal → Edit to fix an estimate or scale the portion. Daily targets shows the real maintenance worked out from 2+ weeks of food and weight. Settings → Workout → Weight steps sets the −/+ step for barbells, dumbbells and machines.',
  'Settings: profile (edit answers), voice and replies, API keys, Google Drive backup, export/import, units, rest default, auto-advance.'
].join(' ');

const r1 = n => Math.round(n * 10) / 10;
const d = (ts) => new Date(ts).toISOString().slice(0, 10);
const setsTxt = sets => {
  const out = [];
  for (const s of sets) {
    const last = out[out.length - 1];
    if (last && last.kg === s.kg && last.reps === s.reps) last.n++; else out.push({ kg: s.kg, reps: s.reps, n: 1 });
  }
  return out.map(g => `${g.n > 1 ? `${g.n}x ` : ''}${r1(g.kg)}x${g.reps}`).join(', ');
};

// Build the summary the Coach sees. snap = {active, history, routines, prs, bodyweight, catalog, settings, now}
export function buildContext(snap) {
  const { catalog, settings } = snap;
  const now = snap.now ?? Date.now();
  const name = id => catalog.name(id, 'en');
  const hist = [...snap.history].sort((a, b) => b.startedAt - a.startedAt);
  const out = [];
  out.push(`Today: ${d(now)}. User's unit: ${settings.unit}. Default rest ${settings.restSec} s. Weekly goal ${settings.weeklyGoal ?? 3} workouts.`);
  out.push(`Logged workouts: ${hist.length}${hist.length ? `, first ${d(hist[hist.length - 1].startedAt)}, latest ${d(hist[0].startedAt)}` : ''}.`);

  out.unshift(profileText(settings.profile, now));
  const mem = (settings.memories || []).map(m => m.text);
  if (mem.length) out.splice(1, 0, `MEMORIES (what the user told you before): ${mem.join('; ')}.`);
  const brief = String(settings.coachBrief || '').trim();
  if (brief) out.splice(1, 0, `COACH BRIEF (the user's own words):\n${brief}\n(end of brief)`);
  const w = snap.active;
  if (w) {
    const restLeft = w.rest ? Math.max(0, Math.round((w.rest.endsAt - now) / 1000)) : 0;
    const flags = [w.deload && 'deload session (lighter)', w.easy && 'easy day', w.readiness && `readiness ${w.readiness}/5`, restLeft && `resting, ${restLeft} s left`].filter(Boolean);
    out.push('', `CURRENT WORKOUT "${w.name || 'untitled'}" (${Math.round(elapsedSec(w, now) / 60)} min in${flags.length ? `; ${flags.join('; ')}` : ''}):`);
    w.exercises.forEach((ex, i) => {
      const sets = ex.sets.filter(x => x.type !== 'warmup').map((x, k) => `${k + 1}: ${x.done ? `done ${r1(x.kg)}x${x.reps}` : `planned ${x.kg != null ? r1(x.kg) : '?'}x${x.reps ?? '?'}`}`);
      const sg = ex.suggestion ? ` (plan reason: ${ex.suggestion.reason})` : '';
      out.push(`- ${i === w.current ? '[NOW] ' : ''}${name(ex.exerciseId)}${sg}: ${sets.join(', ') || 'no sets'}`);
    });
    const cur = w.exercises[w.current];
    if (cur) {
      const next = cur.sets.find(x => !x.done && x.type !== 'warmup');
      out.push(next ? `Next set: ${name(cur.exerciseId)} ${next.kg != null ? r1(next.kg) : '?'}x${next.reps ?? '?'}.` : `All planned sets of ${name(cur.exerciseId)} are done.`);
    }
  } else out.push('', 'No workout running.');
  const up = nextRoutine(snap.routines || [], hist);
  if (up && !w) out.push(`UP NEXT: ${up.name}.`);

  // per exercise, most recently trained first
  const seen = new Map();
  for (const x of hist) for (const ex of x.exercises) {
    if (!ex.sets.some(counts)) continue;
    if (!seen.has(ex.exerciseId)) seen.set(ex.exerciseId, []);
    seen.get(ex.exerciseId).push({ t: x.startedAt, sets: ex.sets.filter(counts) });
  }
  if (seen.size) {
    out.push('', 'EXERCISES (best e1RM, trend over up to 8 sessions, last 3 sessions):');
    for (const [id, sessions] of [...seen].slice(0, 30)) {
      const b = bestsFrom(snap.prs || [], id);
      const trend = sessions.slice(0, 8).map(s => Math.max(...s.sets.map(x => e1rm(x.kg, x.reps)))).reverse();
      const last3 = sessions.slice(0, 3).map(s => `${d(s.t)}: ${setsTxt(s.sets)}`).join(' | ');
      const best = b.e1rm ? `best ${r1(b.e1rm.kg)}x${b.e1rm.reps} (e1RM ${r1(b.e1rm.value)})` : 'no record yet';
      const heavy = b.weight ? `, heaviest ${r1(b.weight.kg)}` : '';
      out.push(`- ${name(id)}: ${best}${heavy}; e1RM trend ${trend.map(r1).join(' > ')}; ${last3}`);
    }
  }

  // weekly volume, 8 weeks
  const start = weekStart(now);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const from = start - i * 7 * 86_400_000, to = from + 7 * 86_400_000;
    const ws = hist.filter(x => x.startedAt >= from && x.startedAt < to);
    weeks.push(`${d(from)}: ${ws.length} sessions, ${Math.round(ws.reduce((a, x) => a + volume(x), 0))} kg`);
  }
  out.push('', 'WEEKLY VOLUME (week starting):', ...weeks.map(x => `- ${x}`));

  if (snap.routines?.length) {
    out.push('', 'ROUTINES:');
    for (const r of snap.routines) out.push(`- ${r.name}${routineDay(r) != null && !/day|dag/i.test(r.name) ? ` (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][routineDay(r)]})` : ''}: ${r.exercises.map(e => `${name(e.exerciseId)} ${e.sets.length}x${e.sets[0]?.reps ?? '?'}${e.sets[0]?.kg ? ` @ ${r1(e.sets[0].kg)} kg` : ''}`).join(', ')}`);
  }
  const stalls = snap.routines?.length && snap.catalog ? stalledLifts(hist, snap.routines, { catalog: snap.catalog, now }) : [];
  if (stalls.length) out.push('', 'STALLED LIFTS (no new e1RM in the last 3 sessions over 2+ weeks):', ...stalls.map(x => `- ${name(x.exerciseId)}: best e1RM ${x.best} kg, planned ${x.sets}x${x.reps}${x.swapTo ? `, variation: ${name(x.swapTo)}` : ''}`));

  // cardio: weekly minutes and recent sessions
  const cardio = [...(snap.cardio || [])].sort((a, b) => b.startedAt - a.startedAt);
  if (cardio.length) {
    out.push('', `CARDIO (goal ${settings.cardioGoal ?? 150} min/week):`);
    for (let i = 7; i >= 0; i--) {
      const from = start - i * 7 * 86_400_000;
      const c = cardioMinutes(cardio, from, from + 7 * 86_400_000);
      out.push(`- week of ${d(from)}: ${c.sessions} sessions, ${c.minutes} min (${c.zone2} easy), ${c.km} km`);
    }
    out.push('Recent sessions:');
    for (const c of cardio.slice(0, 12)) {
      out.push(`- ${d(c.startedAt)} ${cardioName(c.type, 'en')}: ${Math.round(c.durationSec / 60)} min${c.distanceKm ? `, ${r1(c.distanceKm)} km, ${paceText(c, 'en')}` : ''}${c.zone ? `, zone ${c.zone}` : ''}`);
    }
  } else out.push('', 'CARDIO: none logged.');
  if (snap.activeCardio) out.push(`Cardio running now: ${cardioName(snap.activeCardio.type, 'en')}.`);

  const st = weekStreak(snap.history, cardio, settings.weeklyGoal ?? 3, now);
  out.push('', `STREAK: ${st.streak} weeks meeting the goal; this week ${st.thisWeek} of ${st.goal}.`);

  const bw = [...(snap.bodyweight || [])].sort((a, b) => a.date.localeCompare(b.date));
  out.push('', bw.length ? `BODYWEIGHT: ${bw.slice(-8).map(b => `${b.date} ${r1(b.kg)}`).join(', ')}` : 'BODYWEIGHT: no data logged.');
  const tr = bodyTrend(bw);
  const target = tr ? proteinTarget(tr.latest.kg, settings.proteinPerKg) : null;
  const protein = (snap.nutrition || []).find(n => n.date === dateKey(now))?.protein || 0;
  out.push(`PROTEIN today: ${protein} g${target ? ` of a ${target} g target` : ' (no target without bodyweight)'}.`);
  const ft = targetsFor(autoTargets({ profile: settings.profile, bodyweightKg: tr?.latest.kg, proteinPerKg: settings.proteinPerKg, now }), settings.foodTargets);
  const ftot = dayTotals((snap.nutrition || []).find(n => n.date === dateKey(now)));
  out.push(`FOOD today: ${ftot.kcal} of ${ft.kcal} kcal, protein ${ftot.protein}/${ft.protein} g, carbs ${ftot.carbs}/${ft.carbs} g, fat ${ftot.fat}/${ft.fat} g, water ${ftot.water}/${ft.water} ml (targets ${settings.foodTargets ? 'set by the user' : 'worked out from the profile'}).`);
  const ci = (snap.daily || []).find(d => d.date === dateKey(now));
  if (ci) out.push(`CHECK-IN today: ${ci.sleepH != null ? `${ci.sleepH} h sleep` : 'sleep not given'}, ${ci.energy != null ? `energy ${ci.energy}/5` : 'energy not given'}, sore: ${ci.sore?.length ? ci.sore.join(', ') : 'nothing'}.`);
  const sl = sleepTrend(snap.daily || [], 7);
  if (sl) out.push(`SLEEP last ${sl.series.length} check-ins: ${sl.avg} h average.`);
  // training state the app works out
  if (settings.deloadUntil && now < settings.deloadUntil) out.push(`DELOAD week running until ${d(settings.deloadUntil)}.`);
  else { const dl = deloadStatus(hist, settings, now); if (dl?.state === 'due') out.push(`DELOAD suggested: ${dl.weeks} steady weeks.`); }
  const bal = muscleBalance(hist, catalog, now);
  if (bal.total) out.push(`MUSCLES THIS WEEK (working sets/target): ${bal.rows.map(r => `${r.group} ${r.sets}/${r.target}`).join(', ')}${bal.behind ? `; behind: ${bal.behind.group}` : ''}.`);
  const usual = usualMinutes(hist, w?.routineId || null, null);
  if (usual) out.push(`USUAL SESSION LENGTH: about ${usual.min} min.`);
  const ms = measureSummary(snap.measures || []).filter(m => m.latest != null);
  if (ms.length) out.push(`MEASUREMENTS (cm, latest and change since first): ${ms.map(m => `${m.site} ${m.latest}${m.change ? ` (${m.change > 0 ? '+' : ''}${m.change})` : ''}`).join(', ')}.`);
  if (snap.photoCount) out.push(`PROGRESS PHOTOS: ${snap.photoCount} saved on the phone (you can't see them; suggest the Compare view in Body & photos).`);
  if (snap.goals?.length) out.push(...snap.goals);
  const day = (snap.nutrition || []).find(n => n.date === dateKey(now));
  if (day?.meals?.length) out.push(`MEALS today (estimates): ${day.meals.map(m => `${m.name} ${m.protein} g protein ${m.kcal} kcal`).join('; ')}. Total ${day.kcal || 0} kcal.`);
  if (w?.readiness) out.push(`Readiness today: ${w.readiness}/5${w.easy ? ', easy day chosen' : ''}.`);

  let text = out.join('\n');
  if (text.length > MAX_CONTEXT_CHARS) text = text.slice(0, MAX_CONTEXT_CHARS) + '\n[summary truncated]';
  return text;
}

// Chat history → Gemini contents, with the context attached to the newest user turn.
export function chatContents(chat, context, question) {
  const turns = chat.slice(-CHAT_TURNS).filter(m => m.text && (m.role === 'user' || m.role === 'model'));
  const contents = turns.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: 'user', parts: [{ text: `Training data:\n${context}\n\nQuestion: ${question}` }] });
  // the API wants turns to start with the user
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

const Q_START = /^(how|what|why|when|which|who|should|could|would|can|is|are|do|does|did|am|will|tell me|explain|give me|any tips|hvordan|hvad|hvorfor|hvornår|hvilken|hvilke|hvem|skal|kan|bør|er|var|har|vil|gør|fortæl|forklar|giv mig)\b/i;
// A question for the Coach rather than a command.
export function isQuestion(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return /\?\s*$/.test(s) || Q_START.test(s);
}

// Minimal, safe formatting for answers: escape, **bold**, line breaks, "- " bullets.
// Talk mode: a lone word like "Sink." is usually the mic catching a noise (or the speech model
// guessing at one), not something said to the coach. Real short answers still count.
const SHORT_REPLIES = /^(yes|yeah|yep|no|nope|ok|okay|sure|thanks|stop|done|next|more|why|how|hi|hello|hey|ja|nej|jo|tak|færdig|næste|mere|hvorfor|hvordan|hej)$/i;
export function isNoise(text) {
  const words = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (words.length > 1) return false;
  return !SHORT_REPLIES.test(words[0]) && !/\d/.test(words[0]);
}

export function formatAnswer(text) {
  const esc = String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = esc.split('\n');
  let html = '', list = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(\S.*?)\*/g, '$1<i>$2</i>');
    const bullet = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) { if (!list) { html += '<ul>'; list = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  if (list) html += '</ul>';
  return html;
}

// Plain text for speaking: no markup, no bullets.
export const speakable = text => String(text || '').replace(/\*\*?|__|#+\s/g, '').replace(/^\s*(?:[-*•]|\d+\.)\s+/gm, '').replace(/\n+/g, ' ').trim();

// ---------- plan builder ----------

const PLAN_WORDS = /\b(plan|program|programme|split|routine|routines|schedule|rutine|rutiner|træningsplan|program)\b/i;
const MAKE_WORDS = /\b(make|build|create|design|give me|write|set up|lav|byg|opret|giv mig|skriv|sammensæt)\b/i;
const SPLIT_WORDS = /(\b\d\s?-?\s?(day|days|dages|dag)\b|upper\s?\/?\s?lower|push\s?\/?\s?pull|\bppl\b|full[\s-]?body|hele kroppen|overkrop|(times|days|x) (a|per) week|dage om ugen|gange om ugen)/i;
const WANT_WORDS = /\b(need|want|would like|i'?d like|can you|could you|new|another|different|better|change|update|redo|rewrite|adjust|jeg vil have|jeg vil gerne have|jeg har brug for|kan du|ny|nyt|anden|andet|ændr|opdater)\b/i;
const NUM_DAYS = /\b(one|two|three|four|five|six|seven|en|to|tre|fire|fem|seks|syv|\d)[\s-]?(day|days|dages|dags|dag)\b/i;
export const isPlanRequest = text => (MAKE_WORDS.test(text) || WANT_WORDS.test(text) || NUM_DAYS.test(text)) && (PLAN_WORDS.test(text) || SPLIT_WORDS.test(text) || NUM_DAYS.test(text) && /\b(plan|program|split|week|uge|ugen)\b/i.test(text));

// The plan schema with the exercise names fixed to the catalog: the model can't invent a name we can't use.
export function planSchema(catalog) {
  const sch = structuredClone(PLAN_SCHEMA);
  sch.properties.days.items.properties.exercises.items.properties.exercise.enum = [...new Set(catalog.all.map(e => e.en))];
  return sch;
}

export const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'short plan name' },
    perWeek: { type: 'INTEGER' },
    summary: { type: 'STRING', description: 'two sentences max, in the user\'s language' },
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          exercises: { type: 'ARRAY', items: { type: 'OBJECT', properties: { exercise: { type: 'STRING' }, sets: { type: 'INTEGER' }, reps: { type: 'INTEGER' } }, required: ['exercise', 'sets', 'reps'] } }
        },
        required: ['name', 'exercises']
      }
    }
  },
  required: ['name', 'days', 'summary']
};

export function planSystem(lang, catalog) {
  return [
    'You are an experienced strength coach building a training plan as structured data.',
    `Write names and the summary in ${lang === 'da' ? 'Danish' : 'English'}.`,
    'Use only exercises from this catalog, spelled exactly as listed:',
    catalog.all.map(e => `${e.en} (${e.equipment})`).join(', ') + '.',
    'Respect the requested days per week, session length (about 3.5 minutes per set including rest), focus and available equipment.',
    'Each day 3 to 9 exercises, 2 to 5 sets, 5 to 20 reps. Base it on the training data and the PROFILE when given: goal, experience, injuries (avoid exercises that load them), equipment and notes.',
    'For fat loss keep the heavy compound lifts and mention cardio in the summary. Name days clearly (e.g. "Push", "Legs A").'
  ].join(' ');
}

// Strictly check the model's plan against the catalog and limits. Returns null if unusable.
export function validatePlan(raw, catalog) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days) || !raw.days.length) return null;
  const one = n => catalog.findExact(n) || (catalog.rank?.(n)?.[0]?.s >= 50 ? catalog.rank(n)[0].e : null);
  const find = n => one(n) || one(n.replace(/s\b/gi, '')) || null; // "Lat pulldowns" → "Lat pulldown"
  const days = [];
  for (const d of raw.days.slice(0, 7)) {
    if (!d || !Array.isArray(d.exercises)) continue;
    const exercises = [];
    for (const x of d.exercises.slice(0, 12)) {
      const name = String(x?.exercise || '').trim();
      const e = name ? find(name) : null;
      if (!e || exercises.some(y => y.exerciseId === e.id)) continue;
      const sets = Math.max(1, Math.min(6, Math.round(Number(x?.sets) || 3)));
      const reps = Math.max(1, Math.min(30, Math.round(Number(x?.reps) || 10)));
      exercises.push({ exerciseId: e.id, sets, reps });
    }
    if (exercises.length) days.push({ name: String(d.name || '').trim().slice(0, 30) || `Day ${days.length + 1}`, exercises: exercises.slice(0, 10) });
  }
  if (!days.length) return null; // a day we can't use is skipped; only an empty plan fails
  return {
    name: String(raw.name || '').trim().slice(0, 30) || 'Plan',
    perWeek: Number.isInteger(raw.perWeek) ? Math.max(1, Math.min(7, raw.perWeek)) : days.length,
    summary: String(raw.summary || '').trim().slice(0, 400),
    days
  };
}

// ---------- your own routine, pasted or said: copied as it is, not redesigned ----------

const SETS_LINE = /\b\d+\s*(?:sets?|sæt)\b|\b\d+\s*[x×]\s*\d+/i;
export const isRoutineImport = text => {
  const t = String(text || '');
  const lines = t.split(/\n/).filter(l => SETS_LINE.test(l)).length;
  const mine = /\b(?:this is|here is|here's|heres|these are|that's|thats|use|save|set up|dette er|her er|brug|gem)\b.{0,20}\b(?:my|min|mit|mine)\s+(?:current\s+|nuværende\s+)?(?:routines?|split|program|workouts?|training|rutiner?|træningsprogram|træning)\b/i.test(t);
  return lines >= 3 || (mine && (lines >= 1 || t.length > 120));
};

export const IMPORT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'short name for the whole split' },
    summary: { type: 'STRING', description: 'one or two sentences in the user\'s language: what was set up, and anything left out or guessed that they should fill in' },
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'the day as the user named it, with the weekday if given, e.g. "Monday: Legs + Shoulders"' },
          exercises: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                exercise: { type: 'STRING', description: 'the catalog name when it is the same movement and equipment, otherwise the user\'s own short name' },
                inCatalog: { type: 'BOOLEAN' },
                equipment: { type: 'STRING', enum: EQUIPMENT },
                muscle: { type: 'STRING', enum: MUSCLES, description: 'main muscle' },
                sets: { type: 'INTEGER' },
                reps: { type: 'INTEGER', description: '0 if not given' },
                kg: { type: 'NUMBER', description: 'the weight as written, 0 if not given' }
              },
              required: ['exercise', 'inCatalog', 'equipment', 'muscle', 'sets', 'reps', 'kg']
            }
          }
        },
        required: ['name', 'exercises']
      }
    }
  },
  required: ['name', 'summary', 'days']
};

export function importSystem(lang, catalog) {
  return [
    'You copy the user\'s OWN training routine into structured data for their workout app. Do not redesign, improve, add or remove anything.',
    `Write day names and the summary in ${lang === 'da' ? 'Danish' : 'English'}.`,
    'Keep every day, in order, with the weekday in the name when given. Keep every exercise with its sets and weight exactly as written (for plate-loaded machines the number is the plates added; keep it as is).',
    'If reps are not given, use 0. If a weight is not given or not tracked, use 0.',
    'Leave out an exercise the user says is not confirmed or unknown, and say so in the summary so they can add it.',
    'Exercise names: when the movement and equipment match one of these catalog exercises, use its name exactly and inCatalog=true:',
    catalog.all.map(e => `${e.en} (${e.equipment})`).join(', ') + '.',
    'Otherwise inCatalog=false with a short clear name (e.g. "Incline Smith press", "Chest-supported row", "Single-arm pushdown"), its equipment and main muscle. A machine version is not the barbell version.'
  ].join(' ');
}

// The model's copy → a plan the card can show and save, plus any new exercises it needs. Null if empty.
export function validateImport(raw, catalog, uid = () => 'c-' + globalThis.crypto.randomUUID()) {
  if (!raw || !Array.isArray(raw.days)) return null;
  const customs = [];
  const exact = n => catalog.findExact(n) || catalog.findExact(n.replace(/s\b/gi, ''));
  const days = [];
  for (const d of raw.days.slice(0, 7)) {
    const exercises = [];
    for (const x of (d?.exercises || []).slice(0, 14)) {
      const nm = String(x?.exercise || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (nm.length < 2) continue;
      let e = exact(nm);
      if (!e && x.inCatalog) { const r = catalog.rank?.(nm)?.[0]; if (r && r.s >= 60) e = r.e; }
      let id = e?.id;
      if (!id) {
        const have = customs.find(c => normalize(c.en) === normalize(nm));
        if (have) id = have.id;
        else {
          const c = makeCustom({ name: nm, muscle: MUSCLES.includes(x.muscle) ? x.muscle : 'chest', equipment: EQUIPMENT.includes(x.equipment) ? x.equipment : 'machine' }, uid());
          if (!c.ok) continue;
          customs.push(c.exercise); id = c.exercise.id;
        }
      }
      if (exercises.some(y => y.exerciseId === id)) continue;
      const sets = Math.max(1, Math.min(10, Math.round(Number(x.sets) || 3)));
      const reps = Math.round(Number(x.reps) || 0);
      const kg = Number(x.kg) > 0 && Number(x.kg) <= 1000 ? Math.round(Number(x.kg) * 4) / 4 : null;
      exercises.push({ exerciseId: id, sets, reps: reps >= 1 && reps <= 50 ? reps : 10, repsGuessed: !(reps >= 1 && reps <= 50), kg });
    }
    if (exercises.length) days.push({ name: String(d.name || '').trim().slice(0, 40) || `Day ${days.length + 1}`, exercises });
  }
  if (!days.length) return null;
  return { name: String(raw.name || '').trim().slice(0, 30) || 'My split', perWeek: days.length, summary: String(raw.summary || '').trim().slice(0, 400), days, customs, imported: true };
}

export function planToRoutines(plan, now = Date.now()) {
  return plan.days.map((d, i) => ({
    id: 'r-' + globalThis.crypto.randomUUID(),
    name: d.name.slice(0, 40),
    plan: plan.name,
    exercises: d.exercises.map(e => ({ exerciseId: e.exerciseId, sets: Array.from({ length: e.sets }, () => ({ reps: e.reps, kg: e.kg ?? null })) })),
    createdAt: now + i
  }));
}

// ---------- memory: "REMEMBER: …" lines the Coach adds when you tell it something lasting ----------

const REMEMBER_RE = /^\s*REMEMBER:\s*(.+?)\s*$/gim;
// The reply without the memory lines, and the facts they carried.
export function splitMemories(text) {
  const facts = [];
  const clean = String(text || '').replace(REMEMBER_RE, (_, f) => { facts.push(f.replace(/[.\s]+$/, '').slice(0, 140)); return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, facts: facts.slice(0, 2) };
}
// While streaming, hide a memory line as soon as it starts.
export const hideMemoryTail = text => String(text || '').replace(/\n?\s*REMEMBER:[^]*$/i, '').replace(/\n?\s*REM(?:E(?:M(?:B(?:E(?:R)?)?)?)?)?$/, '');

const key = s => s.toLowerCase().replace(/[^a-z0-9æøå ]/g, '').replace(/\s+/g, ' ').trim();
export function addMemories(list, facts, now = Date.now()) {
  const out = [...(list || [])];
  for (const f of facts) {
    const k = key(f);
    if (!k || out.some(m => key(m.text) === k)) continue;
    out.push({ id: 'mem-' + now.toString(36) + '-' + out.length, text: f, at: now });
  }
  return out.slice(-40);
}
