// Screenshots of every main screen and state at phone size (390×844), saved to screenshots/.
// Dev tool only (Playwright is a devDependency; the app itself has none).
//   node scripts/screens.mjs
// Serves the repo root locally, drives the real UI with dev seed data (?seed=1), and never
// talks to Groq or Google: every request that leaves localhost is blocked except Google Fonts.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'screenshots');
const VIEWPORT = { width: 390, height: 844 };
// the browser Playwright ships for this version, else the one pre-installed in cloud sessions
const FALLBACK_CHROMIUM = '/opt/pw-browsers/chromium';
// the voice screen only listens when a Groq key is present; this stand-in lives in the test
// browser's storage for one step, and every request to Groq is blocked anyway
const STAND_IN_KEY = 'screenshot-stand-in-not-a-key';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain'
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
      if (!file.startsWith(ROOT) || file.split(sep).includes('node_modules') || file.split(sep).includes('.git')) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch() {
  const opts = { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] };
  try {
    return await chromium.launch(opts);
  } catch (e) {
    if (!existsSync(FALLBACK_CHROMIUM)) throw e;
    return chromium.launch({ ...opts, executablePath: FALLBACK_CHROMIUM });
  }
}

const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

async function newPage(browser, base, { onboarding = false } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Copenhagen',
    serviceWorkers: 'allow' // each context starts empty, so the worker precaches the files on disk
  });
  await context.grantPermissions(['microphone'], { origin: base });
  // Manrope is fetched by Playwright in Node rather than by the browser, which may not trust a
  // cloud session's HTTPS proxy (Node does); nothing else leaves the machine
  await context.route(url => !String(url).startsWith(base), async route => {
    if (!FONTS.test(route.request().url())) return route.abort();
    try { await route.fulfill({ response: await route.fetch() }); } catch { await route.abort(); }
  });
  // onboarding skips itself under test automation; this run wants to see it
  if (onboarding) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e.message).split('\n').slice(0, 2).join(' ')));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, errors };
}

// let entrances, count-ups and the Coach's bloom finish before the picture
const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const onScreen = (page, name) => page.waitForSelector(`#s-${name}.screen.on`, { state: 'attached' });

let n = 0;
const shots = [];
async function shot(page, name) {
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shots.push(file);
  console.log('  ' + file);
}

// a failed step is reported, leaves a picture of what was on screen, and the run goes on
async function step(page, label, fn) {
  try { await fn(); } catch (e) {
    console.error(`  ✗ ${label}: ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
    await shot(page, label.replace(/\W+/g, '-') + '-FAILED').catch(() => {});
  }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  const allErrors = [];
  console.log(`Setline screenshots at ${VIEWPORT.width}×${VIEWPORT.height} → screenshots/`);

  try {
    // 1. first launch: the getting-to-know-you sheet, on an empty database
    {
      const { context, page, errors } = await newPage(browser, base, { onboarding: true });
      await step(page, 'onboarding', async () => {
        await page.goto(base);
        await page.waitForSelector('.sheet.show', { timeout: 8000 });
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        await shot(page, 'onboarding');
      });
      allErrors.push(...errors);
      await context.close();
    }

    // 2. everything else, on dev seed data
    const { context, page, errors } = await newPage(browser, base);
    await page.goto(base + '?seed=1');
    await onScreen(page, 'today');
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 1600);
    const fontOk = await page.evaluate(() => [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Manrope' && f.status === 'loaded'));
    if (!fontOk) console.warn('  ! Manrope did not load (no network?): text uses the fallback font');

    await step(page, 'home', () => shot(page, 'home'));

    await step(page, 'food', async () => {
      await page.click('#dock .tab[data-to=food]');
      await onScreen(page, 'food');
      await settle(page);
      await shot(page, 'food');
    });

    await step(page, 'you', async () => {
      await page.click('#dock .tab[data-to=you]');
      await onScreen(page, 'you');
      await settle(page);
      await shot(page, 'you');
    });

    await step(page, 'history', async () => {
      await page.click('#s-you [data-historyscreen]');
      await onScreen(page, 'history');
      await settle(page);
      await shot(page, 'history');
      await page.goBack();
      await onScreen(page, 'you');
    });

    await step(page, 'settings', async () => {
      await page.click('#s-you .ylist [data-act=open-settings]');
      await onScreen(page, 'settings');
      await settle(page);
      await shot(page, 'settings');
      await page.goBack();
      await onScreen(page, 'you');
    });

    await step(page, 'coach', async () => {
      await page.click('#dock .orbbtn'); // a tap on the orb opens the Coach
      await onScreen(page, 'coach');
      await settle(page, 1800);
      await shot(page, 'coach');
      await page.goBack();
      await onScreen(page, 'you');
      await settle(page, 900);
    });

    await step(page, 'active workout', async () => {
      await page.click('#dock .tab[data-to=today]');
      await onScreen(page, 'today');
      await settle(page, 600);
      await page.click('#s-today [data-act=start-routine]');
      await page.waitForSelector('.sheet.show .rdy', { timeout: 8000 }); // the readiness check first
      await settle(page);
      await shot(page, 'workout-readiness');
      await page.click('.sheet.show .rdy.r4');
      await page.click('.sheet.show [data-k=go]');
      await onScreen(page, 'workout');
      await settle(page);
      await shot(page, 'workout-active');
    });

    await step(page, 'rest timer', async () => {
      await page.click('#s-workout .log');
      await settle(page, 2400); // the intent card and the set landing play out
      await shot(page, 'workout-rest');
    });

    await step(page, 'voice listening', async () => {
      await page.evaluate(k => localStorage.setItem('setline.keys', JSON.stringify({ groq: k })), STAND_IN_KEY);
      const orb = await page.locator('#dock .orbbtn').boundingBox();
      const x = orb.x + orb.width / 2, y = orb.y + orb.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down(); // hold the orb to talk: it lifts and the mic opens
      await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 6000 });
      await settle(page, 700);
      await shot(page, 'voice-listening');
      // still holding, pull up: the full voice screen
      for (let dy = 10; dy <= 180; dy += 10) await page.mouse.move(x, y - dy);
      await page.waitForSelector('#voice[data-phase=listening]', { timeout: 6000 });
      await settle(page, 900);
      await shot(page, 'voice-listening-full');
    });
    // let go without sending anything, and forget the stand-in
    await page.evaluate(() => localStorage.removeItem('setline.keys'));
    await page.close({ runBeforeUnload: false }).catch(() => {});
    allErrors.push(...errors);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`${shots.length} screenshots saved to screenshots/`);
  if (allErrors.length) {
    console.warn('Page errors:');
    for (const e of [...new Set(allErrors)]) console.warn('  ' + e);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
