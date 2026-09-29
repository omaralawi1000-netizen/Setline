// Frame-by-frame view of the big transitions (Home ↔ Coach, floating orb → Coach, voice screen →
// Coach), shared by scripts/choreo.mjs (strips to look at) and scripts/golden.mjs (assertions).
//
// installProbe(page): every frame, in the page: the orbs that can be seen (opacity over 0.02 with
//   their ancestors, on screen), each screen's content opacity, the message box (opacity, its orb
//   slot), the dock, and the travelling orb's distance from the message box's orb slot.
// screencast(cdp): the frames the compositor really shows (small JPEGs), for the average luminance.
// flows: the four gestures, each from its own starting screen.
import { STAND_IN, mockServices } from './voiceflow.mjs';
import { newPage, onScreen, settle } from './harness.mjs';

export const installProbe = page => page.evaluate(() => {
  const op = el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
  const onScr = r => r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const mid = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  window.__cf = [];
  window.__cfMark = n => window.__cf.push({ mark: n, t: performance.now() });
  const tick = () => {
    const orbs = [];
    for (const o of document.querySelectorAll('.orb')) {
      const gh = o.closest('.orbghost');
      if (gh && o !== gh.querySelector('.orb')) continue; // (a flight's second look is the same orb: counted once, as the brighter of the two)
      const r = o.getBoundingClientRect(), a = gh ? Math.max(...[...gh.querySelectorAll('.orb')].map(op)) : op(o);
      if (a > 0.02 && onScr(r)) orbs.push({ id: o.id || (o.closest('.orbghost') ? 'flight' : o.closest('#composer') ? 'box' : o.closest('#dock') ? 'dock' : o.parentElement?.className || 'orb'), ...mid(r), a: +a.toFixed(2), w: Math.round(r.width) });
    }
    const screens = {};
    // (a screen's content: the Coach's header stands for it, since in a voice handoff its parts fade, not the screen)
    for (const s of document.querySelectorAll('.screen')) { const a = op(s.dataset.screen === 'coach' ? s.querySelector('.coachhead') || s : s); if (a > 0.005) screens[s.dataset.screen] = +a.toFixed(2); }
    const v = document.getElementById('voice');
    if (v && !v.hidden) {
      const top = v.querySelector('.top');
      screens.voice = +Math.max(op(top), op(v.querySelector('.vracts') || top), op(v.querySelector('#vhold'))).toFixed(2);
      // what's under the voice screen shows only through its backdrop (97 % opaque when it's in)
      const cover = op(v.querySelector('.vbg')) * 0.97;
      for (const k in screens) if (k !== 'voice') screens[k] = +(screens[k] * (1 - cover)).toFixed(2);
    }
    const box = document.getElementById('composer'), corb = box?.querySelector('.corb');
    const slot = corb ? mid(corb.getBoundingClientRect()) : null;
    const dcap = document.querySelector('#dock .dcap');
    // the flying orb against the flying words (your new message): how far apart they are, in px (< 0: over them)
    const gh = document.querySelector('.orbghost');
    // (the words are what you said, flying from where they were, until your message shows under them)
    const bub = document.querySelector('#thread > .msg.me.wordsin .bub');
    const fly = [...document.querySelectorAll('#vrtext, #osay, #vsay')].find(x => x.getAnimations().length && op(x) > 0.3);
    const wd = bub && op(bub) >= 0.5 ? bub : fly || null;
    const letters = el => { const rg = document.createRange(), w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let L = 1e9, T = 1e9, R = -1e9, B = -1e9;
      for (let n; (n = w.nextNode());) { if (!n.data.trim()) continue; rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width) { L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom); } }
      return L < 1e9 ? { left: L, top: T, right: R, bottom: B } : el.getBoundingClientRect(); };
    let gap = null;
    if (gh && wd) { const a = gh.getBoundingClientRect(), b = letters(wd), r = a.width / 2, cx = a.left + r, cy = a.top + r;
      gap = Math.round(Math.hypot(cx - Math.max(b.left, Math.min(cx, b.right)), cy - Math.max(b.top, Math.min(cy, b.bottom))) - r); }
    window.__cf.push({ t: performance.now(), gap, orbs, screens, box: box ? +op(box).toFixed(2) : 0, slot, dock: dcap ? +op(dcap).toFixed(2) : 0,
      spot: box?.dataset.spot || '', send: box ? +op(box.querySelector('.csend')).toFixed(2) : 0, mine: [...document.querySelectorAll('#thread > .msg.me')].pop() || null, msgs: document.querySelectorAll('#thread > .msg.me').length });
    if (window.__cf.length < 20000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
export const mark = (page, n) => page.evaluate(x => window.__cfMark(x), n);
// the frames between two marks, without the DOM node (kept in the page for identity checks)
export const frames = (page, from, to) => page.evaluate(([a, b]) => {
  const f = window.__cf, i = f.findIndex(x => x.mark === a), j = b ? f.findIndex(x => x.mark === b) : f.length;
  return f.slice(i + 1, j < 0 ? f.length : j).filter(x => !x.mark).map(({ mine, ...x }) => x);
}, [from, to]);

// The compositor's frames, from now until stop(): [{ts (ms, page clock), lum (0–255)}].
export async function screencast(page, cdp) {
  const shots = [];
  const origin = await page.evaluate(() => performance.timeOrigin);
  const on = async ({ data, metadata, sessionId }) => { shots.push({ ts: metadata.timestamp * 1000 - origin, data }); try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {} };
  cdp.on('Page.screencastFrame', on);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 120, maxHeight: 260, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    cdp.off('Page.screencastFrame', on);
    const lum = await page.evaluate(async list => {
      const c = document.createElement('canvas'); c.width = 30; c.height = 64; const x = c.getContext('2d', { willReadFrequently: true });
      const out = [];
      for (const d of list) {
        const im = new Image(); im.src = 'data:image/jpeg;base64,' + d; await im.decode();
        x.drawImage(im, 0, 0, 30, 64);
        const px = x.getImageData(0, 0, 30, 64).data; let s = 0;
        for (let i = 0; i < px.length; i += 4) s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        out.push(+(s / (px.length / 4)).toFixed(2));
      }
      return out;
    }, shots.map(s => s.data));
    return shots.map((s, i) => ({ ts: s.ts, lum: lum[i] }));
  };
}

// The four gestures. Each starts where it should and returns once its transition has settled.
export async function setupCoachPage(page, base, { slowmo = 1 } = {}) {
  await mockServices(page, { delay: 250 });
  await page.addInitScript(k => localStorage.setItem('setline.keys', JSON.stringify(k)), STAND_IN);
  await page.goto(base + '?seed=1' + (slowmo > 1 ? `&slowmo=${slowmo}&cdp=1` : ''));
  await onScreen(page, 'today');
  await page.evaluate(async long => {
    const s = await import('./js/store.js');
    s.setSettings({ spoken: 'off', weeklyCheckin: false });
    // (CHOREO_LONG=1: a conversation longer than the screen, as it usually is)
    for (let i = 0; i < (long ? 6 : 0); i++) { s.addChat('user', `What about day ${i + 1}?`); s.addChat('model', 'Keep it light and technique-focused: a few easy sets, then call it a day. Eat well tonight so you have fuel for tomorrow.'); }
    s.addChat('user', 'How was last week?');
    s.addChat('model', 'Four sessions and a record on the bench. Keep the same plan and add a set of rows on Thursday.');
    await document.fonts.ready;
  }, !!process.env.CHOREO_LONG);
  await settle(page, 1200 * slowmo);
}
const orbCenter = async page => { const b = await page.locator('#dock .orbbtn').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
export const FLOWS = {
  'home-to-coach': async (page, k = 1) => { const o = await orbCenter(page); await page.mouse.move(o.x, o.y); await page.mouse.down(); await page.mouse.up(); await page.waitForSelector('#s-coach.screen.on', { state: 'attached' }); await settle(page, 1100 * k); },
  'coach-to-home': async (page, k = 1) => { await page.goBack(); await page.waitForSelector('#s-today.screen.on', { state: 'attached' }); await settle(page, 1100 * k); },
  'mini-to-coach': async (page, k = 1, hooks = {}) => {
    const o = await orbCenter(page); await page.mouse.move(o.x, o.y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 * k }); await settle(page, 900 * k);
    await page.mouse.up();
    await page.waitForSelector('#ofloat.reviewing #vrtext:not(:empty)', { timeout: 6000 * k });
    await hooks.before?.(); await page.click('#ofloat .vrsend');
    await page.waitForSelector('#s-coach.screen.on', { state: 'attached', timeout: 8000 * k }); await settle(page, 1300 * k);
  },
  'close-voice': async (page, k = 1, hooks = {}) => {
    const o = await orbCenter(page); await page.mouse.move(o.x, o.y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 * k }); await settle(page, 400 * k);
    for (let dy = 10; dy <= 180; dy += 10) await page.mouse.move(o.x, o.y - dy);
    await page.waitForSelector('#voice.on', { timeout: 4000 * k }); await settle(page, 700 * k);
    await page.mouse.up();
    await page.waitForSelector('#voice.reviewing #vrtext:not(:empty)', { timeout: 6000 * k }); await settle(page, 500 * k);
    await hooks.before?.(); await page.click('#voice [data-v=close]');
    await page.waitForSelector('#voice', { state: 'hidden', timeout: 8000 * k }); await settle(page, 900 * k);
  },
  // in the Coach: typing turns the orb into the send arrow; clearing the field turns it back
  typing: async (page, k = 1, hooks = {}) => {
    await hooks.before?.(); await page.fill('#composer input', 'How was my bench?'); await settle(page, 500 * k);
    await page.fill('#composer input', ''); await page.dispatchEvent('#composer input', 'input'); await settle(page, 600 * k);
  },
  // in the Coach: the keyboard comes up and goes (there's no keyboard in a test browser: its height is told to the page)
  keyboard: async (page, k = 1, hooks = {}) => {
    await hooks.before?.(); await page.evaluate(() => document.getElementById('app')._setKb(300)); await settle(page, 600 * k);
    await page.evaluate(() => document.getElementById('app')._setKb(0)); await settle(page, 600 * k);
  },
  // in the Coach: a question typed and sent, and the reply streaming in (the thread grows, the view follows)
  'stream-reply': async (page, k = 1, hooks = {}) => {
    await page.fill('#composer input', 'How was my bench?'); await settle(page, 300 * k);
    await hooks.before?.(); await page.press('#composer input', 'Enter');
    await page.waitForFunction(() => document.getElementById('app').classList.contains('coaching') && !document.querySelector('#composer[data-spot=stop]'), null, { timeout: 12000 * k }).catch(() => {});
    await settle(page, 600 * k);
  },
  'send-to-coach': async (page, k = 1, hooks = {}) => {
    const o = await orbCenter(page); await page.mouse.move(o.x, o.y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 * k }); await settle(page, 400 * k);
    for (let dy = 10; dy <= 180; dy += 10) await page.mouse.move(o.x, o.y - dy);
    await page.waitForSelector('#voice.on', { timeout: 4000 * k }); await settle(page, 700 * k);
    await page.mouse.up();
    await page.waitForSelector('#voice.reviewing #vrtext:not(:empty)', { timeout: 6000 * k }); await settle(page, 500 * k);
    await hooks.before?.(); await page.click('#vreview .vrsend');
    await page.waitForSelector('#s-coach.screen.on', { state: 'attached', timeout: 8000 * k }); await settle(page, 1400 * k);
  }
};

