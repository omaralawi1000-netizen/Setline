// Golden flows: the few user journeys Setline is never allowed to break, run in a real browser.
//   npm run golden            all flows
//   npm run golden -- --only=offline
// Exit code 1 if any flow fails or the page throws an error. Nothing leaves the machine except
// Google Fonts. Selectors are the app's own data-act / data-k hooks: a redesign must keep them
// (or update this file in the same change).
import { launch, newPage, serve, settle, onScreen } from './lib/harness.mjs';
import { voicePage, visibleOrbs } from './lib/voicemock.mjs';

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

  // Every main tab opens without throwing.
  // Home ↔ Coach: Home is gone before the Coach's words arrive, both ways (never two pages at once).
  'home-coach': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    const o = await voicePage(page, base);
    await page.evaluate(async () => { const s = await import('./js/store.js'); s.addChat('user', 'How was last week?'); s.addChat('model', 'Four sessions and a record on the bench.'); });
    await settle(page, 400);
    await page.evaluate(() => { window.__both = 0; const t0 = performance.now(); const op = el => { let a = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; a *= +cs.opacity; } return a; };
      const f = () => { const h = op(document.querySelector('#s-today .h1, #s-today h1') || document.getElementById('s-today')), c = op(document.querySelector('#s-coach .coachhead') || document.getElementById('s-coach')); if (h > 0.3 && c > 0.3) window.__both++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.mouse.move(o.x, o.y); await page.mouse.down(); await page.mouse.up();
    await onScreen(page, 'coach'); await settle(page, 1200);
    await page.goBack(); await onScreen(page, 'today'); await settle(page, 1200);
    const both = await page.evaluate(() => window.__both);
    if (both > 1) throw new Error(`Home and the Coach were both on screen in ${both} frames`);
    await context.close();
    return errors;
  },

  // A question said to the floating orb: straight into the Coach (never back to Home first), one orb
  // the whole time, your words as your message, the reply streamed, and Back returns Home.
  'voice-to-coach': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    const o = await voicePage(page, base);
    await page.mouse.move(o.x, o.y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 });
    await settle(page, 900);
    const seen = new Set();
    await page.evaluate(() => { window.__home = 0; const f = () => { const h = document.getElementById('s-today'); const fr = document.querySelector('#ofloat .oscrim'), frost = fr && !document.getElementById('ofloat').hidden ? +getComputedStyle(fr).opacity : 0; if (document.getElementById('app').classList.contains('coaching') && h && +getComputedStyle(h).opacity > 0.3 && frost < 0.6) window.__home++; if (performance.now() < 1e9) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.mouse.up();
    for (let i = 0; i < 40; i++) { const n = await visibleOrbs(page); if (n.length > 1) seen.add(n.join('+')); await page.waitForTimeout(40); }
    await onScreen(page, 'coach');
    await page.waitForFunction(() => /bench is moving well/.test(document.querySelector('#thread')?.textContent || ''), null, { timeout: 12000 });
    const mine = await page.locator('#thread > .msg.me').last().textContent();
    if (!/bench going/.test(mine)) throw new Error(`your words didn't become your message (${mine})`);
    if (seen.size) throw new Error(`two orbs at once: ${[...seen].join(', ')}`);
    if (await page.evaluate(() => window.__home)) throw new Error('Home showed through the Coach');
    await settle(page, 600);
    await page.goBack();
    await onScreen(page, 'today');
    await context.close();
    return errors;
  },

  // The same from the full voice screen (hold, pull up, let go).
  'voice-screen-to-coach': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    const o = await voicePage(page, base);
    await page.mouse.move(o.x, o.y); await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 });
    for (let dy = 10; dy <= 200; dy += 10) await page.mouse.move(o.x, o.y - dy);
    await page.waitForSelector('#voice.on', { timeout: 4000 });
    await settle(page, 700);
    const up = await visibleOrbs(page);
    if (up.length !== 1) throw new Error(`the voice screen shows ${up.length} orbs (${up.join(', ')})`);
    // from here the page must never come back into view: the voice screen clears onto the Coach
    await page.evaluate(() => { window.__home = 0; const t0 = performance.now(); const f = () => { const h = document.getElementById('s-today'), bg = document.querySelector('#voice .vbg'), cover = document.getElementById('voice').hidden ? 0 : +getComputedStyle(bg).opacity; if (h && +getComputedStyle(h).opacity > 0.3 && getComputedStyle(h).visibility !== 'hidden' && cover < 0.6) window.__home++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.mouse.up();
    await onScreen(page, 'coach', 10000);
    await page.waitForFunction(() => /bench going/.test([...document.querySelectorAll('#thread > .msg.me')].pop()?.textContent || ''), null, { timeout: 8000 });
    await settle(page, 900);
    if (!(await page.locator('#voice').isHidden())) throw new Error('the voice screen stayed up');
    if (await page.evaluate(() => window.__home)) throw new Error('the voice screen went back to Home before the Coach');
    await context.close();
    return errors;
  },

  // Hold, let go, and hold again straight away (over the floating orb's frost): the second hold talks.
  'mic-hold-twice': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    const o = await voicePage(page, base, { heard: 'Bench press 80 kilo 8 reps', micDelay: 300 });
    await page.mouse.move(o.x, o.y); await page.mouse.down(); await page.waitForTimeout(350); await page.mouse.up();
    await page.waitForTimeout(90);
    await page.mouse.down(); await page.waitForTimeout(1100);
    const phase = await page.evaluate(() => document.getElementById('ofloat').hidden ? 'closed' : document.getElementById('ofloat').dataset.phase);
    if (phase !== 'listening') throw new Error(`the second hold didn't open the mic (${phase})`);
    await page.mouse.up();
    await settle(page, 1500);
    await context.close();
    return errors;
  },

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
