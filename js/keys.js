// API keys: only in this browser's localStorage, never in settings, logs or backups.
const KEY = 'setline.keys';

function read(storage) {
  try { const v = JSON.parse(storage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export function getKey(name, storage = globalThis.localStorage) {
  const v = read(storage)[name];
  return typeof v === 'string' ? v : '';
}

export function setKey(name, value, storage = globalThis.localStorage) {
  const all = read(storage);
  const v = String(value || '').trim();
  if (v) all[name] = v; else delete all[name];
  try { storage.setItem(KEY, JSON.stringify(all)); } catch {}
}

export function clearKeys(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); } catch {}
}

export const hasKey = name => !!getKey(name);

// "••••9f2c" for display
export const mask = v => (v ? `••••${v.slice(-4)}` : '');
