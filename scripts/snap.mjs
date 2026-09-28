// Look at the UI: main screens plus a frame every 100 ms through the voice orb interaction.
//   node scripts/snap.mjs            → /tmp/snaps (never committed)
// Frames: /tmp/snaps/orb-frames/NN-<phase>.png, so animations can be judged frame by frame.
// Serves the repo root locally on dev seed data; Groq/Google are mocked, nothing else leaves the machine.
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, launch, newPage, settle, onScreen, VIEWPORT } from './lib/harness.mjs';
import { mockServices, STAND_IN } from './lib/voiceflow.mjs';

const OUT = '/tmp/snaps';
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
    await mockServices(page);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 1600);

    const shot = async name => { await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('  ' + name + '.png'); };
    await shot('01-home');
    for (const [i, tab] of ['food', 'you'].entries()) {
      await page.click(`#dock .tab[data-to=${tab}]`);
      await onScreen(page, tab);
      await settle(page);
      await shot(`0${i + 2}-${tab}`);
    }
    await page.click('#dock .tab[data-to=today]');
    await onScreen(page, 'today');
    await settle(page, 900);

    // voice orb: hold, release, capture every 100 ms until the sheet is done
    await page.evaluate(k => localStorage.setItem('setline.keys', JSON.stringify(k)), STAND_IN);
    const box = await page.locator('#dock .orbbtn').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    let n = 0, released = false;
    const frame = async () => {
      const phase = await page.evaluate(() => document.getElementById('voice')?.dataset.phase || 'idle');
      const file = `orb-frames/${String(++n).padStart(2, '0')}-${phase}.png`;
      await page.screenshot({ path: join(OUT, file) });
    };
    const start = Date.now();
    await page.mouse.move(x, y);
    await page.mouse.down();
    while (Date.now() - start < 6000) {
      const t0 = Date.now();
      await frame();
      if (!released && Date.now() - start > 1800) { await page.mouse.up(); released = true; }
      await page.waitForTimeout(Math.max(0, FRAME_MS - (Date.now() - t0)));
    }
    console.log(`  orb-frames/ (${n} frames, ~${FRAME_MS} ms apart plus screenshot time)`);
    if (errors.length) { failed = true; console.error('  page errors:\n   ' + errors.join('\n   ')); }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
