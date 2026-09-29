// Contact strips of the big transitions, from the frames the compositor really showed (at full speed,
// not slowed), timed from the event that starts each one (the finger lifting, Back, Send, a key):
//   node scripts/strips.mjs                      all flows → /tmp/strips/<flow>.png
//   node scripts/strips.mjs --only=send,mini     some of them
//   STRIPS=dir node scripts/strips.mjs           somewhere else
//   --long                                       0–1500 ms instead (a streamed reply)
// Each strip: the frames on screen at 0, 30, 60, 90, 120, 160, 200, 250, 300, 380, 460 and 560 ms,
// with the bottom of the screen (the message box and the dock) enlarged underneath. Never committed.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, newPage, serve } from './lib/harness.mjs';
import { FLOWS, PRE, setupCoachPage } from './lib/choreo.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = arg('only')?.split(',');
const OUT = process.env.STRIPS || '/tmp/strips';
const AT = process.argv.includes('--long') ? [0, 100, 200, 300, 400, 500, 600, 700, 800, 1000, 1200, 1500] : [0, 30, 60, 90, 120, 160, 200, 250, 300, 380, 460, 560];

async function strip(browser, base, name) {
  const { context, page, errors } = await newPage(browser, base);
  if (process.argv.includes('--reduced')) await page.emulateMedia({ reducedMotion: 'reduce' });
  const cdp = await context.newCDPSession(page);
  await setupCoachPage(page, base);
  // (--cpu=4: the phone's pace, roughly: every script and paint four times slower)
  const cpu = +(arg('cpu') || 1);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (PRE[name]) await FLOWS[PRE[name]](page);
  const origin = await page.evaluate(() => performance.timeOrigin);
  const shots = [];
  const on = async ({ data, metadata, sessionId }) => { shots.push({ ts: metadata.timestamp * 1000 - origin, data }); try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {} };
  cdp.on('Page.screencastFrame', on);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  // t0: the first finger-up, click, Back, keystroke or keyboard after the gesture is armed
  const arm = () => page.evaluate(() => {
    window.__t0 = null;
    const mark = () => { if (window.__t0 == null) window.__t0 = performance.now(); };
    for (const ev of ['pointerup', 'click', 'popstate', 'input']) addEventListener(ev, mark, { capture: true });
    const app = document.getElementById('app'), kb = app._setKb;
    if (kb) app._setKb = h => { mark(); kb(h); };
    // (the floating orb's handoff starts once its words are in: timed from there, when that's what's asked)
    window.__hand = null;
    new MutationObserver(() => { if (window.__hand == null && app.classList.contains('awaitland')) window.__hand = performance.now(); }).observe(app, { attributes: true, attributeFilter: ['class'] });
    // (a streamed reply: timed from its first words on screen)
    window.__reply = null;
    const th = document.getElementById('thread'), n0 = th?.querySelectorAll(':scope > .msg:not(.me)').length || 0;
    if (th) new MutationObserver(() => { const m = th.querySelectorAll(':scope > .msg:not(.me)'); if (window.__reply == null && m.length > n0 && m[m.length - 1].querySelector('.bub')?.textContent.trim()) window.__reply = performance.now(); }).observe(th, { childList: true, subtree: true, characterData: true });
  });
  const armed = /^(mini|send|close)/.test(name) ? {} : (await arm(), {});
  await FLOWS[name](page, 1, { before: arm, ...armed });
  await cdp.send('Page.stopScreencast');
  // the screencast shows frames a little after they were drawn: measured here with a marker that
  // changes at a known moment, and taken off, so the times are the page's own
  const lagAt = await page.evaluate(() => { const m = document.createElement('i'); m.id = 'lagmark'; Object.assign(m.style, { position: 'fixed', left: 0, top: 0, width: '12px', height: '12px', background: '#000', zIndex: 99999 }); document.body.append(m); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { m.style.background = '#fff'; r(performance.now()); }))); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  await page.waitForTimeout(400);
  await cdp.send('Page.stopScreencast');
  const lagShots = shots.filter(x => x.ts >= lagAt - 200);
  const firstWhite = await page.evaluate(async list => { for (let i = 0; i < list.length; i++) { const im = new Image(); im.src = 'data:image/jpeg;base64,' + list[i].data; await im.decode(); const c = document.createElement('canvas'); c.width = c.height = 4; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 4, 4, 0, 0, 4, 4); if (x.getImageData(1, 1, 1, 1).data[0] > 200) return list[i].ts; } return null; }, lagShots);
  const lag = firstWhite != null ? Math.max(0, firstWhite - lagAt) : 0;
  const t0 = (await page.evaluate(([h, st]) => (st && window.__reply) || (h && window.__hand) || window.__t0, [name.startsWith('mini'), name.startsWith('stream')])) + lag;
  const pick = AT.map(t => { let j = -1; shots.forEach((s, i) => { if (s.ts <= t0 + t) j = i; }); return Math.max(0, j); });
  const png = await page.evaluate(async ({ frames, labels }) => {
    const W = 195, H = 422, B = 150, c = document.createElement('canvas');
    c.width = W * frames.length; c.height = 18 + H + 6 + B;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#000'; x.font = '12px sans-serif';
    for (let i = 0; i < frames.length; i++) {
      const im = new Image(); im.src = 'data:image/jpeg;base64,' + frames[i]; await im.decode();
      x.fillText(labels[i], i * W + 4, 13);
      x.drawImage(im, i * W, 18, W, H);
      // the bottom 150 px (box and dock) at full size, from its middle... the whole width at half
      x.drawImage(im, 0, im.height - 150 * im.height / 844, im.width, 150 * im.height / 844, i * W, 18 + H + 6, W, B / 2);
      x.drawImage(im, im.width / 2, im.height - 150 * im.height / 844, im.width / 2, 150 * im.height / 844, i * W, 18 + H + 6 + B / 2, W, B / 2);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, { frames: pick.map(i => shots[i].data), labels: pick.map((i, k) => `${AT[k]} ms (${Math.round(shots[i].ts - t0)})`) });
  cdp.off('Page.screencastFrame', on);
  console.log(`  (screencast lag ${Math.round(lag)} ms, taken off)`);
  await writeFile(join(OUT, `${name}${process.argv.includes('--reduced') ? '-reduced' : ''}${arg('cpu') ? '-cpu' + arg('cpu') : ''}.png`), Buffer.from(png, 'base64'));
  await context.close();
  return errors;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  try {
    for (const name of Object.keys(FLOWS)) {
      if (ONLY && !ONLY.some(o => name.includes(o))) continue;
      const errors = await strip(browser, base, name);
      console.log(`${name}: ${join(OUT, name)}.png${errors.length ? '  page errors: ' + errors.join(' | ') : ''}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
