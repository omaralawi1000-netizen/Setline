// Voice and Coach stand-ins for the check scripts: speech-to-text answers with a fixed sentence, the
// Coach streams a fixed reply, and stand-in keys live only in the test browser. Nothing leaves the
// machine. Also: how many orbs are on screen right now (there must never be two).
import { onScreen, settle } from './harness.mjs';

export const REPLY = 'Your bench is moving well. You added 2.5 kg in two weeks, so keep the same plan and aim for eight reps next time.';

export async function voicePage(page, base, { heard = 'How is my bench going?', micDelay = 0 } = {}) {
  await page.context().route(/api\.groq\.com/, async r => {
    if (/models/.test(r.request().url())) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'whisper-large-v3-turbo' }] }) });
    await new Promise(x => setTimeout(x, 300));
    const seg = { text: heard, no_speech_prob: 0.01, avg_logprob: -0.15, compression_ratio: 1.1 };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: heard, language: 'english', segments: [seg] }) });
  });
  await page.context().route(/generativelanguage\.googleapis\.com/, async r => {
    if (!/streamGenerateContent/.test(r.request().url())) return r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
    await new Promise(x => setTimeout(x, 300));
    const words = REPLY.split(' ');
    let body = '';
    for (let i = 0; i < words.length; i += 4) body += `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: words.slice(i, i + 4).join(' ') + ' ' }] } }] })}\r\n\r\n`;
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body });
  });
  await page.addInitScript(ms => {
    localStorage.setItem('setline.keys', JSON.stringify({ groq: 'stand-in', google: 'stand-in' }));
    if (ms) { const md = navigator.mediaDevices, g = md.getUserMedia.bind(md); md.getUserMedia = c => new Promise(r => setTimeout(r, ms)).then(() => g(c)); }
  }, micDelay);
  await page.goto(base + '?seed=1');
  await onScreen(page, 'today');
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.setSettings({ spoken: 'off', weeklyCheckin: false }); });
  await settle(page, 900);
  const b = await page.locator('#dock .orbbtn').boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// The orbs a person can see right now (drawn, on screen, not faded out; a flight's two looks are one orb).
export const visibleOrbs = page => page.evaluate(() => {
  const op = el => { let a = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; a *= +cs.opacity; } return a; };
  return [...document.querySelectorAll('.orb')].filter(o => { const r = o.getBoundingClientRect(); const g = o.closest('.orbghost'); if (g && o !== g.querySelector('.orb')) return false; return r.width > 12 && r.bottom > 0 && r.top < innerHeight && (g ? Math.max(...[...g.querySelectorAll('.orb')].map(op)) : op(o)) > 0.3 && !o.closest('#s-coach .coachhero'); })
    .map(o => o.id || o.closest('[id]')?.id || 'orb');
});
