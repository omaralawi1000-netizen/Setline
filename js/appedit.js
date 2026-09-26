// The Coach running the app: besides plan changes (planedit.js) it can change settings, do anything
// the app understands from words ("2 eggs and toast", "I weigh 82", "start push day") and open a page.
// Its reply carries lines like
//   CHANGE: {"setting":"restSec","value":120}
//   CHANGE: {"do":"log 2 eggs and toast"}
//   CHANGE: {"open":"progress"}
// Pure: validates and describes; the UI applies.
import { ACCENTS } from './settings.js';

const oneOf = list => v => (list.includes(v) ? v : undefined);
const bool = v => (v === true || v === 'on' || v === 'true' ? true : v === false || v === 'off' || v === 'false' ? false : undefined);
const num = (lo, hi, step = 1) => v => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n / step) * step : undefined;
};

// What may be set, and how a value is checked. Anything else is refused.
export const SETTABLE = {
  restSec: num(30, 300, 15),
  weeklyGoal: num(1, 7),
  cardioGoal: num(30, 900, 15),
  unit: oneOf(['kg', 'lb']),
  spoken: oneOf(['off', 'minimal', 'full']),
  accent: oneOf(ACCENTS),
  lang: oneOf(['auto', 'da', 'en']),
  voiceLang: oneOf(['auto', 'da', 'en']),
  micMode: oneOf(['hold', 'tap']),
  motion: oneOf(['auto', 'on', 'off']),
  proteinPerKg: num(1.2, 2.6, 0.1),
  haptics: bool,
  autoAdvance: bool,
  autoWarmup: bool,
  restAlerts: bool,
  restSound: bool,
  readiness: bool,
  suggestions: bool
};

// Pages the Coach may open: tabs and the pages under You.
export const PAGES = { today: 'tab', workout: 'tab', train: 'tab', food: 'tab', you: 'tab', progress: 'sub', history: 'sub', body: 'sub', settings: 'sub' };

const isApp = c => c && typeof c === 'object' && ('setting' in c || 'do' in c || 'open' in c);
export function splitAppChanges(changes) {
  const app = [], plan = [];
  for (const c of changes || []) (isApp(c) ? app : plan).push(c);
  return { app, plan };
}

// Check each app change. Returns {settings: patch, before: {key: old}, done: [text], dos: [text], open: page|null, failed: [text]}.
// `t` formats the short descriptions shown under the reply.
export function planAppChanges(changes, current = {}, t = (k, p) => `${k} ${JSON.stringify(p || {})}`) {
  const out = { settings: {}, before: {}, done: [], dos: [], open: null, failed: [] };
  for (const c of changes || []) {
    if ('setting' in c) {
      const key = String(c.setting), check = SETTABLE[key];
      const value = check ? check(c.value) : undefined;
      if (value === undefined) { out.failed.push(`${key}: ${c.value}`); continue; }
      if (!(key in out.before)) out.before[key] = current[key];
      out.settings[key] = value;
      out.done.push(t('change.setting', { what: t('change.set.' + key), value: typeof value === 'boolean' ? t(value ? 'change.on' : 'change.off') : String(value) }));
    } else if ('do' in c) {
      const text = String(c.do || '').trim().slice(0, 300);
      if (text && out.dos.length < 3) out.dos.push(text); else out.failed.push(text || 'do');
    } else if ('open' in c) {
      const page = String(c.open || '').toLowerCase().trim();
      if (PAGES[page]) out.open = page === 'train' ? 'workout' : page; else out.failed.push(page || 'open');
    }
  }
  return out;
}

// ---------- offers: "Do it" chips ----------
// When the Coach suggests something you haven't asked for yet, it offers it instead of doing it:
//   ACTION: {"label":"Move legs to Friday","changes":[{"routine":"Legs","weekday":"Fri"}]}
//   ACTION: {"label":"Log 2 eggs","do":"log 2 eggs"}
// Shown as at most two chips under the reply; one tap applies it (with Undo).
const ACTION_RE = /^[ \t]*ACTION:[ \t]*(\{.*\})[ \t]*(?:\r?\n|$)/gim;
export function splitActions(text) {
  const actions = [];
  const clean = String(text || '').replace(ACTION_RE, (_, j) => {
    try {
      const o = JSON.parse(j);
      const label = typeof o?.label === 'string' ? o.label.trim().slice(0, 40) : '';
      const changes = Array.isArray(o?.changes) ? o.changes : o?.change ? [o.change] : o?.do ? [{ do: String(o.do) }] : o?.setting ? [{ setting: o.setting, value: o.value }] : [];
      const ok = changes.filter(c => c && typeof c === 'object').slice(0, 4);
      if (label && ok.length) actions.push({ label, changes: ok });
    } catch {}
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, actions: actions.slice(0, 2) };
}
// While streaming, an offer line is hidden as soon as it starts.
export const hideActionTail = text => String(text || '').replace(/\n?\s*ACTION:[^]*$/i, '').replace(/\n?\s*ACT(?:I(?:O(?:N)?)?)?$/, '');

// "yes", "do it", "ja", "gør det": saying yes to the offer on screen
export const isAffirm = text => /^(?:yes|yeah|yep|yup|sure|yes please|please do|do it|go ahead|go for it|sounds good|ok do it|okay do it|let'?s do it|ja|jo|ja tak|ja gerne|gør det|gør det bare|kør|kør på|det gør vi)[.!]*$/i.test(String(text || '').trim());
