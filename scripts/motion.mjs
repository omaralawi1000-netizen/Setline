// Motion lab: triggers every animation in the app on an emulated mid-range phone, records every
// painted frame, measures smoothness and layout/paint work, and writes contact sheets + a report.
//   npm run motion                  everything
//   npm run motion -- --only=orb,set just the animations whose name contains "orb" or "set"
//   npm run motion -- --no-reduced  skip the prefers-reduced-motion pass
// Dev tool only (Playwright is a devDependency; the app itself has none). Nothing leaves the
// machine except Google Fonts; speech-to-text is answered locally with a fixed transcript.
//
// Per animation, each pass in a fresh browser context (fresh IndexedDB, ?seed=1 data):
//   1. measure: requestAnimationFrame timestamps + a CDP performance trace (no screencast, so
//      recording doesn't slow the numbers down)
//   2. capture: CDP Page.startScreencast, every frame, into motion/sheets/<name>.png
//   3. reduced: prefers-reduced-motion: reduce, screencast + timings, motion/sheets/<name>--reduced.png
// CPU is throttled 4× (CDP Emulation.setCPUThrottlingRate) only while the animation runs.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'motion');
const SHEETS = join(OUT, 'sheets');
const PREV = join(OUT, 'previous');
const VIEWPORT = { width: 390, height: 844 };
const CPU_RATE = 4;
const FRAME_MS = 16.7;
const JITTER = 0.5; // rAF timestamps wobble ±0.1–0.2 ms around 16.67; a real dropped frame is 33 ms
const LONG_MS = 50;
const FALLBACK_CHROMIUM = '/opt/pw-browsers/chromium';
// the voice screen only listens when a Groq key is present; this stand-in only ever lives in the
// test browser, and the one request it would authorize is answered locally
const STAND_IN_KEY = 'motion-stand-in-not-a-key';
const TRANSCRIPT = 'Bench press 80 kilo 8 reps';

const argv = process.argv.slice(2);
const ONLY = argv.find(a => a.startsWith('--only='))?.slice(7).split(',').filter(Boolean); // names containing any of these
const REDUCED = !argv.includes('--no-reduced');

// ---------- local server ----------

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
      const parts = file.split(sep);
      if (!file.startsWith(ROOT) || parts.includes('node_modules') || parts.includes('.git') || parts.includes('motion')) {
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
  const opts = { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] };
  try { return await chromium.launch(opts); } catch (e) {
    if (!existsSync(FALLBACK_CHROMIUM)) throw e;
    return chromium.launch({ ...opts, executablePath: FALLBACK_CHROMIUM });
  }
}

// ---------- the app in a fresh phone-sized context ----------

const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GROQ = /^https:\/\/api\.groq\.com\//;

async function openApp(browser, base, { reduced = false } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: 'dark', locale: 'en-US', timezoneId: 'Europe/Copenhagen',
    reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'allow'
  });
  await context.grantPermissions(['microphone'], { origin: base });
  // speech-to-text: held until the scenario releases it, then answered with a fixed transcript
  const stt = { pending: false, release: null };
  await context.route(url => !String(url).startsWith(base), async route => {
    const url = route.request().url();
    if (FONTS.test(url)) { try { await route.fulfill({ response: await route.fetch() }); } catch { await route.abort(); } return; }
    if (GROQ.test(url) && /audio\/transcriptions/.test(url)) {
      stt.pending = true;
      await new Promise(r => { stt.release = r; setTimeout(r, 15000); });
      stt.pending = false;
      const seg = { text: TRANSCRIPT, no_speech_prob: 0.01, avg_logprob: -0.15, compression_ratio: 1.1 };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: TRANSCRIPT, language: 'english', segments: [seg] }) }).catch(() => {});
      return;
    }
    await route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e.message).split('\n').slice(0, 2).join(' ')));
  const cdp = await context.newCDPSession(page);
  await page.goto(base + '?seed=1');
  await page.waitForSelector('.screen.on', { state: 'attached' });
  await page.evaluate(() => document.fonts.ready);
  return { context, page, cdp, stt, errors };
}

