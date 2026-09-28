// Hold to talk on the dock orb, as one explicit state machine. It knows only fingers and time; what
// each step looks like and does (the orb, the frost, the mic, sending) is the `fx` passed in, so the
// machine can be tested on its own (tests/holdtalk.test.js).
//
//   idle ──down──▶ pressing ──(held holdMs)──▶ quick ──(up 80 px)──▶ review ──Send──▶ sending ──▶ idle
//                     │ up quickly, still: tap         │ release: send        │ release: transcribe, wait
//                     └ anything else: cancel          └ down 80 px / cancel  └ X: cancel
//
// Every state has a way back to idle: pointercancel, the page hiding and the window losing focus all
// cancel (in review, where you may be editing, they only stop the recording).
import { M } from '../motion.config.js';

export const STATES = ['idle', 'pressing', 'quick', 'review', 'sending'];

export function createHoldTalk(fx, { cfg = M, setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() } = {}) {
  let state = 'idle', start = null, pointer = null, timer = 0, holding = false, lastDy = 0;
  const go = s => { state = s; fx.state?.(s); };
  const clear = () => { clearTimer(timer); timer = 0; };
  const toIdle = () => { clear(); start = null; pointer = null; holding = false; lastDy = 0; go('idle'); };

  const m = {
    get state() { return state; },
    get holding() { return holding; },
    // a finger on the orb. False if it wasn't taken (another finger is already down, or a transition
    // is still running: a tap then is ignored, never queued)
    down({ x, y, pointerId = 1 }) {
      if (state !== 'idle' || (fx.canStart && !fx.canStart())) return false;
      start = { x, y, t: now() };
      pointer = pointerId;
      holding = true;
      go('pressing');
      fx.press?.();
      timer = setTimer(() => { if (state === 'pressing') { go('quick'); fx.vibrate?.(8); fx.quick?.(); } }, cfg.holdMs);
      return true;
    },
    move({ x, y, pointerId = 1 }) {
      if (pointerId !== pointer || !start) return;
      const dy = y - start.y;
      lastDy = dy;
      if (state === 'pressing') { if (Math.hypot(x - start.x, dy) > cfg.tapSlopPx) start.moved = true; return; }
      if (state !== 'quick') return;
      if (-dy >= cfg.lockPx) { go('review'); fx.vibrate?.(12); fx.review?.({ dy, offset: dy * cfg.follow }); return; }
      if (dy >= cfg.cancelPx) { m.cancel('drag'); return; }
      fx.follow?.({ dy, offset: dy * cfg.follow, progress: Math.max(0, Math.min(1, -dy / cfg.lockPx)) });
    },
    up({ x, y, pointerId = 1 } = {}) {
      if (pointerId !== pointer) return;
      holding = false;
      pointer = null;
      if (state === 'pressing') {
        const quickTap = now() - start.t < cfg.holdMs && !start.moved && (x == null || Math.hypot(x - start.x, y - start.y) <= cfg.tapSlopPx);
        clear();
        start = null;
        go('idle');
        if (quickTap) fx.tap?.(); else fx.cancel?.('moved', 'pressing');
        return;
      }
      if (state === 'quick') { clear(); go('sending'); fx.send?.(); return; }
      if (state === 'review') { fx.reviewRelease?.(); return; } // stays open: nothing is sent yet
    },
    // Send in the review sheet
    send() {
      if (state !== 'review') return false;
      go('sending');
      fx.reviewSend?.();
      return true;
    },
    // the send (or review) transition has finished: ready for the next press
    done() { if (state === 'sending' || state === 'review') toIdle(); },
    // every exit ends here (the one teardown): back to idle, whatever state it was in, with no effects
    reset() { toIdle(); },
    cancel(reason = 'cancel') {
      if (state === 'idle' || state === 'sending') return;
      if (state === 'review' && reason !== 'discard') {
        if (holding) { holding = false; pointer = null; fx.reviewInterrupt?.(reason); }
        return;
      }
      const from = state;
      toIdle();
      fx.cancel?.(reason, from);
    },
    get dy() { return lastDy; }
  };
  return m;
}
