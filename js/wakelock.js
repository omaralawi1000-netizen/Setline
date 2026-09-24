// Screen wake lock during an active workout. Re-acquired when the page is visible again.
let lock = null;
let wanted = false;

async function acquire() {
  if (!wanted || lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    if (!wanted) release();
  } catch { lock = null; }
}

function release() {
  const l = lock;
  lock = null;
  if (l) l.release().catch(() => {});
}

export function keepAwake(on) {
  wanted = !!on;
  if (wanted) acquire(); else release();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
