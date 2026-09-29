// The shared animation frame (js/ui/frame.js) runs exactly one requestAnimationFrame loop, however
// subscribers come and go (a subscriber added inside a frame once started a second loop, and they
// doubled every frame until the page froze).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('one frame loop, even when subscribers join and leave inside frames', async () => {
  const queue = [];
  globalThis.document = { visibilityState: 'visible', addEventListener() {} };
  globalThis.requestAnimationFrame = fn => { queue.push(fn); return queue.length; };
  globalThis.cancelAnimationFrame = () => {};
  const { onFrame } = await import('../js/ui/frame.js');
  let calls = 0, stopB = null;
  // like the orb: it stops itself in a frame and is woken again by another subscriber in the same frame
  const b = () => { calls++; stopB?.(); stopB = null; };
  onFrame(() => { if (!stopB) stopB = onFrame(b); });
  for (let t = 1; t <= 30; t++) {
    const now = queue.splice(0);
    assert.ok(now.length <= 1, `frame ${t}: ${now.length} frame callbacks requested at once`);
    for (const fn of now) fn(t * 16);
  }
  assert.ok(calls >= 14 && calls <= 30, `the woken subscriber ran ${calls} times in 30 frames`);
});
