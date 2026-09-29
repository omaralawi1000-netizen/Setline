// Frame-by-frame checks for the voice sheet and the Coach (used by golden.mjs). A sampler in the page
// records, every animation frame: how many orbs are visible, whether Home is visible, whether the
// voice sheet's top bar and controls are there, and marks the test sets ("open", "handoff", …).
export const STAND_IN = { groq: 'golden-stand-in-not-a-key', google: 'golden-stand-in-not-a-key' };

// Answers from the (mocked) services: speech-to-text, and a streamed Coach reply in a few chunks.
export async function mockServices(page, { heard = 'How is my bench going?', reply = 'Your bench is moving well. You added 2.5 kg in two weeks, so keep the same plan and aim for 8 reps next time.', delay = 250 } = {}) {
  await page.route(/api\.groq\.com/, async r => {
    await new Promise(res => setTimeout(res, delay));
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ text: heard }) });
  });
  await page.route(/generativelanguage\.googleapis\.com.*streamGenerateContent/, async r => {
    const words = reply.split(' ');
    let body = '';
    for (let i = 0; i < words.length; i += 4) body += `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: words.slice(i, i + 4).join(' ') + ' ' }] } }] })}\r\n\r\n`;
    await new Promise(res => setTimeout(res, delay));
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body });
  });
  await page.route(/generativelanguage\.googleapis\.com(?!.*streamGenerateContent)/, r => r.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
}

export const installSampler = page => page.evaluate(() => {
  const vis = el => !!el && el.isConnected && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; })();
  // an element really showing: visible, and not faded out by any ancestor (opacity near 0 counts as gone)
  const shown = el => { if (!vis(el)) return false; for (let n = el; n; n = n.parentElement) if (+getComputedStyle(n).opacity < 0.05) return false; return true; };
  window.__marks = [];
  window.__mark = name => window.__marks.push({ name, t: performance.now() });
  window.__samples = [];
  const tick = t => {
    // (a flight's stand-in carries two looks of one orb, melting from one into the other: one orb)
    const shownOrbs = [...document.querySelectorAll('.orb')].filter(shown);
    const orbs = [...shownOrbs.filter(o => !o.closest('.orbghost')), ...(shownOrbs.some(o => o.closest('.orbghost')) ? [document.querySelector('.orbghost')] : [])];
    const top = document.querySelector('#voice .top'), hold = document.querySelector('#vhold');
    window.__samples.push({
      t, orbs: orbs.length, orbIds: orbs.map(o => o.id || o.parentElement?.className || 'orb').join(','),
      home: shown(document.getElementById('s-today')),
      // how readable each full screen is (its opacity with its ancestors'): never two at once
      todayOp: (() => { const el = document.getElementById('s-today'); if (!vis(el)) return 0; let o = 1; for (let n = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; })(),
      coachOp: (() => { const el = document.getElementById('thread'); if (!el || !vis(el)) return 0; let o = 1; for (let n = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; })(),
      chrome: !!top && !!hold && shown(top) && shown(hold) && +getComputedStyle(top).opacity > 0.99 && +getComputedStyle(hold).opacity > 0.5, // (dimmed while it works it out is still there)
      why: !top || !hold ? 'unmounted' : `top ${(+getComputedStyle(top).opacity).toFixed(2)} hold ${(+getComputedStyle(hold).opacity).toFixed(2)} ${document.getElementById('voice').dataset.phase}`,
      sheet: !document.getElementById('voice').hidden,
      handoff: document.getElementById('voice').classList.contains('handoff'),
      coaching: document.getElementById('app').classList.contains('coaching')
    });
    if (window.__samples.length < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

export const mark = (page, name) => page.evaluate(n => window.__mark(n), name);
export const samples = page => page.evaluate(() => ({ samples: window.__samples, marks: window.__marks }));
export const between = ({ samples: s, marks: m }, from, to) => {
  const a = m.find(x => x.name === from)?.t ?? -Infinity, b = to ? (m.find(x => x.name === to)?.t ?? Infinity) : Infinity;
  return s.filter(x => x.t >= a && x.t <= b);
};
