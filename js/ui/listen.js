// Listen until you're done: the mic, the smart pause and speech-to-text in one call.
// A pause sends only when what you said sounds finished; half sentences wait (up to waitMs of quiet).
// Returns { done: Promise<string>, stop(), cancel() }; stop() sends now, cancel() gives ''.
import * as mic from '../voice.js';
import { transcribe } from '../stt.js';
import { createEndpointer, looksUnfinished } from '../endpoint.js';

export function listenSmart({ stt, onLevel = () => {}, onState = () => {}, pauseMs = 1300, waitMs = 6000, maxMs = 90_000 } = {}) {
  const ep = createEndpointer({ pauseMs });
  let resolve, reject, over = false, raf = 0, last = 0, spec = null, waiting = false;
  const done = new Promise((res, rej) => { resolve = res; reject = rej; });
  const end = fn => { if (over) return false; over = true; cancelAnimationFrame(raf); onLevel(0); fn(); return true; };

  async function finish() {
    if (over) return;
    over = true; cancelAnimationFrame(raf); onLevel(0);
    onState('hearing');
    const r = await mic.stop();
    if (!r || r.ms < 500 || (r.measured && r.peak < 0.03)) return resolve('');
    try { resolve(await transcribe(r.blob, stt)); } catch (e) { reject(e); }
  }
  async function speculate() {
    const blob = mic.snapshot();
    if (!blob || blob.size < 800) return;
    const mine = spec = {};
    onState('check');
    let text;
    try { text = await transcribe(blob, stt); } catch { if (spec === mine) { spec = null; waiting = true; onState('listening'); } return; }
    if (spec !== mine || over) return;
    spec = null;
    if (looksUnfinished(text)) { waiting = true; onState('wait'); return; }
    end(() => { mic.cancel(); resolve(text); });
  }
  const tick = now => {
    if (over) return;
    const l = mic.level();
    onLevel(l);
    const ev = last ? ep.push(l, now - last) : null;
    last = now;
    if (ev === 'pause') speculate();
    else if (ev === 'resume') { spec = null; waiting = false; onState('listening'); }
    if (waiting && ep.quietMs >= waitMs) { waiting = false; finish(); return; }
    raf = requestAnimationFrame(tick);
  };

  mic.start({ maxMs, onMaxed: () => finish() }).then(() => {
    if (over) { mic.cancel(); return; }
    onState('listening');
    raf = requestAnimationFrame(tick);
  }, e => end(() => reject(e)));

  return {
    done,
    stop: () => finish(),
    cancel: () => end(() => { mic.cancel(); resolve(''); })
  };
}
