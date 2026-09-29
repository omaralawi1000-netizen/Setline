// Golden flows: the few user journeys Setline is never allowed to break, run in a real browser.
//   npm run golden            all flows
//   npm run golden -- --only=offline
// Exit code 1 if any flow fails or the page throws an error. Nothing leaves the machine except
// Google Fonts. Selectors are the app's own data-act / data-k hooks: a redesign must keep them
// (or update this file in the same change).
import { launch, newPage, serve, settle, onScreen } from './lib/harness.mjs';
import { STAND_IN, mockServices, installSampler, mark, samples, between } from './lib/voiceflow.mjs';
import { streamReplies, probeReply } from './lib/sse.mjs';

// chat-stream is 1.60's in-place chat, which the master fix's phase 3 brings to this design: until then
// it reports without failing.
const ADVISORY = new Set();
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

  // 1.59.1's voice flow: hold the dock orb → the floating orb lifts over the page and listens → pull up
  // into the voice screen → release (your words to check) → Send → the question goes to the Coach, once. From the moment the
  // floating orb is up until the voice screen hands over, the page is always covered (the floating
  // orb's scrim or the voice screen's backdrop: both fading at once used to let the page show through).
  'voice-to-coach': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page);
    await page.addInitScript(k => { localStorage.setItem('setline.keys', JSON.stringify(k)); }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => { const s = await import('./js/store.js'); s.setSettings({ spoken: 'off' }); });
    await settle(page, 1000);
    await page.evaluate(() => {
      window.__cover = [];
      const op = el => { if (!el || el.closest('[hidden]')) return 0; let o = 1; for (let n = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
      const tick = () => {
        const mini = document.getElementById('ofloat'), full = document.getElementById('voice');
        window.__cover.push({ t: performance.now(), mini: !mini.hidden, full: !full.hidden, cover: Math.max(op(mini.querySelector('.oscrim')), op(full.querySelector('.vbg'))) });
        if (window.__cover.length < 4000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const orb = await page.locator('#dock .orbbtn').boundingBox();
    const x = orb.x + orb.width / 2, y = orb.y + orb.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForSelector('#ofloat.on', { timeout: 4000 });
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 });
    const upAt = await page.evaluate(() => performance.now());
    await settle(page, 700);
    for (let dy = 10; dy <= 180; dy += 10) await page.mouse.move(x, y - dy);
    await page.waitForSelector('#voice.on[data-phase=listening]', { timeout: 4000 });
    await settle(page, 900);
    const relAt = await page.evaluate(() => performance.now());
    await page.mouse.up();
    // pulled up: your words to check first, then Send hands over to the Coach
    await page.waitForSelector('#voice.reviewing #vrtext:not(:empty)', { timeout: 6000 });
    await settle(page, 500);
    await installSampler(page);
    await mark(page, 'release');
    await page.click('#vreview .vrsend');
    await onScreen(page, 'coach', 10000);
    await page.waitForSelector('#voice[hidden]', { state: 'attached', timeout: 6000 });
    await settle(page, 700);
    const frames = await page.evaluate(() => window.__cover);
    // covered from once the scrim has faded in (0.4 s) until release
    const open = frames.filter(f => f.t > upAt + 450 && f.t < relAt && (f.mini || f.full));
    const thin = open.filter(f => f.cover < 0.9);
    if (!open.length) throw new Error('never saw the floating orb or the voice screen');
    if (thin.length) throw new Error(`the page showed through in ${thin.length} of ${open.length} frames (cover ${Math.min(...thin.map(f => f.cover)).toFixed(2)})`);
    const users = await page.locator('#s-coach .msg.me').count();
    if (users !== 1) throw new Error(`expected the question once in the chat, found ${users}`);
    // from release into the Coach: one orb on screen at every frame, and Home never shows
    const after = between(await samples(page), 'release');
    const two = after.filter(x => x.orbs > 1);
    if (two.length) throw new Error(`${two.length} frame(s) with ${Math.max(...two.map(x => x.orbs))} orbs on screen (${two[0].orbIds})`);
    const coachAt = after.find(x => x.coaching)?.t;
    const home = after.filter(x => coachAt && x.t >= coachAt && x.todayOp > 0.02);
    if (home.length) throw new Error(`Home showed in ${home.length} frame(s) on the way into the Coach`);
    await context.close();
    return errors;
  },

  // Tap the orb: the Coach opens (the orb flies into the message box); Back: Home again. One orb on
  // screen at every frame, and never two full screens readable at once.
  'home-coach': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => { const s = await import('./js/store.js'); s.setSettings({ weeklyCheckin: false }); s.addChat('user', 'How was last week?'); s.addChat('model', 'Four sessions and a record on the bench.'); });
    await settle(page, 1000);
    await installSampler(page);
    await mark(page, 'open');
    await page.click('#dock .orbbtn');
    await onScreen(page, 'coach');
    await settle(page, 1300);
    await mark(page, 'back');
    await page.goBack();
    await onScreen(page, 'today');
    await settle(page, 1300);
    await mark(page, 'end');
    const rec = between(await samples(page), 'open', 'end');
    const two = rec.filter(x => x.orbs > 1);
    if (two.length) throw new Error(`${two.length} frame(s) with ${Math.max(...two.map(x => x.orbs))} orbs on screen (${two[0].orbIds})`);
    const both = rec.filter(x => x.todayOp > 0.35 && x.coachOp > 0.35);
    if (both.length) throw new Error(`${both.length} frame(s) with Home and the Coach both readable (${both[0].todayOp.toFixed(2)} / ${both[0].coachOp.toFixed(2)})`);
    await context.close();
    return errors;
  },

  // A reply read out loud: from its first word to the end of the reading it is one message, its words
  // shown once (the reading marks its sentences in place, never a second copy), at one width.
  'spoken-reply': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page, { delay: 200 });
    await page.addInitScript(k => { localStorage.setItem('setline.keys', JSON.stringify(k)); }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => { const s = await import('./js/store.js'); window.__s = s; s.setSettings({ spoken: 'on', weeklyCheckin: false }); });
    await settle(page, 600);
    await page.click('#dock .orbbtn');
    await onScreen(page, 'coach');
    await settle(page, 1200);
    await page.fill('#composer input', 'How is my bench going?');
    await page.press('#composer input', 'Enter');
    await page.waitForFunction(() => { const m = [...window.__s.state.chat].reverse().find(x => x.role === 'model' && x.q); if (m) window.__replyId = m.id; return !!m; }, null, { timeout: 5000 });
    await page.evaluate(() => {
      window.__f = [];
      const tick = () => {
        const nodes = document.querySelectorAll(`#thread .msg[data-id="${window.__replyId}"]`);
        const txt = document.getElementById('thread')?.textContent || '';
        window.__f.push({ n: nodes.length, twice: (txt.match(/Your bench is moving well/g) || []).length, w: nodes[0]?.querySelector('.bub')?.getBoundingClientRect().width || 0, streaming: !!nodes[0]?.classList.contains('is-streaming') });
        if (window.__f.length < 1500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.waitForFunction(() => window.__s.state.chat.find(m => m.id === window.__replyId)?.streaming === false, null, { timeout: 15000 });
    await settle(page, 3000); // the reading (or the phone's voice falling back) marks its sentences
    const f = await page.evaluate(() => window.__f);
    if (f.some(x => x.n > 1)) throw new Error('the reply was drawn twice');
    if (f.some(x => x.twice > 1)) throw new Error('the reply\'s words showed twice');
    const done = f.filter(x => !x.streaming && x.w), ws = new Set(done.map(x => Math.round(x.w)));
    if (ws.size > 1) throw new Error(`the finished reply changed width while being read (${[...ws].join(', ')} px)`);
    await context.close();
    return errors;
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

  // The voice gestures, each from a fresh start with a fake microphone and speech-to-text mocked:
  // hold → listening within a second; hold + release → exactly one send; hold + pull up + release →
  // nothing sent until Send, then one; drag down → nothing; tap → the Coach, fully. Nothing left
  // behind after any of them.
  'voice-gestures': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page);
    let stt = 0;
    page.on('request', r => { if (/api\.groq\.com/.test(r.url())) stt++; });
    await page.addInitScript(k => { localStorage.setItem('setline.keys', JSON.stringify(k)); }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => { const s = await import('./js/store.js'); window.__s = s; s.setSettings({ spoken: 'off', weeklyCheckin: false }); });
    await settle(page, 1000);
    const orb = await page.locator('#dock .orbbtn').boundingBox();
    const x = orb.x + orb.width / 2, y = orb.y + orb.height / 2;
    const sent = () => page.evaluate(() => window.__s.state.chat.filter(m => m.role === 'user').length);
    const home = async () => { if (await page.locator('#s-coach.screen.on').count()) { await page.goBack(); await onScreen(page, 'today'); } await settle(page, 900); };
    const clean = async what => {
      await settle(page, 900);
      const left = await page.evaluate(() => {
        const app = document.getElementById('app'), bad = [];
        for (const c of ['voice', 'voice-mini', 'orbaway', 'orbtravel', 'voice-covered', 'bg-still']) if (app.classList.contains(c)) bad.push('.' + c);
        if (!document.getElementById('voice').hidden) bad.push('#voice shown');
        if (!document.getElementById('ofloat').hidden) bad.push('#ofloat shown');
        if (document.querySelector('.orbghost, .orbstreak')) bad.push('a flight left over');
        return bad;
      });
      if (left.length) throw new Error(`after ${what}: ${left.join(', ')}`);
    };
    // 1. hold: listening within a second
    const t0 = Date.now();
    await page.mouse.move(x, y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 3000 });
    const ms = Date.now() - t0;
    if (ms > 1000) throw new Error(`listening only after ${ms} ms`);
    // …and released: exactly one send
    await settle(page, 900);
    await page.mouse.up();
    await onScreen(page, 'coach', 8000);
    await settle(page, 800);
    if (stt !== 1 || await sent() !== 1) throw new Error(`hold + release: ${stt} transcription(s), ${await sent()} message(s) sent (expected 1, 1)`);
    await home(); await clean('hold + release');
    // 2. hold, pull up, release: nothing sent until Send
    stt = 0;
    const before = await sent();
    await page.mouse.move(x, y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 3000 });
    await settle(page, 500);
    for (let dy = 10; dy <= 180; dy += 10) await page.mouse.move(x, y - dy);
    await page.waitForSelector('#voice.on', { timeout: 3000 });
    await settle(page, 900);
    await page.mouse.up();
    await page.waitForSelector('#voice.reviewing #vrtext:not(:empty)', { timeout: 6000 });
    await settle(page, 1200);
    if (await sent() !== before) throw new Error('pull up + release sent something before Send');
    if (await page.locator('#s-coach.screen.on').count()) throw new Error('pull up + release went to the Coach before Send');
    await page.click('#vreview .vrsend');
    await onScreen(page, 'coach', 8000);
    await settle(page, 800);
    if (await sent() !== before + 1) throw new Error(`after Send: ${await sent() - before} message(s) sent (expected 1)`);
    await home(); await clean('review + Send');
    // 3. hold, drag down: nothing sent
    stt = 0;
    const b3 = await sent();
    await page.mouse.move(x, y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 3000 });
    await settle(page, 500);
    for (let dy = 10; dy <= 110; dy += 10) await page.mouse.move(x, y + dy);
    await page.mouse.up();
    await settle(page, 1500);
    if (stt || await sent() !== b3) throw new Error(`drag down: ${stt} transcription(s), ${await sent() - b3} message(s) sent (expected none)`);
    await clean('drag down');
    // 4. tap: the Coach opens, fully
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up();
    await onScreen(page, 'coach', 4000);
    await settle(page, 1200);
    const full = await page.evaluate(() => { const c = document.getElementById('composer'); return +getComputedStyle(c).opacity > 0.99 && +getComputedStyle(document.getElementById('s-coach')).opacity > 0.99; });
    if (!full) throw new Error('the Coach did not open fully on a tap');
    await home(); await clean('tap');
    await context.close();
    return errors;
  },

  // The mic never opens (getUserMedia never answers): after 4 s it says so, with a way to retry, and
  // letting go sends nothing.
  'mic-stuck': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page);
    await page.addInitScript(k => {
      localStorage.setItem('setline.keys', JSON.stringify(k));
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await settle(page, 900);
    const orb = await page.locator('#dock .orbbtn').boundingBox();
    await page.mouse.move(orb.x + orb.width / 2, orb.y + orb.height / 2);
    await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=stuck]', { timeout: 6000 });
    const says = await page.locator('#ostatus').textContent();
    if (!/retry/i.test(says)) throw new Error(`the floating orb says "${says}", not that the mic didn't start`);
    await page.mouse.up();
    await settle(page, 800);
    const sent = await page.evaluate(async () => (await import('./js/store.js')).state.chat.filter(m => m.role === 'user').length);
    if (sent) throw new Error('something was sent without a mic');
    await context.close();
    return errors.filter(e => !/mic did not start/.test(e));
  },

  // A reply streamed for real (an SSE body read chunk by chunk, see lib/sse.mjs): plain, ending in an
  // action chip, ending in a memory, and a long one in 200 chunks. On every frame from its first word
  // to 1.5 s after the stream ends, its first sentence shows once, the thread has one more Coach message
  // than before, and the thread never jumps back while it follows the reply. The chip arrives.
  'reply-real-stream': async (browser, base) => {
    const long = Array.from({ length: 24 }, (_, i) => `Point ${i + 1}: keep the bar path tight and breathe before each rep.`).join(' ');
    const cases = [
      { name: 'plain', first: 'Your bench is moving well.', text: 'Your bench is moving well. You added 2.5 kg in two weeks, so keep the same plan and aim for eight reps next time, then add a little weight when all three sets feel smooth.' },
      { name: 'action', first: 'If your body is truly beaten up, take today as a full rest day.', chip: 'Rest today', text: 'If your body is truly beaten up, take today as a full rest day. But if it is just low energy, eat a good meal now and show up just to drill technique. Either way, eat and recharge for tomorrow\'s back and triceps.\nACTION: {"label":"Rest today","do":"rest today"}' },
      { name: 'memory', first: 'Got it, wrestling on Tuesdays and Thursdays.', text: 'Got it, wrestling on Tuesdays and Thursdays. I will keep heavy legs away from those days and put them on Monday instead, with a lighter pull day before the mat.\nREMEMBER: Wrestles on Tuesdays and Thursdays.' },
      { name: '200 chunks', first: 'Point 1: keep the bar path tight', chunks: 200, every: 25, text: long }
    ];
    const { context, page, errors } = await newPage(browser, base);
    await streamReplies(page, cases.map(c => ({ text: c.text, chunks: c.chunks || 64, every: c.every ?? 40 })));
    await page.addInitScript(k => { localStorage.setItem('setline.keys', JSON.stringify(k)); }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => {
      const s = await import('./js/store.js');
      window.__s = s;
      s.setSettings({ spoken: 'off', weeklyCheckin: false });
      for (let i = 0; i < 5; i++) { s.addChat('user', `Question ${i + 1} about my plan?`); s.addChat('model', 'Keep the same plan this week, add a set of rows on Thursday and sleep a little more before the heavy day.'); }
    });
    await settle(page, 600);
    await page.click('#dock .orbbtn');
    await onScreen(page, 'coach');
    await settle(page, 1300);
    const bad = [];
    for (const [i, c] of cases.entries()) {
      const aiBefore = await page.locator('#thread > .msg.ai').count();
      await probeReply(page, c.first);
      await page.fill('#composer input', `Question for the ${c.name} reply?`);
      await page.press('#composer input', 'Enter');
      await page.waitForFunction(n => window.__sse.ended[n] != null, i, { timeout: 30000 });
      await page.waitForFunction(() => { const m = [...window.__s.state.chat].reverse().find(x => x.role === 'model' && x.q); return m && m.streaming === false; }, null, { timeout: 30000 });
      await settle(page, 1500);
      const r = await page.evaluate(() => ({ f: window.__probe.splice(0), chips: [...document.querySelectorAll('#thread > .msg.ai:last-child .dochip')].map(b => b.textContent.trim()) }));
      const f = r.f, from = f.findIndex(x => x.copies > 0);
      const seen = from < 0 ? [] : f.slice(from);
      const twice = seen.filter(x => x.copies > 1).length, maxAi = Math.max(...seen.map(x => x.ai));
      // a jump: the thread moved back (up) by itself while it was following the end
      let jumps = 0;
      for (let k = 1; k < seen.length; k++) if (seen[k - 1].gap < 80 && seen[k].top < seen[k - 1].top - 2) { jumps++; if (process.env.JUMPS) console.log('      jump', JSON.stringify(seen.slice(Math.max(0, k - 3), k + 3).map(x => [Math.round(x.t), Math.round(x.top), Math.round(x.gap), x.copies]))); }
      const line = `${c.name}: ${seen.length} frames, ${twice} with the reply twice, up to ${maxAi - aiBefore} new Coach message node(s), ${jumps} jump(s)`;
      console.log('    ' + line + (c.chip ? `, chip: ${r.chips.join(', ') || 'none'}` : ''));
      if (from < 0) bad.push(`${c.name}: the reply never showed`);
      if (twice) bad.push(`${c.name}: the reply showed twice in ${twice} frame(s)`);
      if (maxAi - aiBefore > 1) bad.push(`${c.name}: ${maxAi - aiBefore} Coach message nodes for one reply`);
      if (jumps) bad.push(`${c.name}: the thread jumped ${jumps} time(s)`);
      if (c.chip && !r.chips.includes(c.chip)) bad.push(`${c.name}: no "${c.chip}" chip`);
    }
    if (bad.length) throw new Error(bad.join('; '));
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
        if (ADVISORY.has(name)) { console.warn(`  ⚠ ${name} (advisory): ${String(e.message).split('\n')[0]}`); continue; }
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