// The rules, frame by frame. Returns a list of what broke (empty: all good).
// Under reduced motion the transitions are plain 150 ms cross-fades (nothing flies), so there only:
// never two orbs clearly there at once, no dip past 15 %, and your words still become your message.
export function judge(fr, lum, { flow, reduced = false }) {
  const bad = [];
  if (reduced) {
    const two = fr.filter(f => f.orbs.filter(o => o.a > 0.5).length > 1);
    if (two.length) bad.push(`${two.length} frame(s) with two orbs over 50 %`);
    if (lum?.length > 2) {
      const a = lum[0].lum, b = lum[lum.length - 1].lum, low = lum.filter(x => x.lum < Math.min(a, b) * 0.5);
      if (low.length) bad.push(`dips darker than both ends by over half in ${low.length} frame(s)`);
    }
    return bad;
  }
  const many = fr.filter(f => f.orbs.length > 1);
  if (many.length) bad.push(`${many.length} frame(s) with ${Math.max(...many.map(f => f.orbs.length))} orbs (${many[0].orbs.map(o => o.id).join(', ')})`);
  const none = fr.filter(f => !f.orbs.length && !(f.spot === 'send' || f.spot === 'stop' || f.send > 0.5)); // (the box's orb spot may be the send arrow or the stop button)
  if (none.length) bad.push(`${none.length} frame(s) with no orb at all (first at ${Math.round(none[0].t - fr[0].t)} ms)`);
  const both = fr.filter(f => Object.values(f.screens).filter(a => a > 0.2).length > 1);
  if (both.length) bad.push(`${both.length} frame(s) with two screens' content over 20 % (${JSON.stringify(both[0].screens)})`);
  // landing: an orb reaching the message box's orb slot finds the box already there
  const early = fr.filter(f => f.slot && f.orbs.some(o => o.id === 'flight' && Math.hypot(o.x - f.slot.x, o.y - f.slot.y) < 16) && f.box < 0.9);
  if (/^(mini|send)-/.test(flow) && early.length) bad.push(`the orb reached the message box before it was there (${early.length} frame(s), box at ${early[0].box})`);
  // the orb never passes over your words
  const over = fr.filter(f => f.gap != null && f.gap < 0);
  if (over.length) bad.push(`the orb passed over your words in ${over.length} frame(s) (by ${-Math.min(...over.map(f => f.gap))} px)`);
  // Home ↔ Coach: the orb doesn't fly, it stays exactly where it is (the box grows out of it)
  if (/^(home|coach)-to-/.test(flow)) {
    const at = fr.flatMap(f => f.orbs.slice(0, 1)), x0 = at[0];
    const moved = x0 ? at.filter(o => Math.hypot(o.x - x0.x, o.y - x0.y) > 1.5) : [];
    if (moved.length) bad.push(`the orb moved in ${moved.length} frame(s) (up to ${Math.round(Math.max(...moved.map(o => Math.hypot(o.x - x0.x, o.y - x0.y))))} px)`);
  }
  // a question sent: one new message of yours, never more (nothing old re-appears as new)
  if (/^(mini|send)-/.test(flow) && fr.length) {
    const n0 = fr[0].msgs, n1 = Math.max(...fr.map(f => f.msgs));
    if (n1 - n0 !== 1) bad.push(`${n1 - n0} new message(s) of yours, not 1`);
  }
  if (lum?.length > 2) {
    // (a dip to black: under half the darker end; the big bright Send button leaving dims the voice screen a
    // little on its way to the Coach, and that's fine)
    const a = lum[0].lum, b = lum[lum.length - 1].lum, floor = Math.min(a, b) * 0.5, low = lum.filter(x => x.lum < floor);
    if (low.length) bad.push(`dips darker than both ends by over half in ${low.length} frame(s) (ends ${a} / ${b}, lowest ${Math.min(...low.map(x => x.lum))})`);
  }
  return bad;
}