const wait = (page, ms) => page.waitForTimeout(ms);
const onScreen = (page, name) => page.waitForSelector(`#s-${name}.screen.on`, { state: 'attached', timeout: 15000 });
async function center(page, sel) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error('not visible: ' + sel);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// ---------- starting states ----------

const at = {
  async today(page) { await onScreen(page, 'today'); await wait(page, 1400); },
  async tab(page, name) { await at.today(page); await page.click(`#dock .tab[data-to=${name}]`); await onScreen(page, name); await wait(page, 1200); },
  async sub(page, sel, name) { await at.tab(page, 'you'); await page.click(`#s-you ${sel}`); await onScreen(page, name); await wait(page, 1200); },
  async readiness(page) { await at.today(page); await page.click('#s-today [data-act=start-routine]'); await page.waitForSelector('.sheet.show .rdy'); await wait(page, 1000); },
  async workout(page) {
    await at.readiness(page);
    await page.click('.sheet.show .rdy.r4');
    await page.click('.sheet.show [data-k=go]');
    await onScreen(page, 'workout');
    await wait(page, 1400);
  },
  async logged(page) { await at.workout(page); await page.click('#s-workout .log'); await page.waitForSelector('#toast.show'); await wait(page, 1200); },
  async listening(page) {
    await at.today(page);
    await page.evaluate(k => localStorage.setItem('setline.keys', JSON.stringify({ groq: k })), STAND_IN_KEY);
    const o = await center(page, '#dock .orbbtn');
    await page.mouse.move(o.x, o.y);
    await page.mouse.down();
    await page.waitForSelector('#ofloat[data-phase=listening]', { timeout: 8000 });
    await wait(page, 1200);
  },
  async thinking(page, stt) {
    await at.listening(page);
    await page.mouse.up();
    await page.waitForSelector('#ofloat[data-phase=thinking]', { timeout: 8000 });
    for (let i = 0; i < 100 && !stt.pending; i++) await wait(page, 50);
    if (!stt.pending) throw new Error('speech-to-text was never called');
    await wait(page, 600);
  }
};

// ---------- the animations ----------
// setup: reach the starting state. trigger: start the animation. min/max: window in ms (the
// window ends once no finite animation is running, after min, or at max). fixed: always min
// (looping animations). ignore: animations under this selector don't hold the window open.
// expect: the end state, checked after the window.

const tabTo = (name, to) => ({
  name, group: 'screen transition',
  setup: p => at.tab(p, name.split('-')[1]),
  trigger: p => p.click(`#dock .tab[data-to=${to}]`),
  expect: p => onScreen(p, to)
});
const subTo = (name, sel, to) => ({
  name, group: 'screen transition', setup: p => at.tab(p, 'you'),
  trigger: p => p.click(`#s-you ${sel}`), expect: p => onScreen(p, to)
});

