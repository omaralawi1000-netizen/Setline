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

  // Hold the orb → talk → release → the question goes to the Coach. One listening UI (the sheet),
  // one orb on screen at every frame, the sheet's top bar and controls there from open to handoff,
  // and Home never shows on the way from the sheet into the chat.
  'voice-to-coach': async (browser, base) => {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page);
    await page.addInitScript(k => { localStorage.setItem('setline.keys', JSON.stringify(k)); }, STAND_IN);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => { const s = await import('./js/store.js'); s.setSettings({ spoken: 'off' }); });
    await settle(page, 1000);
    await installSampler(page);
    const orb = await page.locator('#dock .orbbtn').boundingBox();
    await page.mouse.move(orb.x + orb.width / 2, orb.y + orb.height / 2);
    await mark(page, 'down');
    await page.mouse.down();
    await page.waitForSelector('#voice.on', { timeout: 4000 });
    await mark(page, 'open');
    if (await page.locator('#ofloat:not([hidden])').count()) throw new Error('the floating orb over Home showed (a second listening UI)');
    await page.waitForSelector('#voice[data-phase=listening]', { timeout: 6000 });
    await settle(page, 1500);
    await mark(page, 'release');
    await page.mouse.up();
    await onScreen(page, 'coach', 10000);
    await page.waitForSelector('#voice[hidden]', { state: 'attached', timeout: 6000 });
    await settle(page, 700);
    await mark(page, 'end');
    const rec = await samples(page);
    const all = between(rec, 'down', 'end');
    const two = all.filter(x => x.orbs > 1);
    if (two.length) throw new Error(`${two.length} frame(s) with ${Math.max(...two.map(x => x.orbs))} orbs on screen (${two[0].orbIds})`);
    const openAt = rec.marks.find(m => m.name === 'open').t;
    const handoff = all.find(x => x.handoff)?.t;
    if (!handoff) throw new Error('the sheet never handed over to the Coach');
    const session = all.filter(x => x.t > openAt + 600 && x.t < handoff);
    const gone = session.filter(x => !x.chrome);
    if (gone.length) throw new Error(`the sheet's top bar or controls were missing in ${gone.length} of ${session.length} frames (${gone[0].why})`);
    const home = all.filter(x => x.t >= handoff && x.home);
    if (home.length) throw new Error(`Home showed in ${home.length} frame(s) on the way to the Coach`);
    const users = await page.locator('#s-coach .msg.me').count();
    if (users !== 1) throw new Error(`expected the question once in the chat, found ${users}`);
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
