// Visual baselines: pictures of the main screens compared against approved ones, so a change can't
// quietly make the app look worse.
//   npm run visual              take pictures into visual/current/ and compare with visual/baseline/
//   npm run visual -- --approve make the current pictures the new baseline (only when Omar approved the look)
// Pictures are steady on purpose: reduced motion, a fixed clock, seed data, phone size. A screen
// counts as CHANGED when more than 0.3% of its pixels moved noticeably; visual/diff/ shows where.
// Exit code 1 if anything changed or is missing, so an agent has to look and explain.
import { mkdir, rm, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launch, newPage, serve, settle, onScreen } from './lib/harness.mjs';

const DIR = join(ROOT, 'visual');
const CUR = join(DIR, 'current'), BASE = join(DIR, 'baseline'), DIFF = join(DIR, 'diff');
const APPROVE = process.argv.includes('--approve');
const LIMIT = 0.003;             // share of pixels allowed to differ
const FIXED = new Date('2026-06-10T09:30:00+02:00'); // a Wednesday morning, forever

const SCREENS = [
  ['today', async page => {}],
  ['food', async page => { await page.click('#dock .tab[data-to=food]'); await onScreen(page, 'food'); }],
  ['you', async page => { await page.click('#dock .tab[data-to=you]'); await onScreen(page, 'you'); }],
  ['settings', async page => { await page.click('#s-you .ylist [data-act=open-settings]'); await onScreen(page, 'settings'); }],
  ['coach', async page => { await page.goBack(); await onScreen(page, 'you'); await page.click('#dock .orbbtn'); await onScreen(page, 'coach'); }],
  ['workout', async page => {
    await page.goBack(); await onScreen(page, 'you');
    await page.click('#dock .tab[data-to=today]'); await onScreen(page, 'today');
    await page.click('#s-today [data-act=start-routine]');
    await page.waitForSelector('.sheet.show .rdy', { timeout: 8000 });
    await page.click('.sheet.show .rdy.r4'); await page.click('.sheet.show [data-k=go]');
    await onScreen(page, 'workout');
  }]
];

async function capture(browser, base) {
  const { context, page, errors } = await newPage(browser, base, { reducedMotion: 'reduce' });
  await page.clock.install({ time: FIXED });
  await page.clock.resume();
  await page.goto(base + '?seed=1');
  await onScreen(page, 'today');
  await page.evaluate(() => document.fonts.ready);
  for (const [name, go] of SCREENS) {
    try {
      await go(page);
      await settle(page, 1500);
      await page.screenshot({ path: join(CUR, name + '.png') });
      console.log('  captured ' + name);
    } catch (e) {
      console.error(`  ✗ ${name}: ${String(e.message).split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
  await context.close();
  return errors;
}

// Pixel comparison inside the browser (canvas), so there's no image library to install.
async function compare(browser, a, b) {
  const page = await browser.newPage();
  const res = await page.evaluate(async ([a, b, limit]) => {
    const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { ratio: 1, size: true };
    const w = ia.width, h = ia.height, c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, h).data;
    x.clearRect(0, 0, w, h); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, w, h);
    const out = db.data; let n = 0;
    for (let i = 0; i < out.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - out[i]), Math.abs(da[i + 1] - out[i + 1]), Math.abs(da[i + 2] - out[i + 2]));
      if (d > 40) { n++; out[i] = 255; out[i + 1] = 40; out[i + 2] = 80; out[i + 3] = 255; }
      else { out[i] = out[i] * 0.25; out[i + 1] = out[i + 1] * 0.25; out[i + 2] = out[i + 2] * 0.25; }
    }
    const ratio = n / (w * h);
    if (ratio <= limit) return { ratio };
    x.putImageData(db, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { ratio, diff: btoa(s) };
  }, [a, b, LIMIT]);
  await page.close();
  return res;
}

const dataUrl = async f => 'data:image/png;base64,' + (await readFile(f)).toString('base64');

async function main() {
  await rm(CUR, { recursive: true, force: true }); await rm(DIFF, { recursive: true, force: true });
  await mkdir(CUR, { recursive: true }); await mkdir(DIFF, { recursive: true }); await mkdir(BASE, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  let bad = 0;
  try {
    const errors = await capture(browser, base);
    if (errors.length) { bad++; console.error('  ✗ page errors: ' + [...new Set(errors)].join(' | ')); }
    const files = (await readdir(CUR)).filter(f => f.endsWith('.png'));
    if (APPROVE) {
      for (const f of files) await copyFile(join(CUR, f), join(BASE, f));
      console.log(`Approved ${files.length} pictures as the new baseline (visual/baseline/). Commit them.`);
      return;
    }
    for (const f of files) {
      const b = join(BASE, f);
      if (!existsSync(b)) { bad++; console.log(`  NEW      ${f} (no baseline yet)`); continue; }
      const r = await compare(browser, await dataUrl(b), await dataUrl(join(CUR, f)));
      const pct = (r.ratio * 100).toFixed(2) + '%';
      if (r.diff) { bad++; await writeFile(join(DIFF, f), Buffer.from(r.diff, 'base64')); console.log(`  CHANGED  ${f} ${pct} of pixels → visual/diff/${f}`); }
      else if (r.size) { bad++; console.log(`  CHANGED  ${f} (different size)`); }
      else console.log(`  same     ${f} (${pct})`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (bad) { console.error(`${bad} picture(s) need a look. Intended? Show Omar, then npm run visual -- --approve.`); process.exitCode = 1; }
  else console.log('Screens match the baseline');
}

main().catch(e => { console.error(e); process.exit(1); });