const ANIMATIONS = [
  { name: 'orb-idle', group: 'voice orb', setup: p => at.today(p), trigger: async () => {}, min: 2000, fixed: true, expect: p => onScreen(p, 'today') },
  {
    name: 'orb-listening', group: 'voice orb',
    setup: async p => { await at.today(p); await p.evaluate(k => localStorage.setItem('setline.keys', JSON.stringify({ groq: k })), STAND_IN_KEY); },
    trigger: async p => { const o = await center(p, '#dock .orbbtn'); await p.mouse.move(o.x, o.y); await p.mouse.down(); },
    min: 2200, fixed: true, expect: p => p.waitForSelector('#ofloat[data-phase=listening]', { timeout: 5000 })
  },
  {
    name: 'orb-processing', group: 'voice orb', setup: p => at.listening(p),
    trigger: p => p.mouse.up(), min: 1800, fixed: true,
    expect: p => p.waitForSelector('#ofloat[data-phase=thinking]', { state: 'attached', timeout: 3000 })
  },
  {
    name: 'orb-result', group: 'voice orb', setup: (p, env) => at.thinking(p, env.stt),
    trigger: (p, env) => env.stt.release(), min: 1200, max: 4500, ignore: '#toast',
    expect: p => p.waitForSelector('#s-workout.screen.on, .intent.show, #ofloat[data-phase=result]', { state: 'attached', timeout: 5000 })
  },

  { name: 'tab-today-to-workout', ...tabTo('tab-today-to-workout', 'workout'), setup: p => at.today(p) },
  tabTo('tab-workout-to-food', 'food'),
  tabTo('tab-food-to-you', 'you'),
  tabTo('tab-you-to-today', 'today'),
  subTo('push-you-to-history', '[data-historyscreen]', 'history'),
  subTo('push-you-to-settings', '.ylist [data-act=open-settings]', 'settings'),
  subTo('push-you-to-progress', '[data-progress]', 'progress'),
  subTo('push-you-to-body', '[data-bodyscreen]', 'body'),
  {
    name: 'push-history-to-detail', group: 'screen transition', setup: p => at.sub(p, '[data-historyscreen]', 'history'),
    trigger: p => p.click('#s-history [data-act=detail]'), expect: p => onScreen(p, 'detail')
  },
  {
    name: 'back-history-to-you', group: 'screen transition', setup: p => at.sub(p, '[data-historyscreen]', 'history'),
    trigger: p => p.goBack(), expect: p => onScreen(p, 'you')
  },
  {
    name: 'coach-open', group: 'screen transition', setup: p => at.today(p),
    trigger: p => p.click('#dock .orbbtn'), min: 600, expect: p => onScreen(p, 'coach')
  },
  {
    name: 'coach-close', group: 'screen transition',
    setup: async p => { await at.today(p); await p.click('#dock .orbbtn'); await onScreen(p, 'coach'); await wait(p, 1800); },
    trigger: p => p.goBack(), min: 600, expect: p => onScreen(p, 'today')
  },
  {
    name: 'workout-start', group: 'screen transition', setup: p => at.readiness(p),
    trigger: async p => { await p.click('.sheet.show .rdy.r4'); await p.click('.sheet.show [data-k=go]'); },
    expect: p => onScreen(p, 'workout')
  },

  {
    name: 'sheet-readiness-open', group: 'bottom sheet', setup: p => at.today(p),
    trigger: p => p.click('#s-today [data-act=start-routine]'), expect: p => p.waitForSelector('.sheet.show')
  },
  {
    name: 'sheet-readiness-close', group: 'bottom sheet', setup: p => at.readiness(p),
    trigger: p => p.mouse.click(195, 60), // the dimmed page above the sheet
    expect: p => p.waitForSelector('.sheet', { state: 'detached' })
  },
  {
    name: 'sheet-customize-open', group: 'bottom sheet', setup: p => at.tab(p, 'you'),
    trigger: p => p.click('#s-you [data-act=customize]'), expect: p => p.waitForSelector('.sheet.show')
  },
  {
    name: 'sheet-customize-close', group: 'bottom sheet',
    setup: async p => { await at.tab(p, 'you'); await p.click('#s-you [data-act=customize]'); await p.waitForSelector('.sheet.show'); await wait(p, 1000); },
    trigger: p => p.mouse.click(195, 30), expect: p => p.waitForSelector('.sheet', { state: 'detached' })
  },

  {
    name: 'button-press', group: 'feedback', setup: p => at.today(p),
    // press and hold, then slide off before letting go, so nothing is started
    trigger: async p => {
      const c = await center(p, '#s-today [data-act=start-routine]');
      await p.mouse.move(c.x, c.y); await p.mouse.down(); await wait(p, 160);
      await p.mouse.move(c.x, c.y - 140, { steps: 4 }); await p.mouse.up();
    },
    min: 600, expect: p => onScreen(p, 'today')
  },
  {
    name: 'workout-button-press', group: 'feedback', setup: p => at.workout(p),
    trigger: async p => {
      const c = await center(p, '#s-workout [data-act="reps+"]');
      await p.mouse.move(c.x, c.y); await p.mouse.down(); await wait(p, 160);
      await p.mouse.move(c.x, c.y - 140, { steps: 4 }); await p.mouse.up();
    },
    min: 600, expect: p => onScreen(p, 'workout')
  },
  {
    name: 'set-logged', group: 'feedback', setup: p => at.workout(p),
    trigger: p => p.click('#s-workout .log'), min: 600, ignore: '#toast',
    expect: p => p.waitForSelector('#s-workout .set.done, #s-workout [data-id].done', { state: 'attached', timeout: 3000 }).catch(() => p.waitForSelector('#toast.show'))
  },
  {
    name: 'set-saved-confirmation', group: 'feedback', setup: p => at.workout(p),
    trigger: p => p.click('#s-workout .log'), min: 600, max: 6000,
    expect: p => p.waitForSelector('#toast:not(.show)', { state: 'attached', timeout: 6000 })
  },
  {
    name: 'set-undone', group: 'feedback', setup: p => at.logged(p),
    trigger: p => p.click('#toast .undo'), min: 500, expect: p => p.waitForSelector('#toast:not(.show)', { state: 'attached' })
  },
  {
    name: 'list-items-entering', group: 'list', setup: p => at.sub(p, '[data-historyscreen]', 'history'),
    // a real touch fling up the History list: cards float in as they scroll into view
    trigger: async (p, env) => { await env.cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 600, yDistance: -700, speed: 1400, gestureSourceType: 'touch' }); },
    min: 800, expect: p => onScreen(p, 'history')
  }
];

