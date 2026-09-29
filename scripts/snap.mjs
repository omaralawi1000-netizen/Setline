// Look at the UI: main screens, Today scrolled, plus a frame every 100 ms through the voice flow.
//   node scripts/snap.mjs            → /tmp/snaps (never committed)
// Voice flow (1.59.1's design): hold the dock orb → the floating orb lifts over the page → pull up
// into the voice screen → release → your words to check → Send → the Coach, and the reply streams in.
// Frames: /tmp/snaps/orb-frames/NN-<where>-<phase>.png, so animations can be judged frame by frame.
// Serves the repo root locally on dev seed data; Groq/Google are mocked, nothing else leaves the machine.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, launch, newPage, settle, onScreen, VIEWPORT } from './lib/harness.mjs';
import { mockServices, STAND_IN } from './lib/voiceflow.mjs';

const OUT = process.env.SNAPS || '/tmp/snaps';
const FRAME_MS = 100;

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'orb-frames'), { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  console.log(`Setline snaps at ${VIEWPORT.width}×${VIEWPORT.height} → ${OUT}`);
  let failed = false;
  try {
    const { context, page, errors } = await newPage(browser, base);
    await mockServices(page, { delay: 400, reply: 'Your bench is moving well. You added 2.5 kg in two weeks, so keep the same plan and aim for eight reps next time, then add a little weight when all three sets feel smooth.' });
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(async () => {
      const s = await import('./js/store.js');
      s.setSettings({ spoken: 'off', weeklyCheckin: false });
      s.addChat('user', 'How was last week?');
      s.addChat('model', 'Four sessions and a record on the bench.');
      await document.fonts.ready;
    });
    await settle(page, 1600);

    const shot = async name => { await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('  ' + name + '.png'); };
    await shot('01-home');
    // Today scrolled: the bar collapses to the pill and the edges frost over the content
    await page.evaluate(() => document.getElementById('s-today').scrollTo(0, 420));
    await settle(page, 900);
    await shot('02-home-scrolled');
    await page.evaluate(() => document.getElementById('s-today').scrollTo(0, 0));
    await settle(page, 700);
    for (const [i, tab] of ['food', 'you'].entries()) {
      await page.click(`#dock .tab[data-to=${tab}]`);
      await onScreen(page, tab);
      await settle(page);
      await shot(`0${i + 3}-${tab}`);
    }
    await page.click('#dock .tab[data-to=today]');
    await onScreen(page, 'today');
    await settle(page, 900);

    // the voice flow, a frame every 100 ms from the hold to the end of the Coach's reply
    await page.evaluate(k => localStorage.setItem('setline.keys', JSON.stringify(k)), STAND_IN);
    const box = await page.locator('#dock .orbbtn').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    let n = 0, frameDir = 'orb-frames';
    const frame = async () => {
      const where = await page.evaluate(() => {
        const app = document.getElementById('app'), v = document.getElementById('voice'), o = document.getElementById('ofloat');
        if (app.classList.contains('coaching')) return 'coach-' + (app.classList.contains('thinking') ? 'thinking' : 'reply');
        if (v && !v.hidden) return 'full-' + (v.dataset.phase || 'idle');
        if (o && !o.hidden) return 'mini-' + (o.dataset.phase || 'idle');
        return 'home';
      });
      await page.screenshot({ path: join(OUT, `${frameDir}/${String(++n).padStart(2, '0')}-${where}.png`) });
    };
    const film = async ms => { const end = Date.now() + ms; while (Date.now() < end) { const t0 = Date.now(); await frame(); await page.waitForTimeout(Math.max(0, FRAME_MS - (Date.now() - t0))); } };
    await page.mouse.move(x, y);
    await page.mouse.down();
    await film(1500);                                               // the floating orb lifts and listens
    for (let dy = 12; dy <= 180; dy += 12) { await page.mouse.move(x, y - dy); if (dy % 36 === 0) await frame(); }
    await film(1500);                                               // the voice screen, still listening
    await page.mouse.up();
    await film(1800);                                               // pulled up: what you said, to check
    await page.click('#vreview .vrsend');
    await film(4000);                                               // Send → Coach, the reply streams in
    console.log(`  orb-frames/ (${n} frames, ~${FRAME_MS} ms apart plus screenshot time)`);
    await shot('05-coach-after-voice');
    // the other two flows, each in its own folder: a quick release over the floating orb, and the orb
    // tapped (Home → Coach) then Back
    const flow = async (dir, steps) => { await mkdir(join(OUT, dir), { recursive: true }); const was = n; n = 0; const keep = frame; frameDir = dir; await steps(); frameDir = 'orb-frames'; console.log(`  ${dir}/ (${n} frames)`); n = was; void keep; };
    await page.goBack(); await onScreen(page, 'today'); await settle(page, 1200);
    await flow('quick-frames', async () => { await page.mouse.move(x, y); await page.mouse.down(); await film(1300); await page.mouse.up(); await film(3000); });
    await page.goBack(); await onScreen(page, 'today'); await settle(page, 1200);
    await flow('coach-frames', async () => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await film(1400); await page.goBack(); await film(1400); });
    if (errors.length) { failed = true; console.error('  page errors:\n   ' + errors.join('\n   ')); }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
