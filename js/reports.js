// Bugs, ideas and important notes you send to the developer (Claude, working on this repo). Pure.
//
// A report is kept on the phone and sent as a GitHub issue on this app's repository: the app opens
// GitHub's "new issue" page already filled in (no token or key needed; you're signed in there),
// and the next coding session can read the issues. Errors the app runs into are kept too (the last
// few), so a report can carry what went wrong.
export const REPO = 'omaralawi1000-netizen/Setline';
export const KINDS = ['bug', 'idea', 'important'];
const MAX_TEXT = 2000;

export function makeReport({ kind = 'bug', text = '', context = {} } = {}, now = Date.now(), id = `r${now.toString(36)}`) {
  return { id, kind: KINDS.includes(kind) ? kind : 'bug', text: String(text || '').trim().slice(0, MAX_TEXT), at: now, context, sent: false };
}

export function sanitizeReports(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(r => r && typeof r.id === 'string' && typeof r.text === 'string' && r.text.trim())
    .slice(-50).map(r => ({ id: r.id.slice(0, 40), kind: KINDS.includes(r.kind) ? r.kind : 'bug', text: r.text.slice(0, MAX_TEXT), at: Number.isFinite(r.at) ? r.at : 0, context: r.context && typeof r.context === 'object' ? r.context : {}, sent: !!r.sent }));
}

const LABEL = { bug: 'Bug', idea: 'Idea', important: 'Important' };
const stamp = t => new Date(t).toISOString().replace('T', ' ').slice(0, 16);

// A short title from the first line.
export function reportTitle(r) {
  const first = r.text.split(/\n/)[0].replace(/\s+/g, ' ').trim();
  return `[${LABEL[r.kind]}] ${first.length > 70 ? first.slice(0, 67) + '…' : first}`;
}

// The issue body: what you wrote, then what the app knew at the time.
export function reportBody(r) {
  const c = r.context || {};
  const lines = [r.text, '', '---', `**App** ${c.version || '?'} · screen: ${c.screen || '?'}${c.workout ? ' · in a workout' : ''} · ${stamp(r.at)}`];
  if (c.device) lines.push(`**Device** ${c.device}`);
  if (c.settings) lines.push(`**Settings** ${c.settings}`);
  if (c.heard?.length) lines.push('', '**Last things heard by voice**', ...c.heard.map(h => `- "${h}"`));
  if (c.errors?.length) lines.push('', '**Recent errors**', '```', ...c.errors.map(e => `${stamp(e.at)} ${e.msg}${e.where ? ` @ ${e.where}` : ''}`), '```');
  lines.push('', '_Sent from Setline_');
  return lines.join('\n');
}

// GitHub's "new issue" page, filled in. Kept under the length browsers and GitHub accept.
export function issueUrl(r, repo = REPO) {
  let body = reportBody(r);
  const make = b => `https://github.com/${repo}/issues/new?title=${encodeURIComponent(reportTitle(r))}&body=${encodeURIComponent(b)}`;
  while (make(body).length > 7000 && body.length > 200) body = body.slice(0, Math.floor(body.length * 0.85)) + '\n…';
  return make(body);
}

// Everything, as one block of text to paste into a chat with Claude.
export function reportsText(list) {
  return list.map(r => `## ${reportTitle(r)}\n${reportBody(r)}`).join('\n\n');
}

// ---------- errors the app ran into ----------
export function pushError(list, { msg, where = '' }, now = Date.now(), max = 12) {
  const m = String(msg || '').slice(0, 200);
  if (!m) return list;
  const last = list[list.length - 1];
  if (last && last.msg === m && now - last.at < 5000) return list; // the same error in a loop
  return [...list, { at: now, msg: m, where: String(where || '').slice(0, 120) }].slice(-max);
}

// "report a bug: the timer froze", "bug: …", "idea: …", "note for Claude: …", "fejl: …", "idé: …"
export function reportIntent(text) {
  const s = String(text || '').trim();
  const m = /^(?:(?:please )?(?:report|log|file|send|note)(?: (?:a|an|this))? (bug|idea|issue|problem|feature|improvement)|(bug|idea|important|feature request|note for (?:claude|the developer|dev)|rapportér(?: en)? fejl|fejl|idé til appen|forslag til appen|note til claude)(?=\s*[:,.-]))\b[\s:,.-]*(.*)$/is.exec(s);
  if (!m) return null;
  const w = (m[1] || m[2] || '').toLowerCase();
  const kind = /idea|feature|improvement|idé|ide\b|forslag/.test(w) ? 'idea' : /important|vigtigt|note/.test(w) ? 'important' : 'bug';
  return { type: 'Report', kind, text: m[3].trim() };
}
