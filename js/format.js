// Display formatting. Pure; locale comes from the app language.
import { toDisplay } from './units.js';

const LOCALE = { en: 'en-GB', da: 'da-DK' };
export const locale = lang => LOCALE[lang] || LOCALE.en;

export function num(n, lang, maxDp = 2) {
  if (n == null || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: maxDp }).format(n);
}

// Weight from kg in the chosen unit, without the unit label.
export const weight = (kg, unit, lang) => num(toDisplay(kg, unit), lang, unit === 'lb' ? 1 : 2);

// Big totals: "4,820" / "4.820"
export const total = (kg, unit, lang) => num(Math.round(toDisplay(kg, unit)), lang, 0);

// 32:14 or 1:02:09
export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = v => String(v).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 1:12 for rest
export function mss(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// 52 min / 1 h 5 min
export function minutes(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function day(ts, lang) {
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' }).format(ts);
}

export function dayLong(ts, lang) {
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ts);
}

export function time(ts, lang) {
  return new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function greetingKey(hour) {
  if (hour < 5) return 'greet.night';
  if (hour < 12) return 'greet.morning';
  if (hour < 18) return 'greet.afternoon';
  if (hour < 23) return 'greet.evening';
  return 'greet.night';
}
