// A real streamed Coach reply for the browser checks. Playwright's route.fulfill hands the page the
// whole body at once, so it can't show what happens while a reply streams. This stubs window.fetch
// (only for Gemini's `:streamGenerateContent?alt=sse`) with a Response whose body is a ReadableStream
// giving one SSE `data:` line every `every` ms, so js/ai.js's reader, the word pacing, the end of the
// stream, the hidden REMEMBER / ACTION lines and the chips all run as they do on the phone.
//
//   await streamReplies(page, [{ text: '…', chunks: 60, every: 40 }, …])   one entry per question, in order
//   (a reply's text may end in "REMEMBER: …" or "ACTION: {…}" lines, as the model writes them)
export const streamReplies = (page, replies) => page.addInitScript(list => {
  const real = window.fetch.bind(window);
  let n = 0;
  window.__sse = { started: [], ended: [] };
  window.fetch = (url, opts) => {
    if (!/:streamGenerateContent\?alt=sse/.test(String(url))) return real(url, opts);
    const r = list[Math.min(n, list.length - 1)], i = n++;
    const text = r.text, parts = Math.max(1, r.chunks || 60), every = r.every ?? 40;
    // cut the text into `parts` pieces at arbitrary places (the model splits mid-word and mid-line too)
    const cuts = [];
    for (let k = 1; k < parts; k++) cuts.push(Math.round((text.length * k) / parts));
    const pieces = [0, ...cuts, text.length].map((c, k, a) => (k ? text.slice(a[k - 1], c) : null)).filter(p => p != null && p.length);
    const enc = new TextEncoder();
    const signal = opts?.signal;
    const body = new ReadableStream({
      async start(ctl) {
        window.__sse.started[i] = performance.now();
        await new Promise(res => setTimeout(res, r.delay ?? 300));
        for (const p of pieces) {
          if (signal?.aborted) { ctl.error(new DOMException('Aborted', 'AbortError')); return; }
          ctl.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] } }] })}\r\n\r\n`));
          await new Promise(res => setTimeout(res, every));
        }
        window.__sse.ended[i] = performance.now();
        ctl.close();
      }
    });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  };
}, replies);

// A per-frame probe of the thread, from `from` ms before the stream ends until `after` ms after:
// how often the reply's first sentence shows in the page's text, how many Coach messages the thread
// has, and whether the thread jumped (scrollTop moving up while near the end).
export const probeReply = (page, firstSentence) => page.evaluate(s => {
  window.__probe = [];
  const tick = () => {
    const ol = document.getElementById('thread'), root = document.getElementById('s-coach');
    const txt = document.body.innerText;
    let count = 0, at = 0;
    while ((at = txt.indexOf(s, at)) >= 0) { count++; at += s.length; }
    window.__probe.push({ t: performance.now(), copies: count, ai: ol ? ol.querySelectorAll(':scope > .msg.ai').length : 0,
      top: root.scrollTop, gap: root.scrollHeight - root.clientHeight - root.scrollTop });
    if (window.__probe.length < 6000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, firstSentence);
