// Frame budget of the flows Omar uses most, on a phone-class setup (412×915 at 2.625× pixel density,
// the CPU slowed 4×), so a change can be judged by numbers, not by eye:
//   node scripts/perf.mjs                 all flows, a table on stdout
//   node scripts/perf.mjs --json=out.json also the raw numbers
//   node scripts/perf.mjs --only=stream   one flow
// Per flow: frames per second, dropped frames, the worst frame, long tasks (main-thread work over
// 50 ms), paint and raster time per frame, and the most composited layers (and their megapixels, the
// GPU tile memory they ask for) at any moment. Nothing leaves the machine; Groq and Gemini are mocked.
import { writeFile } from 'node:fs/promises';
import { launch, serve } from './lib/harness.mjs';
import { STAND_IN, mockServices } from './lib/voiceflow.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = arg('only')?.split(',');
const JSON_OUT = arg('json');
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };
const REPLY = 'Your bench is moving well. You added 2.5 kg in two weeks, so keep the same plan and aim for eight reps next time, then add a little weight when all three sets feel smooth. Sleep a little more before the heavy day and keep the rows on Thursday.';

async function setup(browser, base) {
  const context = await browser.newContext({ ...PHONE, colorScheme: 'dark', locale: 'en-US', timezoneId: 'Europe/Copenhagen', serviceWorkers: 'allow' });
  await context.grantPermissions(['microphone'], { origin: base });
  await context.route(u => !String(u).startsWith(base) && !/groq|generativelanguage|fonts\.(googleapis|gstatic)/.test(String(u)), r => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR_|Failed to load/.test(m.text())) errors.push(m.text().split('\n')[0]); });
  await mockServices(page, { reply: REPLY, delay: 350 });
  await page.addInitScript(k => localStorage.setItem('setline.keys', JSON.stringify(k)), STAND_IN);
  await page.goto(base + '?seed=1');
  await page.waitForSelector('#s-today.screen.on', { state: 'attached' });
  await page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.setSettings({ spoken: 'off', weeklyCheckin: false });
    s.addChat('user', 'How was last week?');
    s.addChat('model', 'Four sessions and a record on the bench. Keep the same plan and add a set of rows on Thursday.');
    for (let i = 0; i < 4; i++) { s.addChat('user', `Question ${i + 1} about my plan?`); s.addChat('model', 'Keep the same plan this week, add a set of rows on Thursday and sleep a little more before the heavy day.'); }
    await document.fonts.ready;
  });
  await page.waitForTimeout(1500);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate(() => {
    window.__f = []; window.__lt = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask' }); } catch {}
    const loop = t => { window.__f.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  return { context, page, cdp, errors };
}

const center = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const streamDone = page => page.waitForFunction(async () => { const s = await import('./js/store.js'); const m = [...s.state.chat].reverse().find(x => x.role === 'model' && x.q); return m && m.streaming === false; }, null, { timeout: 30000, polling: 100 });

// Each flow: steps run inside named segments; seg(name, fn) measures fn's time window.
const FLOWS = {
  // hold the dock orb: the floating orb lifts over the page and listens; pull up into the voice screen;
  // listen there; release: your words to check; Send: the question goes to the Coach and the reply streams in
  async voice(page, seg) {
    const o = await center(page, '#dock .orbbtn');
    await page.mouse.move(o.x, o.y);
    await seg('hold → floating orb', async () => { await page.mouse.down(); await page.waitForTimeout(1600); });
    await seg('pull up → voice screen', async () => {
      for (let dy = 8; dy <= 176; dy += 8) { await page.mouse.move(o.x, o.y - dy); await page.waitForTimeout(16); }
      await page.waitForTimeout(700);
    });
    await seg('listening (voice screen)', () => page.waitForTimeout(1400));
    await seg('release → review', async () => { await page.mouse.up(); await page.waitForSelector('#voice.reviewing #vrtext:not(:empty)', { timeout: 10000 }); await page.waitForTimeout(500); });
    await seg('Send → Coach', async () => { await page.click('#vreview .vrsend'); await page.waitForSelector('#s-coach.screen.on', { state: 'attached', timeout: 10000 }); await page.waitForTimeout(600); });
    await seg('reply streaming', async () => { await streamDone(page); await page.waitForTimeout(400); });
  },
  // tap the orb: the Coach opens; back: Home again
  async coach(page, seg) {
    await seg('tap orb → Coach', async () => { await page.click('#dock .orbbtn'); await page.waitForSelector('#s-coach.screen.on', { state: 'attached' }); await page.waitForTimeout(1000); });
    await seg('Coach → back to Home', async () => { await page.goBack(); await page.waitForSelector('#s-today.screen.on', { state: 'attached' }); await page.waitForTimeout(1000); });
  },
  // a typed question and its streamed reply, in the Coach
  async stream(page, seg) {
    await page.click('#dock .orbbtn');
    await page.waitForSelector('#s-coach.screen.on', { state: 'attached' });
    await page.waitForTimeout(1200);
    await page.fill('#composer input', 'How is my bench going?');
    await seg('typed question → streamed reply', async () => { await page.press('#composer input', 'Enter'); await streamDone(page); await page.waitForTimeout(400); });
  },
  // fling Today up and down
  async scroll(page, seg, cdp) {
    await seg('scroll Today', async () => {
      for (const y of [-1400, 1400]) await cdp.send('Input.synthesizeScrollGesture', { x: 206, y: 520, yDistance: y, speed: 1600, gestureSourceType: 'touch' });
      await page.waitForTimeout(300);
    });
  }
};

async function measure(browser, base, name, flow, { layers }) {
  const { context, page, cdp, errors } = await setup(browser, base);
  const segs = [];
  let layerLog = null;
  if (layers) {
    layerLog = [];
    await cdp.send('LayerTree.enable');
    cdp.on('LayerTree.layerTreeDidChange', ({ layers: ls = [] }) => {
      const draw = ls.filter(l => l.drawsContent && !l.invisible);
      layerLog.push({ t: Date.now(), n: draw.length, mp: draw.reduce((a, l) => a + l.width * l.height, 0) * PHONE.deviceScaleFactor ** 2 / 1e6 });
    });
  }
  const seg = async (label, fn) => {
    const i = segs.length;
    const a = await page.evaluate(n => { performance.mark(n); return performance.now(); }, `seg${i}a`), wa = Date.now();
    await fn();
    const b = await page.evaluate(n => { performance.mark(n); return performance.now(); }, `seg${i}b`), wb = Date.now();
    segs.push({ label, a, b, wa, wb, i });
  };
  if (!layers) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'cc', 'viz'] });
  await flow(page, seg, cdp);
  const trace = layers ? null : JSON.parse((await browser.stopTracing()).toString());
  const r = await page.evaluate(() => ({ f: window.__f, lt: window.__lt, origin: performance.timeOrigin }));
  await context.close();
  return segs.map(s => {
    const out = { flow: name, label: s.label };
    if (layers) {
      const inWin = layerLog.filter(x => x.t >= s.wa && x.t <= s.wb);
      out.layers = inWin.length ? Math.max(...inWin.map(x => x.n)) : (layerLog.filter(x => x.t < s.wa).pop()?.n ?? 0);
      out.layerMP = +(inWin.length ? Math.max(...inWin.map(x => x.mp)) : (layerLog.filter(x => x.t < s.wa).pop()?.mp ?? 0)).toFixed(1);
      return out;
    }
    const fr = r.f.filter(t => t >= s.a && t <= s.b), gaps = fr.slice(1).map((t, i) => t - fr[i]);
    const secs = (s.b - s.a) / 1000;
    out.fps = +(fr.length / secs).toFixed(1);
    out.dropped = gaps.reduce((acc, g) => acc + Math.max(0, Math.round(g / 16.67) - 1), 0);
    out.worstMs = gaps.length ? Math.round(Math.max(...gaps)) : 0;
    const lt = r.lt.filter(x => x.t + x.d >= s.a && x.t <= s.b);
    out.longTasks = lt.length; out.longTaskMs = Math.round(lt.reduce((acc, x) => acc + x.d, 0));
    // the segment's window in the trace's own clock, from the marks set at its ends
    const ev = trace.traceEvents;
    const markTs = n => ev.find(e => e.name === n && String(e.cat).includes('user_timing'))?.ts;
    const ta = markTs(`seg${s.i}a`), tb = markTs(`seg${s.i}b`);
    const win = e => ta != null && tb != null && e.ts >= ta && e.ts <= tb;
    const sum = names => ev.filter(e => names.includes(e.name) && e.dur && win(e)).reduce((acc, e) => acc + e.dur, 0) / 1000;
    const n = Math.max(1, fr.length);
    out.paintMsPerFrame = +(sum(['Paint', 'PaintImage']) / n).toFixed(2);
    out.rasterMsPerFrame = +(sum(['RasterTask']) / n).toFixed(2);
    out.errors = errors;
    return out;
  });
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launch();
  const rows = [];
  try {
    for (const [name, flow] of Object.entries(FLOWS)) {
      if (ONLY && !ONLY.some(o => name.includes(o))) continue;
      const timing = await measure(browser, base, name, flow, { layers: false });
      const lay = await measure(browser, base, name, flow, { layers: true });
      timing.forEach((row, i) => rows.push({ ...row, layers: lay[i]?.layers, layerMP: lay[i]?.layerMP }));
    }
  } finally {
    await browser.close();
    server.close();
  }
  const cols = ['label', 'fps', 'dropped', 'worstMs', 'longTasks', 'longTaskMs', 'paintMsPerFrame', 'rasterMsPerFrame', 'layers', 'layerMP'];
  const head = ['flow', 'fps', 'dropped', 'worst ms', 'long tasks', 'long ms', 'paint ms/f', 'raster ms/f', 'layers', 'layer MP'];
  console.log('| ' + head.join(' | ') + ' |\n|' + head.map(() => '---').join('|') + '|');
  for (const r of rows) console.log('| ' + cols.map(c => r[c]).join(' | ') + ' |');
  const errs = [...new Set(rows.flatMap(r => r.errors || []))];
  if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
  if (JSON_OUT) await writeFile(JSON_OUT, JSON.stringify(rows, null, 1));
}

main().catch(e => { console.error(e); process.exit(1); });
