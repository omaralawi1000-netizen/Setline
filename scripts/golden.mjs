// Golden flows: the few user journeys Setline is never allowed to break, run in a real browser.
//   npm run golden            all flows
//   npm run golden -- --only=offline
// Exit code 1 if any flow fails or the page throws an error. Nothing leaves the machine except
// Google Fonts. Selectors are the app's own data-act / data-k hooks: a redesign must keep them
// (or update this file in the same change).
import { launch, newPage, serve, settle, onScreen } from './lib/harness.mjs';
import { STAND_IN, mockServices, installSampler, mark, samples, between } from './lib/voiceflow.mjs';

const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean);

const countWorkouts = page => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('setline');
  r.onerror = () => reject(r.error);
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('workouts')) { db.close(); return resolve(0); }
    const c = db.transaction('workouts').objectStore('workouts').count();
    c.onsuccess = () => { db.close(); resolve(c.result); };
    c.onerror = () => reject(c.error);
  };
}));
const doneSets = page => page.locator('#s-workout .set.done:not(.warm)').count();

// A page ready for the dock orb, driven by a real finger (CDP touch events: touch pointers, and the
// click Chrome makes from a tap, as on the phone): keys (stand-ins), mocked speech-to-text and Coach,
// a chat with a few messages (so it scrolls), the buzz recorded, and every transcription's audio size.
async function holdRig(browser, base, opts = {}) {
  const { context, page, errors } = await newPage(browser, base, opts);
  await mockServices(page, { heard: 'How is my bench going?' });
  const stt = [];
  page.on('request', r => { if (/api\.groq\.com/.test(r.url())) stt.push(r.postDataBuffer()?.length || 0); });
  await page.addInitScript(k => {
    localStorage.setItem('setline.keys', JSON.stringify(k));
    // the mic takes a moment to open on a phone (headless opens it at once, which hid a bug)
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => new Promise(r => setTimeout(r, 400)).then(() => gum(c));
    window.__vib = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: ms => { window.__vib.push(ms); return true; } });
  }, STAND_IN);
  await page.goto(base + '?seed=1');
  await onScreen(page, 'today');
  const users = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    window.__s = s;
    s.setSettings({ spoken: 'off', weeklyCheckin: false });
    for (let i = 0; i < 6; i++) { s.addChat('user', `Question ${i + 1} about my plan?`); s.addChat('model', 'Keep the same plan this week, add a set of rows on Thursday and sleep a little more before the heavy day.'); }
    return s.state.chat.filter(m => m.role === 'user').length;
  });
  await settle(page, 1200);
  const o = await page.locator('#dock .orbbtn').boundingBox();
  const x = o.x + o.width / 2, y = o.y + o.height / 2;
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const finger = {
    down: (px = x, py = y) => touch('touchStart', [{ x: px, y: py, id: 1 }]),
    move: async (dy, steps = 6) => { for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x, y: y + (dy * i) / steps, id: 1 }]); await page.waitForTimeout(16); } },
    up: () => touch('touchEnd', []),
    cancel: () => touch('touchCancel', []),
    tap: async () => { await touch('touchStart', [{ x, y, id: 1 }]); await page.waitForTimeout(70); await touch('touchEnd', []); }
  };
  const sentMessages = () => page.evaluate(n => window.__s.state.chat.filter(m => m.role === 'user').length - n, users);
  return { context, page, users, x, y, finger, stt: () => stt, sentMessages, done: async () => { await context.close(); return errors; } };
}
// exactly one orb element and at most one frost layer in the page, at every frame
function oneOfEach(rec) {
  const all = between(rec, 'down', 'end');
  if (!all.length) throw new Error('no frames were recorded');
  const orbs = all.filter(x => x.orbEls !== 1), frosts = all.filter(x => x.frosts > 1);
  if (orbs.length) throw new Error(`${orbs.length} frame(s) with ${orbs[0].orbEls} orb elements in the page`);
  if (frosts.length) throw new Error(`${frosts.length} frame(s) with ${frosts[0].frosts} frost layers`);
  const two = all.filter(x => x.orbs > 1);
  if (two.length) throw new Error(`${two.length} frame(s) with ${two[0].orbs} orbs on screen`);
}
// After every flow that ended on the page (not in the chat): nothing of the voice layer, the frost or the
// flier is left, the orb is home in the dock and the dock is visible.
async function nothingLeft(page, what) {
  await page.waitForTimeout(1400);
  const r = await page.evaluate(() => {
    const app = document.getElementById('app'), orb = document.getElementById('orb'), dock = document.getElementById('dock');
    return {
      frost: document.querySelectorAll('.frost').length, frosted: app.classList.contains('frosted'), flier: document.querySelectorAll('.orbfly').length,
      fly: document.querySelectorAll('.flytext').length, voice: !document.getElementById('voice').hidden, chat: app.classList.contains('chatsheet'),
      orb: orb?.parentElement?.className || '(none)', dock: +getComputedStyle(dock).opacity, voiceCls: app.classList.contains('voice'),
      pending: document.querySelectorAll('.msg.pending').length
    };
  });
  const bad = [];
  if (r.frost || r.frosted) bad.push(`frost left (${r.frost} nodes, frosted ${r.frosted})`);
  if (r.flier) bad.push('the orb\'s flier left');
  if (r.fly) bad.push('flying text left');
  if (r.voice || r.voiceCls) bad.push('the voice layer still showing');
  if (r.chat) bad.push('the chat sheet still showing');
  if (r.pending) bad.push('a message still shimmering');
  if (!/orbbtn/.test(r.orb)) bad.push(`the orb isn't home in the dock (${r.orb})`);
  if (r.dock < 0.99) bad.push(`the dock isn't back (opacity ${r.dock.toFixed(2)})`);
  if (bad.length) throw new Error(`${what}: ${bad.join('; ')}`);
}
const listeningWithin = (page, ms) => page.waitForSelector('#voice[data-phase=listening]', { state: 'attached', timeout: ms }).then(() => true, () => false);
const audioState = page => page.evaluate(async () => (await import('./js/audio.js')).audioContext()?.state);