// ---------- in-page probe: trigger time, rAF timestamps, when animations settle ----------

function probe() {
  const mt = window.__mt = { t0: 0, raf: [], on: false };
  const finite = a => { const t = a.effect?.getComputedTiming?.(); return t && t.endTime !== Infinity && t.iterations !== Infinity; };
  const timed = a => !a.timeline || a.timeline === document.timeline; // scroll-driven animations follow the scroll, never "finish"

  // what the trigger started: not ambient loops, not long decorative runs, not what was already playing
  const ambient = a => (a.effect?.getComputedTiming?.().endTime ?? 0) > 5000;
  mt.before = new Set();
  mt.running = ignore => document.getAnimations().filter(a => a.playState === 'running' && timed(a) && finite(a) && !ambient(a) && !mt.before.has(a) &&
    !(ignore && a.effect?.target?.closest?.(ignore))).length;
  // animations that can't stay on the compositor: transforms on SVG children, layout properties
  const LAYOUT = /^(width|height|top|left|right|bottom|inset|margin|padding|border-width|font-size|line-height|gap|grid|flex)/;
  mt.suspects = () => [...new Set(document.getAnimations().filter(a => a.playState === 'running').flatMap(a => {
    const t = a.effect?.target, props = Object.keys(Object.assign({}, ...(a.effect?.getKeyframes?.() || [])));
    const name = (a.animationName || a.transitionProperty || a.id || 'animation') + ' on ' + (t ? t.tagName.toLowerCase() + (t.id ? '#' + t.id : t.classList?.[0] ? '.' + t.classList[0] : '') : '?');
    const out = [];
    if (t instanceof SVGElement && !(t instanceof SVGSVGElement) && props.some(k => /transform|translate|scale|rotate/.test(k))) out.push(name + ' (SVG transform)');
    const lay = props.filter(k => LAYOUT.test(k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())));
    if (lay.length) out.push(name + ' (' + lay.join(', ') + ')');
    return out;
  }))];
  mt.loops = () => document.getAnimations().filter(a => a.playState === 'running' && timed(a) && (!finite(a) || ambient(a))).length;
  mt.arm = () => {
    mt.raf = []; mt.on = true; mt.t0 = performance.now();
    mt.before = new Set(document.getAnimations());
    const f = t => { if (!mt.on) return; mt.raf.push(t); requestAnimationFrame(f); };
    requestAnimationFrame(f);
    console.timeStamp('mt-start');
    // a pointer trigger starts the clock exactly at the touch
    addEventListener('pointerdown', () => { mt.t0 = performance.now(); console.timeStamp('mt-start'); }, { capture: true, once: true });
  };
  mt.settle = ({ min, max, fixed, ignore }) => new Promise(done => {
    let quiet = 0, busyUntil = 0;
    const tick = () => {
      const el = performance.now() - mt.t0;
      const busy = mt.running(ignore) > 0;
      if (busy) busyUntil = el;
      quiet = !busy && el >= min ? quiet + 1 : 0;
      if ((fixed && el >= min) || (!fixed && quiet >= 3) || el >= max) {
        mt.on = false;
        console.timeStamp('mt-end');
        done({ t0: mt.t0, end: performance.now(), timeOrigin: performance.timeOrigin, raf: mt.raf.filter(t => t >= mt.t0),
          busyUntil: Math.round(busyUntil), suspects: mt.suspects(), timedOut: !fixed && el >= max && busy, loops: mt.loops() });
      } else setTimeout(tick, 100);
    };
    tick();
  });
}

