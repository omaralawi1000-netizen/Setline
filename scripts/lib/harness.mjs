// Shared Playwright harness for the verification scripts (golden.mjs, visual.mjs).
// Same rules as screens.mjs: serve the repo root locally, phone viewport, and nothing leaves the
// machine except Google Fonts. Dev tool only; the app itself has no dependencies.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const VIEWPORT = { width: 390, height: 844 };
const FALLBACK_CHROMIUM = '/opt/pw-browsers/chromium';
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain'
};
const BLOCKED_DIRS = ['node_modules', '.git', 'motion', 'screenshots', 'visual'];

export function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
      if (!file.startsWith(ROOT) || file.split(sep).some(p => BLOCKED_DIRS.includes(p))) {
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

export async function launch() {
  const opts = { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] };
  try {
    return await chromium.launch(opts);
  } catch (e) {
    if (!existsSync(FALLBACK_CHROMIUM)) throw e;
    return chromium.launch({ ...opts, executablePath: FALLBACK_CHROMIUM });
  }
}

// A fresh phone-sized context. `reducedMotion` makes pictures steadier for visual comparison.
export async function newPage(browser, base, { reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: 'dark', reducedMotion, locale: 'en-US', timezoneId: 'Europe/Copenhagen',
    serviceWorkers: 'allow'
  });
  await context.grantPermissions(['microphone'], { origin: base });
  await context.route(url => !String(url).startsWith(base), async route => {
    if (!FONTS.test(route.request().url())) return route.abort();
    try { await route.fulfill({ response: await route.fetch() }); } catch { await route.abort(); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e.message).split('\n').slice(0, 2).join(' ')));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page, errors };
}

export const settle = (page, ms = 1200) => page.waitForTimeout(ms);
export const onScreen = (page, name, timeout = 8000) => page.waitForSelector(`#s-${name}.screen.on`, { state: 'attached', timeout });