// each flow needs the one before it (Coach → Home starts in the Coach)
export const PRE = { 'coach-to-home': 'home-to-coach', typing: 'home-to-coach', keyboard: 'home-to-coach', 'stream-reply': 'home-to-coach' };

// One flow at full speed with the probe and the compositor's frames, judged from the gesture that
// starts it (the tap, Back, the release, Send). With {reduced}, under prefers-reduced-motion.
export async function checkFlow(browser, base, name, { reduced = false } = {}) {
  const { context, page, errors } = await newPage(browser, base);
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  const cdp = await context.newCDPSession(page);
  await setupCoachPage(page, base);
  if (PRE[name]) await FLOWS[PRE[name]](page);
  await installProbe(page);
  const stop = await screencast(page, cdp);
  let t0 = await page.evaluate(() => performance.now()), from = 'go';
  await mark(page, 'go');
  await FLOWS[name](page, 1, { before: async () => { t0 = await page.evaluate(() => { window.__cfMark('start'); return performance.now(); }); from = 'start'; } });
  const lum = (await stop()).filter(x => x.ts >= t0 - 20);
  const fr = await frames(page, from);
  const bad = judge(fr, lum, { flow: name, reduced });
  // what you said becomes your message: the node the words flew into is the message, for good
  if (/^(mini|send)-/.test(name)) {
    const same = await page.evaluate(() => {
      const f = window.__cf.filter(x => x.mine), first = f.find(x => x.mine.classList.contains('wordsin'))?.mine;
      const last = [...document.querySelectorAll('#thread > .msg.me')].pop();
      if (!first) return 'the words never flew into a message';
      if (first !== last || !first.isConnected) return 'the message the words became was replaced';
      if (f.some(x => x.t > 0 && x.mine !== first && f.indexOf(x) > f.findIndex(y => y.mine === first))) return 'the message was swapped for another node mid-flight';
      return '';
    });
    if (same) bad.push(same);
  }
  await context.close();
  return { bad, frames: fr.length, lum: lum.map(x => x.lum), errors };
}