// ---------- one pass ----------

async function runPass(browser, base, anim, mode) {
  const { context, page, cdp, stt, errors } = await openApp(browser, base, { reduced: mode === 'reduced' });
  const env = { cdp, stt };
  const res = { mode, ok: true, error: null };
  const frames = [];
  const trace = [];
  try {
    await anim.setup(page, env);
    await page.evaluate(probe);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
    if (mode === 'measure') {
      const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
      cdp.on('Tracing.dataCollected', d => trace.push(...d.value));
      await cdp.send('Tracing.start', {
        traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking'] },
        transferMode: 'ReportEvents'
      });
      res.traceDone = done;
    } else {
      cdp.on('Page.screencastFrame', f => {
        frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
      await wait(page, 250); // a frame of "before"
    }
    await page.evaluate(() => window.__mt.arm());
    await anim.trigger(page, env);
    const s = await page.evaluate(o => window.__mt.settle(o), { min: anim.min ?? 400, max: anim.max ?? 3500, fixed: !!anim.fixed, ignore: anim.ignore || null });
    await wait(page, 120); // last frames reach the screencast
    Object.assign(res, s);
    if (mode === 'measure') { await cdp.send('Tracing.end'); await res.traceDone; delete res.traceDone; }
    else await cdp.send('Page.stopScreencast');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    if (anim.expect) await Promise.resolve(anim.expect(page, env)).catch(e => { res.ok = false; res.error = 'end state not reached: ' + e.message.split('\n')[0]; });
  } catch (e) {
    res.ok = false;
    res.error = e.message.split('\n')[0];
  } finally {
    stt.release?.();
    await context.close().catch(() => {});
  }
  res.errors = errors;
  res.frames = frames;
  res.trace = trace;
  return res;
}

// ---------- numbers ----------

function smoothness(raf) {
  if (!raf || raf.length < 2) return null;
  const d = raf.slice(1).map((t, i) => Math.round((t - raf[i]) * 10) / 10);
  const sorted = [...d].sort((a, b) => a - b);
  return {
    frames: d.length,
    fps: Math.round((d.length * 1000 / (raf.at(-1) - raf[0])) * 10) / 10,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    over: d.filter(x => x > FRAME_MS + JITTER).length,
    longest: sorted.at(-1)
  };
}

const where = st => {
  const f = st?.[0];
  if (!f || !f.url) return null; // no source file: the probe's own getAnimations() polling, not the app
  return `${f.functionName || '(anonymous)'} ${basename(f.url)}:${(f.lineNumber ?? 0) + 1}`;
};

// Layout and paint inside the animation window. Layout before the first frame after the trigger
// is the change itself (new content going in); layout after it is layout during the animation.
function traceWork(events) {
  const stamps = events.filter(e => e.name === 'TimeStamp' && /^mt-(start|end)$/.test(e.args?.data?.message));
  const start = stamps.filter(e => e.args.data.message === 'mt-start').at(-1)?.ts;
  const end = stamps.find(e => e.args.data.message === 'mt-end')?.ts;
  if (!start || !end) return null;
  const inWin = e => e.ts >= start && e.ts <= end;
  // pair B/E into durations
  const open = new Map(), spans = [];
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.ph === 'X') spans.push({ ...e, dur: e.dur || 0 });
    else if (e.ph === 'B') open.set(e.tid + e.name, e);
    else if (e.ph === 'E') { const b = open.get(e.tid + e.name); if (b) { spans.push({ ...b, dur: e.ts - b.ts, endArgs: e.args }); open.delete(e.tid + e.name); } }
  }
  const firstCommit = spans.filter(e => e.name === 'Commit' && e.ts > start).sort((a, b) => a.ts - b.ts)[0];
  const cut = firstCommit ? firstCommit.ts + firstCommit.dur : start;
  const layouts = spans.filter(e => e.name === 'Layout' && inWin(e));
  const during = layouts.filter(e => e.ts > cut);
  const causes = {};
  for (const e of events) {
    if (!inWin(e) || e.ts <= cut || !['InvalidateLayout', 'ScheduleStyleRecalculation', 'StyleRecalcInvalidationTracking', 'LayoutInvalidationTracking'].includes(e.name)) continue;
    const w = where(e.args?.data?.stackTrace);
    if (w) causes[w] = (causes[w] || 0) + 1;
  }
  for (const e of during) { const w = where(e.args?.beginData?.stackTrace); if (w) causes['forced by ' + w] = (causes['forced by ' + w] || 0) + 1; }
  const vp = VIEWPORT.width * VIEWPORT.height;
  const paints = spans.filter(e => e.name === 'Paint' && inWin(e));
  const area = e => {
    const q = e.args?.data?.clip;
    if (!q || q.length < 8) return 0;
    const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
    const w = Math.min(VIEWPORT.width, Math.max(...xs)) - Math.max(0, Math.min(...xs));
    const h = Math.min(VIEWPORT.height, Math.max(...ys)) - Math.max(0, Math.min(...ys));
    return Math.max(0, w) * Math.max(0, h);
  };
  const large = paints.filter(e => e.ts > cut && area(e) >= vp * 0.5);
  const ms = list => Math.round(list.reduce((a, e) => a + e.dur, 0) / 100) / 10;
  return {
    triggerLayouts: layouts.length - during.length, layouts: during.length, layoutMs: ms(during),
    styleRecalcs: spans.filter(e => e.name === 'UpdateLayoutTree' && inWin(e) && e.ts > cut).length,
    paints: paints.length, paintMs: ms(paints), largePaints: large.length,
    causes: Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ×${n}`)
  };
}

// ---------- contact sheet: a numbered grid, left to right, timestamp on every frame ----------

async function contactSheet(browser, file, title, frames, t0, tEnd) {
  const before = frames.filter(f => f.ts < t0).at(-1);
  const list = [...(before ? [{ ...before, label: 'before' }] : []), ...frames.filter(f => f.ts >= t0 && f.ts <= tEnd + 60)];
  if (!list.length) return 0;
  const many = list.length > 90;
  const tw = many ? 98 : 130, th = Math.round(tw * VIEWPORT.height / VIEWPORT.width), cols = many ? 12 : 8;
  const page = await browser.newPage();
  try {
    const png = await page.evaluate(async ({ items, t0, tw, th, cols, title }) => {
      const gap = 6, lab = 18, head = 34;
      const rows = Math.ceil(items.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * (tw + gap) + gap; c.height = head + rows * (th + lab + gap) + gap;
      const g = c.getContext('2d');
      g.fillStyle = '#05060A'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#F1F0F6'; g.font = '600 15px system-ui, sans-serif'; g.fillText(title, gap + 2, 22);
      const imgs = await Promise.all(items.map(f => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = 'data:image/jpeg;base64,' + f.data; })));
      imgs.forEach((img, k) => {
        const x = gap + (k % cols) * (tw + gap), y = head + Math.floor(k / cols) * (th + lab + gap);
        if (img) g.drawImage(img, x, y, tw, th);
        g.strokeStyle = 'rgba(207,199,255,.25)'; g.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
        g.fillStyle = '#C6BBFA'; g.font = '600 11px system-ui, sans-serif';
        const f = items[k];
        g.fillText(`#${k}  ${f.label || '+' + Math.round(f.ts - t0) + ' ms'}`, x + 2, y + th + 13);
      });
      return c.toDataURL('image/png').split(',')[1];
    }, { items: list.map(f => ({ data: f.data, ts: f.ts, label: f.label })), t0, tw, th, cols, title });
    await writeFile(file, Buffer.from(png, 'base64'));
  } finally { await page.close(); }
  return list.length;
}

