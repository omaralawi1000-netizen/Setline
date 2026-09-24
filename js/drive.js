// Google Drive backup: one JSON file per day in the app's hidden Drive folder (appDataFolder),
// the newest 14 kept. Sign-in with Google Identity Services, using a client ID the user created.
// The client ID and the short-lived access token live with the API keys: this browser only.
import { getKey, setKey } from './keys.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const KEEP = 14;
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const GIS = 'https://accounts.google.com/gsi/client';

export const CLIENT_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
export const validClientId = v => CLIENT_RE.test(String(v || '').trim());

// ---------- pure helpers ----------

export const fileName = date => `setline-${date}.json`;
export const dateOfFile = name => /^setline-(\d{4}-\d{2}-\d{2})\.json$/.exec(name || '')?.[1] || null;

// Backup files to delete: everything past the newest `keep` (by date in the name).
export function toPrune(files, keep = KEEP) {
  return files.filter(f => dateOfFile(f.name)).sort((a, b) => dateOfFile(b.name).localeCompare(dateOfFile(a.name))).slice(keep);
}

// Automatic backup is due once a day, and never twice within an hour.
export function backupDue(last, now = Date.now(), today) {
  if (!last?.at) return true;
  if (now - last.at < 3600_000) return false;
  return last.date !== today;
}

export function multipart(meta, json, boundary = 'setline' + Math.random().toString(36).slice(2)) {
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  return { body, type: `multipart/related; boundary=${boundary}` };
}

// ---------- token ----------

export class DriveError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }

const readToken = () => { try { const t = JSON.parse(getKey('driveToken') || 'null'); return t && t.exp > Date.now() + 60_000 ? t.token : null; } catch { return null; } };
export const hasToken = () => !!readToken();
export const clientId = () => getKey('driveClient');
export const connected = () => !!getKey('driveOn') && validClientId(clientId());
export const lastBackup = () => { try { return JSON.parse(getKey('driveLast') || 'null'); } catch { return null; } };
export const setLastBackup = v => setKey('driveLast', v ? JSON.stringify(v) : '');

let gis = null;
function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (gis) return gis;
  gis = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = GIS; s.async = true;
    s.onload = () => res();
    s.onerror = () => { gis = null; rej(new DriveError('offline')); };
    document.head.appendChild(s);
  });
  return gis;
}

// Get an access token. interactive: may show Google's sign-in popup (needs a recent tap).
export async function token({ interactive = false } = {}) {
  const t = readToken();
  if (t) return t;
  if (!interactive) throw new DriveError('signin');
  const id = clientId();
  if (!validClientId(id)) throw new DriveError('noclient');
  await loadGis();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: id, scope: SCOPE, prompt: '',
      callback: r => {
        if (r.error || !r.access_token) return rej(new DriveError(r.error === 'access_denied' ? 'denied' : 'signin'));
        setKey('driveToken', JSON.stringify({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }));
        res(r.access_token);
      },
      error_callback: e => rej(new DriveError(e?.type === 'popup_closed' ? 'closed' : e?.type === 'popup_failed_to_open' ? 'popup' : 'signin'))
    });
    client.requestAccessToken();
  });
}

export function signOut() {
  const t = readToken();
  if (t) try { globalThis.google?.accounts?.oauth2?.revoke(t, () => {}); } catch {}
  setKey('driveToken', '');
  setKey('driveOn', '');
}

// ---------- REST ----------

async function call(url, opts = {}, tok) {
  let res;
  try { res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) } }); }
  catch { throw new DriveError(navigator.onLine === false ? 'offline' : 'network'); }
  if (res.status === 401) { setKey('driveToken', ''); throw new DriveError('signin', 401); }
  if (res.status === 403) throw new DriveError(/accessNotConfigured|has not been used/.test(await res.text().catch(() => '')) ? 'api' : 'denied', 403);
  if (!res.ok) throw new DriveError('failed', res.status);
  return res;
}

export async function listBackups(tok) {
  const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'files(id,name,modifiedTime,size)', orderBy: 'modifiedTime desc', pageSize: '100' });
  const r = await call(`${API}/files?${q}`, {}, tok);
  return ((await r.json()).files || []).filter(f => dateOfFile(f.name));
}

// Upload today's backup (replacing today's file if there is one) and prune old ones.
export async function upload(backup, date, tok) {
  const json = JSON.stringify(backup);
  const files = await listBackups(tok);
  const same = files.find(f => f.name === fileName(date));
  if (same) {
    await call(`${UPLOAD}/files/${same.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json }, tok);
  } else {
    const m = multipart({ name: fileName(date), parents: ['appDataFolder'], mimeType: 'application/json' }, json);
    await call(`${UPLOAD}/files?uploadType=multipart`, { method: 'POST', headers: { 'Content-Type': m.type }, body: m.body }, tok);
  }
  const all = same ? files : [{ name: fileName(date) }, ...files];
  for (const f of toPrune(all)) if (f.id) await call(`${API}/files/${f.id}`, { method: 'DELETE' }, tok).catch(() => {});
  return { bytes: json.length, kept: Math.min(KEEP, all.length) };
}

export async function download(id, tok) {
  const r = await call(`${API}/files/${encodeURIComponent(id)}?alt=media`, {}, tok);
  try { return await r.json(); } catch { throw new DriveError('bad'); }
}