async function startRoutine(page) {
  await page.click('#dock .tab[data-to=today]');
  await onScreen(page, 'today');
  await settle(page, 600);
  await page.click('#s-today [data-act=start-routine]');
  await page.waitForSelector('.sheet.show .rdy', { timeout: 8000 }); // readiness check
  await page.click('.sheet.show .rdy.r4');
  await page.click('.sheet.show [data-k=go]');
  await onScreen(page, 'workout');
  await settle(page);
}

const FLOWS = {
  // Start → log a set → the tab is killed → the set is still there → finish → it's in history.
  'workout-loop': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await settle(page, 1200);
    const before = await countWorkouts(page);

    await startRoutine(page);
    await page.click('#s-workout [data-act=log]');
    await settle(page, 2400);
    const logged = await doneSets(page);
    if (logged < 1) throw new Error(`expected a done set after Log, found ${logged}`);

    // a killed tab: a brand-new page load, no in-memory state survives
    await page.goto(base);
    await page.waitForSelector('#s-workout.screen.on, #s-today.screen.on', { state: 'attached', timeout: 8000 });
    await settle(page, 900);
    // the app reopens the running workout itself; if it lands on Today instead, Resume must be there
    if (!(await page.locator('#s-workout.screen.on').count())) await page.click('#s-today [data-act=go][data-to=workout]');
    await onScreen(page, 'workout');
    await settle(page);
    const resumed = await doneSets(page);
    if (resumed !== logged) throw new Error(`after reload ${resumed} done sets, expected ${logged}`);

    await page.click('#s-workout [data-act=finish]');
    await page.waitForSelector('.sheet.show [data-k=finish]', { timeout: 6000 });
    await page.click('.sheet.show [data-k=finish]');
    await settle(page, 2500);
    const after = await countWorkouts(page);
    if (after !== before + 1) throw new Error(`history went from ${before} to ${after} workouts, expected +1`);
    await context.close();
    return errors;
  },

  // Installed once, then opened with no network: the app shell still loads.
  offline: async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(base);
    await onScreen(page, 'today');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    });
    await settle(page, 1500); // let the precache finish
    await context.setOffline(true);
    await page.reload();
    await onScreen(page, 'today', 10000);
    await settle(page, 800);
    await context.close();
    return errors.filter(e => !/offline|network|fetch/i.test(e));
  },

  // The dock orb, hold to talk (js/ui/holdtalk.js), with a real finger. Every flow checks: exactly one
  // orb element and at most one frost layer at every frame, and nothing left over when it's done.
  'tap-chat': async (browser, base) => {
    const t = await holdRig(browser, base);
    const { page, finger } = t;
    await installSampler(page);
    await mark(page, 'down');
    await finger.tap();
    await onScreen(page, 'coach');
    await page.waitForFunction(() => !document.getElementById('app').classList.contains('sheetmoving'), null, { timeout: 5000 });
    await settle(page, 1000); // (a tap's click used to land on the frost and close it again)
    const r = await page.evaluate(() => { const c = document.getElementById('s-coach'), a = document.getElementById('app'); return { open: a.classList.contains('chatsheet') && c.classList.contains('on'), y: c.style.transform, top: Math.round(c.getBoundingClientRect().top), home: document.getElementById('orb').parentElement.className, start: +a.dataset.chatStart, max: +a.dataset.chatMax }; });
    if (!r.open) throw new Error('the chat closed again right after the tap');
    if (r.y || r.top > 80) throw new Error(`the chat sheet isn't at its place (transform "${r.y}", top ${r.top})`);
    if (!/corb/.test(r.home)) throw new Error(`the orb didn't land in the message box (it's in ${r.home})`);
    if (Math.abs(r.start - r.max) > 1) throw new Error(`the chat started moving at scrollTop ${r.start}, not its end (${r.max})`);
    await page.goBack();
    await onScreen(page, 'today');
    await mark(page, 'end');
    oneOfEach(await samples(page));
    await nothingLeft(page, 'tap, then back');
    return t.done();
  },

  // P0: the mic opens and audio flows within a second of the hold (also right after a tap on the orb,
  // which used to leave it stuck on "Opening mic" for good).
  'hold-listen': async (browser, base) => {
    const t = await holdRig(browser, base);
    const { page, finger } = t;
    for (const round of ['first hold', 'hold after a tap']) {
      if (round !== 'first hold') {
        await finger.tap();
        await onScreen(page, 'coach');
        await settle(page, 700);
        await page.goBack();
        await onScreen(page, 'today');
        await settle(page, 900);
      }
      await finger.down();
      await page.waitForTimeout(250);
      if (!await listeningWithin(page, 1000)) throw new Error(`${round}: not "Listening" within 1 s of the hold (phase ${await page.evaluate(() => document.getElementById('voice').dataset.phase)})`);
      const st = await audioState(page);
      if (st !== 'running') throw new Error(`${round}: the AudioContext is ${st}, not running`);
      await finger.move(120, 4); // (cancel: nothing is sent)
      await finger.up();
      await nothingLeft(page, round);
    }
    if (t.stt().length) throw new Error(`cancelled holds were transcribed (${t.stt().length})`);
    return t.done();
  },

  'hold-send': async (browser, base) => {
    const t = await holdRig(browser, base);
    const { page, finger } = t;
    await installSampler(page);
    await mark(page, 'down');
    await finger.down();
    await page.waitForTimeout(250);
    if (!await listeningWithin(page, 1000)) throw new Error('not "Listening" within 1 s');
    await settle(page, 1200);
    await finger.up();
    await onScreen(page, 'coach', 8000);
    await page.waitForFunction(() => { const m = [...window.__s.state.chat].reverse().find(x => x.role === 'model' && x.q); return m && m.streaming === false; }, null, { timeout: 15000 });
    await settle(page, 600);
    await mark(page, 'end');
    const stt = t.stt();
    if (stt.length !== 1) throw new Error(`speech-to-text ran ${stt.length} times (expected once)`);
    if (stt[0] < 2000) throw new Error(`the recording sent was empty (${stt[0]} bytes)`);
    const sent = await t.sentMessages();
    if (sent !== 1) throw new Error(`releasing sent ${sent} messages (expected exactly one)`);
    if (!(await page.evaluate(() => window.__vib)).includes(8)) throw new Error('no small buzz when the hold began');
    oneOfEach(await samples(page));
    return t.done();
  },

  'hold-review': async (browser, base) => {
    const t = await holdRig(browser, base);
    const { page, finger } = t;
    await installSampler(page);
    await mark(page, 'down');
    await finger.down();
    await page.waitForTimeout(250);
    if (!await listeningWithin(page, 1000)) throw new Error('not "Listening" within 1 s');
    await settle(page, 500);
    await finger.move(-110);
    await page.waitForSelector('#voice.m-review', { timeout: 3000 });
    if (await page.evaluate(() => document.getElementById('voice').dataset.phase) !== 'listening') throw new Error('the recording stopped when the review sheet opened');
    await settle(page, 900);
    await finger.up();
    await page.waitForFunction(() => document.getElementById('vtext').value.trim().length > 0, null, { timeout: 8000 });
    await settle(page, 1500); // nothing may be sent while you read it over
    if (await t.sentMessages()) throw new Error('the review sheet sent before Send was tapped');
    if (!(await page.evaluate(() => window.__vib)).includes(12)) throw new Error('no buzz when the review sheet locked');
    const look = await page.evaluate(() => ({ ph: document.getElementById('vtext').placeholder, ro: document.getElementById('vtext').readOnly, pill: !!document.querySelector('#vreview .live'), scroll: document.getElementById('vhints').scrollLeft }));
    if (look.ph) throw new Error(`the review sheet looks like a typing screen (placeholder "${look.ph}")`);
    if (!look.ro) throw new Error('the words are editable before they are tapped (the keyboard would come up)');
    if (!look.pill) throw new Error('no status pill in the review sheet');
    await page.click('#vsend');
    await onScreen(page, 'coach', 6000);
    await page.waitForSelector('#voice[hidden]', { state: 'attached', timeout: 6000 });
    await settle(page, 400);
    await mark(page, 'end');
    const sent = await t.sentMessages();
    if (sent !== 1) throw new Error(`Send sent ${sent} messages (expected exactly one)`);
    if (t.stt().length !== 1) throw new Error(`speech-to-text ran ${t.stt().length} times`);
    oneOfEach(await samples(page));
    return t.done();
  },

  // Reduced motion: nothing travels (150 ms fades), but every flow still works and ends in place.
  'reduced-motion': async (browser, base) => {
    const t = await holdRig(browser, base, { reducedMotion: 'reduce' });
    const { page, finger } = t;
    await installSampler(page);
    await mark(page, 'down');
    await finger.tap();
    await onScreen(page, 'coach');
    await settle(page, 600);
    if (!/corb/.test(await page.evaluate(() => document.getElementById('orb').parentElement.className))) throw new Error('reduced motion: the orb is not in the message box');
    await page.goBack();
    await onScreen(page, 'today');
    await nothingLeft(page, 'reduced motion, tap then back');
    await finger.down();
    await page.waitForTimeout(250);
    if (!await listeningWithin(page, 1000)) throw new Error('reduced motion: not "Listening" within 1 s');
    await settle(page, 1000);
    await finger.up();
    await onScreen(page, 'coach', 8000);
    await page.waitForFunction(() => { const m = [...window.__s.state.chat].reverse().find(x => x.role === 'model' && x.q); return m && m.streaming === false; }, null, { timeout: 15000 });
    await mark(page, 'end');
    const sent = await t.sentMessages();
    if (sent !== 1) throw new Error(`reduced motion: releasing sent ${sent} messages`);
    oneOfEach(await samples(page));
    return t.done();
  },

  'hold-cancel': async (browser, base) => {
    for (const how of ['drag', 'pointercancel', 'visibilitychange', 'close']) {
      const t = await holdRig(browser, base);
      const { page, finger } = t;
      await installSampler(page);
      await mark(page, 'down');
      await finger.down();
      await page.waitForTimeout(250);
      await listeningWithin(page, 1000);
      await settle(page, 400);
      if (how === 'drag') { await finger.move(95, 4); await finger.up(); }
      else if (how === 'pointercancel') await finger.cancel();
      else if (how === 'visibilitychange') {
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
        await finger.up();
        await page.evaluate(() => { delete document.hidden; delete document.visibilityState; });
      } else { // close: into the review sheet, let go, then X
        await finger.move(-110); await page.waitForSelector('#voice.m-review', { timeout: 3000 }); await finger.up();
        await settle(page, 1500);
        await page.click('#vreview [data-v=discard]');
      }
      await mark(page, 'end');
      const sent = await t.sentMessages(), coach = await page.evaluate(() => document.getElementById('s-coach').classList.contains('on'));
      if (sent || coach) throw new Error(`${how}: something was sent (${sent} messages, chat open ${coach})`);
      if (how !== 'close' && t.stt().length) throw new Error(`${how}: the recording was transcribed (${t.stt().length})`);
      await nothingLeft(page, how);
      oneOfEach(await samples(page));
      const errs = await t.done();
      if (errs.length) return errs;
    }
    return [];
  },

  // A streamed reply is one message node from its first word to its last: the messages already there
  // stay the same nodes (no list rebuild), the list never blanks, the reply is never drawn twice, and
  // its width doesn't change when it finishes (so its lines can't re-wrap).
  'chat-stream': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page, { delay: 300 });
    await page.addInitScript(k => { localStorage.setItem('setline.keys', JSON.stringify(k)); }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => {
      const s = await import('./js/store.js');
      window.__s = s;
      s.setSettings({ spoken: 'off', weeklyCheckin: false });
      s.addChat('user', 'How was last week?');
      s.addChat('model', 'Four sessions and a record on the bench.');
      for (let i = 0; i < 6; i++) { s.addChat('user', `Question ${i + 1} about my plan?`); s.addChat('model', 'Keep the same plan this week, add a set of rows on Thursday and sleep a little more before the heavy day.'); }
      s.addChat('user', 'Nice.');
    });
    await settle(page, 600);
    await page.click('#dock .orbbtn');
    await onScreen(page, 'coach');
    await settle(page, 1400);
    await page.evaluate(() => {
      window.__before = [...document.getElementById('thread').children];
      window.__frames = [];
      const tick = () => {
        const ol = document.getElementById('thread');
        const reply = window.__replyId && ol ? [...ol.querySelectorAll(`.msg[data-id="${window.__replyId}"]`)] : [];
        const node = reply[0];
        if (node && !window.__replyNode) window.__replyNode = node;
        window.__frames.push({
          kept: window.__before.every(n => n.isConnected && n.parentElement === ol),
          listed: !!ol && ol.children.length >= window.__before.length,
          count: reply.length, same: !node || node === window.__replyNode,
          streaming: !!node?.classList.contains('is-streaming'), w: node?.querySelector('.bub')?.getBoundingClientRect().width || 0
        });
        if (window.__frames.length < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.fill('#composer input', 'How is my bench going?');
    await page.press('#composer input', 'Enter');
    await page.waitForFunction(() => { const m = [...window.__s.state.chat].reverse().find(x => x.role === 'model' && x.q); if (m) window.__replyId = m.id; return !!m; }, null, { timeout: 5000 });
    await page.waitForFunction(() => window.__s.state.chat.find(m => m.id === window.__replyId)?.streaming === false, null, { timeout: 15000 });
    await settle(page, 900);
    const r = await page.evaluate(() => ({ frames: window.__frames, gap: (s => s.scrollHeight - s.clientHeight - s.scrollTop)(document.getElementById('s-coach')), tall: (s => s.scrollHeight > s.clientHeight + 80)(document.getElementById('s-coach')), ai: document.querySelectorAll('#thread .msg.ai').length, models: window.__s.state.chat.filter(m => m.role !== 'user').length, final: document.querySelectorAll(`#thread .msg[data-id="${window.__replyId}"]`).length, sameEnd: document.querySelector(`#thread .msg[data-id="${window.__replyId}"]`) === window.__replyNode }));
    const f = r.frames;
    if (f.some(x => !x.kept)) throw new Error('messages already on screen were redrawn (the list was rebuilt)');
    if (f.some(x => !x.listed)) throw new Error('the message list went blank');
    if (f.some(x => x.count > 1) || r.final !== 1) throw new Error(`the reply was drawn ${Math.max(r.final, ...f.map(x => x.count))} times`);
    if (f.some(x => !x.same) || !r.sameEnd) throw new Error('the streaming reply was replaced by a new node when it finished');
    if (r.ai !== r.models) throw new Error(`${r.ai} Coach messages on screen for ${r.models} in the chat`);
    const lastStream = [...f].reverse().find(x => x.streaming && x.w), firstDone = f.find((x, i) => i > f.indexOf(lastStream) && !x.streaming && x.w);
    if (!lastStream || !firstDone) throw new Error('never saw the reply stream and finish');
    if (Math.abs(lastStream.w - firstDone.w) > 0.5) throw new Error(`the reply changed width when it finished (${lastStream.w} → ${firstDone.w})`);
    // you were at the end when you asked, so the thread followed the reply to its end
    if (!r.tall) throw new Error('the thread is too short to scroll (the follow check needs it to)');
    if (r.gap > 80) throw new Error(`the thread didn't follow the reply (${Math.round(r.gap)} px from the end)`);
    await context.close();
    return errors;
  },

  // Every main tab opens without throwing.
  'tabs-open': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    for (const tab of ['food', 'you', 'today']) {
      await page.click(`#dock .tab[data-to=${tab}]`);
      await onScreen(page, tab);
      await settle(page, 700);
    }
    await page.click('#dock .orbbtn');
    await onScreen(page, 'coach');
    await settle(page, 1200);
    await context.close();
    return errors;
  }
};

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  let failed = 0;
  try {
    for (const [name, flow] of Object.entries(FLOWS)) {
      if (ONLY && !ONLY.some(o => name.includes(o))) continue;
      const t0 = Date.now();
      try {
        const errors = await flow(browser, base);
        if (errors.length) throw new Error('page errors: ' + [...new Set(errors)].join(' | '));
        console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      } catch (e) {
        failed++;
        console.error(`  ✗ ${name}: ${String(e.message).split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) { console.error(`${failed} golden flow(s) failed`); process.exit(1); }
  console.log('All golden flows passed');
}

main().catch(e => { console.error(e); process.exit(1); });