// ---------- report ----------

const fmt = (v, unit = '') => v == null ? '–' : `${v}${unit}`;

function verdict(m, w) {
  if (!m) return 'FAIL';
  return m.p95 <= FRAME_MS + JITTER && m.longest <= LONG_MS && (w ? w.layouts === 0 : true) ? 'PASS' : 'FAIL';
}

function reportMd(rows, prev, meta) {
  const prevBy = Object.fromEntries((prev?.rows || []).map(r => [r.name, r]));
  const delta = (name, key) => {
    const a = prevBy[name]?.[key], b = rows.find(r => r.name === name)?.[key];
    if (a == null || b == null) return '';
    const d = Math.round((b - a) * 10) / 10;
    return d === 0 ? ' (=)' : ` (${d > 0 ? '+' : ''}${d})`;
  };
  const L = [];
  L.push('# Motion report', '');
  L.push(`${meta.date} · app ${meta.version} · ${VIEWPORT.width}×${VIEWPORT.height} @2x, touch · CPU throttled ${CPU_RATE}× · Chromium ${meta.chromium}`, '');
  L.push(`PASS = p95 frame ≤ ${FRAME_MS} ms (+${JITTER} ms timer jitter), no frame over ${LONG_MS} ms, and no layout after the first frame of the animation. ` +
    'Timings come from a pass without screen recording; contact sheets from a second pass. Numbers in brackets are the change since motion/previous/.', '');
  if (meta.softwareNote) L.push('> ' + meta.softwareNote, '');
  const idle = rows.find(r => r.name === 'orb-idle');
  if (idle?.work?.layouts) L.push(`> Baseline: with nothing happening (orb-idle, on Today), the app already does ${Math.round(idle.work.layouts / (idle.windowMs || 2000) * 1000)} layouts a second` +
    (idle.suspects?.length ? ` (${idle.suspects.join(', ')})` : '') + '. That work is in every row below until it is fixed.', '');
  const pass = rows.filter(r => r.verdict === 'PASS').length;
  L.push(`**${pass} of ${rows.length} pass.**`, '');
  L.push('| Animation | Result | FPS | p95 frame | Frames > 16.7 ms | Longest frame | Duration | Layout / paint issues |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const issues = [];
    if (r.error) issues.push('⚠ ' + r.error);
    if (r.work) {
      if (r.work.layouts) issues.push(`${r.work.layouts} layouts during (${r.work.layoutMs} ms)`);
      if (r.work.largePaints) issues.push(`${r.work.largePaints} large paints (≥ half the screen)`);
      if (r.work.paintMs >= 20) issues.push(`paint ${r.work.paintMs} ms total`);
      if (r.work.causes.length) issues.push('from: ' + r.work.causes.join(', '));
      if (r.work.layouts && r.suspects?.length) issues.push('off-compositor animations: ' + r.suspects.slice(0, 4).join(', '));
    }
    if (r.timedOut) issues.push('still animating at the end of the window');
    const m = r.m || {};
    L.push(`| [${r.name}](sheets/${r.name}.png) | ${r.verdict} | ${fmt(m.fps)}${delta(r.name, 'fps')} | ${fmt(m.p95, ' ms')}${delta(r.name, 'p95')} | ${fmt(m.over)}/${fmt(m.frames)} | ${fmt(m.longest, ' ms')}${delta(r.name, 'longest')} | ${fmt(r.busyUntil, ' ms')} | ${issues.join('; ') || 'none'} |`);
  }
  if (meta.reduced) {
    L.push('', '## prefers-reduced-motion: reduce', '');
    L.push('Works = the end state is reached, CSS/WAAPI animations finish within 100 ms and nothing keeps looping.', '');
    L.push('| Animation | Works | Animations ran for | Loops still running | Painted frames | Notes |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      const x = r.reduced;
      if (!x) continue;
      L.push(`| [${r.name}](sheets/${r.name}--reduced.png) | ${x.works ? 'yes' : 'NO'} | ${fmt(x.busyUntil, ' ms')} | ${fmt(x.loops)} | ${fmt(x.frames)} | ${x.error || ''} |`);
    }
  }
  if (meta.pageErrors.length) L.push('', '## Page errors', '', ...[...new Set(meta.pageErrors)].map(e => '- `' + e + '`'));
  return L.join('\n') + '\n';
}

