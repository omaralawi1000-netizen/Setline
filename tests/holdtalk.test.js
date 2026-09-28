// The hold-to-talk state machine (js/ui/holdtalk.js), with a fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHoldTalk } from '../js/ui/holdtalk.js';

const CFG = { holdMs: 250, tapSlopPx: 10, lockPx: 80, cancelPx: 80, follow: 0.4 };

function rig({ canStart = () => true } = {}) {
  let t = 0, timers = [];
  const calls = [];
  const fx = new Proxy({ canStart }, { get: (o, k) => o[k] || ((...a) => calls.push([k, ...a])) });
  const m = createHoldTalk(fx, {
    cfg: CFG, now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
    clearTimer: h => { timers = timers.filter(x => x !== h); }
  });
  const wait = ms => { t += ms; for (const h of timers.filter(x => x.at <= t)) { timers = timers.filter(x => x !== h); h.fn(); } };
  const names = () => calls.map(c => c[0]).filter(n => n !== 'state');
  const count = n => calls.filter(c => c[0] === n).length;
  return { m, wait, calls, names, count };
}

test('a quick, still tap opens the chat and never becomes a hold', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.wait(120);
  r.m.up({ x: 102, y: 801 });
  assert.equal(r.m.state, 'idle');
  assert.deepEqual(r.names(), ['press', 'tap']);
  r.wait(500);
  assert.equal(r.count('quick'), 0);
});

test('a tap that moved more than 10 px is not a tap', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.m.move({ x: 100, y: 780 });
  r.wait(100);
  r.m.up({ x: 100, y: 780 });
  assert.equal(r.count('tap'), 0);
  assert.equal(r.count('cancel'), 1);
  assert.equal(r.m.state, 'idle');
});

test('holding past 250 ms goes to quick (with a small buzz)', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.wait(249);
  assert.equal(r.m.state, 'pressing');
  r.wait(1);
  assert.equal(r.m.state, 'quick');
  assert.deepEqual(r.calls.find(c => c[0] === 'vibrate'), ['vibrate', 8]);
});

test('releasing in quick sends exactly once', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.wait(300);
  r.m.move({ x: 100, y: 770 }); // a little up: still quick
  assert.equal(r.m.state, 'quick');
  r.m.up({ x: 100, y: 770 });
  r.m.up({ x: 100, y: 770 });
  assert.equal(r.count('send'), 1);
  assert.equal(r.m.state, 'sending');
  r.m.done();
  assert.equal(r.m.state, 'idle');
  assert.equal(r.count('send'), 1);
});

test('the orb follows the finger at 0.4 and shows how close the lock is', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.wait(300);
  r.m.move({ x: 100, y: 760 });
  const f = r.calls.filter(c => c[0] === 'follow').at(-1)[1];
  assert.equal(f.offset, -16);
  assert.equal(f.progress, 0.5);
});

test('holding and dragging up 80 px locks into review; release transcribes and sends nothing until Send', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.wait(300);
  r.m.move({ x: 100, y: 720 });
  assert.equal(r.m.state, 'review');
  assert.deepEqual(r.calls.find(c => c[0] === 'vibrate' && c[1] === 12), ['vibrate', 12]);
  r.m.up({ x: 100, y: 700 });
  assert.equal(r.count('reviewRelease'), 1);
  assert.equal(r.count('send') + r.count('reviewSend'), 0);
  assert.equal(r.m.state, 'review');
  r.wait(5000);
  assert.equal(r.count('reviewSend'), 0);
  assert.equal(r.m.send(), true);
  assert.equal(r.count('reviewSend'), 1);
  assert.equal(r.m.send(), false); // a second tap on Send does nothing
  assert.equal(r.count('reviewSend'), 1);
  r.m.done();
  assert.equal(r.m.state, 'idle');
});

test('dragging down 80 px in quick cancels and sends nothing', () => {
  const r = rig();
  r.m.down({ x: 100, y: 700 });
  r.wait(300);
  r.m.move({ x: 100, y: 781 });
  assert.equal(r.m.state, 'idle');
  assert.equal(r.count('cancel'), 1);
  r.m.up({ x: 100, y: 781 });
  assert.equal(r.count('send'), 0);
  assert.equal(r.count('tap'), 0);
});

test('pointercancel cancels from pressing and from quick', () => {
  for (const at of [100, 300]) {
    const r = rig();
    r.m.down({ x: 100, y: 800 });
    r.wait(at);
    r.m.cancel('pointercancel');
    assert.equal(r.m.state, 'idle');
    assert.equal(r.count('cancel'), 1);
    r.wait(1000);
    r.m.up({ x: 100, y: 800 });
    assert.equal(r.count('send') + r.count('tap') + r.count('quick'), at > 250 ? 1 : 0); // (quick had started)
    assert.equal(r.count('send') + r.count('tap'), 0);
  }
});

test('in review an interruption only stops the recording; X discards', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800 });
  r.wait(300);
  r.m.move({ x: 100, y: 700 });
  r.m.cancel('visibility');
  assert.equal(r.m.state, 'review');
  assert.equal(r.count('reviewInterrupt'), 1);
  r.m.cancel('discard');
  assert.equal(r.m.state, 'idle');
  assert.equal(r.count('cancel'), 1);
});

test('a second finger is ignored, and so are taps while a transition runs', () => {
  const r = rig();
  r.m.down({ x: 100, y: 800, pointerId: 1 });
  assert.equal(r.m.down({ x: 50, y: 50, pointerId: 2 }), false);
  r.m.up({ x: 50, y: 50, pointerId: 2 });
  assert.equal(r.m.state, 'pressing');
  r.m.up({ x: 100, y: 800, pointerId: 1 });
  assert.equal(r.count('tap'), 1);
  let busy = true;
  const b = rig({ canStart: () => !busy });
  assert.equal(b.m.down({ x: 1, y: 1 }), false);
  b.m.up({ x: 1, y: 1 });
  assert.equal(b.m.state, 'idle');
  assert.equal(b.count('tap'), 0);
  busy = false;
  assert.equal(b.m.down({ x: 1, y: 1 }), true);
});
