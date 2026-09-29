// The big transitions, filmed and checked:
//   node scripts/choreo.mjs                     all four flows
//   node scripts/choreo.mjs --only=home-to-coach
//   node scripts/choreo.mjs --film=0            only the checks (no slowed pictures)
// For each flow: pictures of it at ?slowmo=6 (a picture every ~100 ms, so one every ~16 ms of the
// real transition) in /tmp/choreo/<flow>/, never committed; then the same flow at full speed with the
// frame probe and the compositor's own frames, and what broke (see lib/choreo.mjs judge()).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, newPage, serve } from './lib/harness.mjs';
import { FLOWS, PRE, setupCoachPage, checkFlow } from './lib/choreo.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = arg('only')?.split(',');
const FILM = arg('film') !== '0';
const OUT = process.env.CHOREO || '/tmp/choreo';
const N = 6;

async function film(browser, base, name) {
  const dir = join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const { context, page } = await newPage(browser, base);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await setupCoachPage(page, base, { slowmo: N });
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / N });
  if (PRE[name]) await FLOWS[PRE[name]](page, N);
  let on = true, n = 0;
  const shots = (async () => {
    while (on) {
      const t0 = Date.now();
      await page.screenshot({ path: join(dir, `${String(++n).padStart(3, '0')}.png`), scale: 'css' });
      await page.waitForTimeout(Math.max(0, 100 - (Date.now() - t0)));
    }
  })();
  await FLOWS[name](page, N);
  on = false;
  await shots;
  await context.close();
  return n;
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  const report = {};
  let failed = 0;
  try {
    for (const name of Object.keys(FLOWS)) {
      if (ONLY && !ONLY.some(o => name.includes(o))) continue;
      const pics = FILM ? await film(browser, base, name) : 0;
      const r = await checkFlow(browser, base, name, { reduced: process.argv.includes('--reduced') });
      report[name] = r;
      const lum = r.lum.length ? `luminance ${Math.min(...r.lum).toFixed(1)}–${Math.max(...r.lum).toFixed(1)} (ends ${r.lum[0]} → ${r.lum[r.lum.length - 1]})` : '';
      console.log(`${r.bad.length ? '✗' : '✓'} ${name}: ${r.frames} frames${pics ? `, ${pics} slowed pictures` : ''}, ${lum}`);
      for (const b of r.bad) console.log('    ' + b);
      if (r.errors.length) console.log('    page errors: ' + r.errors.join(' | '));
      if (r.bad.length) failed++;
    }
  } finally {
    await browser.close();
    server.close();
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