// ---------- main ----------

async function rotate() {
  await mkdir(OUT, { recursive: true });
  if (existsSync(join(OUT, 'REPORT.md')) || existsSync(SHEETS)) {
    await rm(PREV, { recursive: true, force: true });
    await mkdir(PREV, { recursive: true });
    for (const f of ['REPORT.md', 'results.json', 'sheets']) if (existsSync(join(OUT, f))) await rename(join(OUT, f), join(PREV, f));
  }
  await mkdir(SHEETS, { recursive: true });
}

async function main() {
  const list = ANIMATIONS.filter(a => !ONLY || ONLY.some(o => a.name.includes(o)));
  if (!list.length) throw new Error('no animation matches ' + ONLY);
  await rotate();
  const prev = await readFile(join(PREV, 'results.json'), 'utf8').then(JSON.parse).catch(() => null);
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  const version = (await readFile(join(ROOT, 'js/version.js'), 'utf8')).match(/'([\d.]+)'/)?.[1];
  const rows = [];
  const pageErrors = [];
  console.log(`Motion lab: ${list.length} animations, CPU ${CPU_RATE}×, ${VIEWPORT.width}×${VIEWPORT.height} → motion/`);
  try {
    for (const anim of list) {
      const t = Date.now();
      const row = { name: anim.name, group: anim.group };
      const meas = await runPass(browser, base, anim, 'measure');
      row.m = smoothness(meas.raf);
      row.work = meas.trace.length ? traceWork(meas.trace) : null;
      row.busyUntil = meas.busyUntil;
      row.windowMs = meas.end != null ? Math.round(meas.end - meas.t0) : null;
      row.timedOut = meas.timedOut;
      row.error = meas.error;
      row.suspects = meas.suspects || [];
      pageErrors.push(...meas.errors);

      const cap = await runPass(browser, base, anim, 'capture');
      if (cap.t0 != null) row.sheetFrames = await contactSheet(browser, join(SHEETS, anim.name + '.png'),
        `${anim.name}  ·  ${anim.group}  ·  frames from the trigger, CPU ${CPU_RATE}×`, cap.frames, cap.timeOrigin + cap.t0, cap.timeOrigin + cap.end);
      if (!row.error && cap.error) row.error = cap.error;
      pageErrors.push(...cap.errors);

      if (REDUCED) {
        const red = await runPass(browser, base, anim, 'reduced');
        let frames = null;
        if (red.t0 != null) frames = await contactSheet(browser, join(SHEETS, anim.name + '--reduced.png'),
          `${anim.name}  ·  prefers-reduced-motion: reduce`, red.frames, red.timeOrigin + red.t0, red.timeOrigin + red.end);
        row.reduced = { works: red.ok && red.busyUntil <= 100 && !red.loops, busyUntil: red.busyUntil, loops: red.loops, frames, error: red.error };
        pageErrors.push(...red.errors);
      }
      row.verdict = row.error ? 'FAIL' : verdict(row.m, row.work);
      rows.push(row);
      const m = row.m || {};
      console.log(`  ${row.verdict.padEnd(4)} ${anim.name.padEnd(26)} ${String(m.fps ?? '–').padStart(5)} fps  p95 ${String(m.p95 ?? '–').padStart(6)} ms  max ${String(m.longest ?? '–').padStart(6)} ms  layouts ${row.work?.layouts ?? '–'}${row.error ? '  ⚠ ' + row.error : ''}  (${((Date.now() - t) / 1000).toFixed(0)} s)`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  const meta = {
    date: new Date().toISOString().slice(0, 16).replace('T', ' '), version, chromium: browser.version(), reduced: REDUCED, pageErrors,
    softwareNote: 'Headless Chromium here has no GPU: every frame is rasterized and composited on the CPU, so blur and large layers cost far more than on a phone GPU. Use the numbers to compare runs and to find the worst offenders, not as absolute phone frame rates.'
  };
  await writeFile(join(OUT, 'results.json'), JSON.stringify({ meta, rows }, null, 2));
  await writeFile(join(OUT, 'REPORT.md'), reportMd(rows, prev, meta));
  console.log(`${rows.filter(r => r.verdict === 'PASS').length}/${rows.length} pass · motion/REPORT.md · motion/sheets/`);
}

main().catch(e => { console.error(e); process.exit(1); });
