// One shared AudioContext, unlocked on the first user gesture (used for the level meter and replies).
let ctx = null;

export function audioContext() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

export function unlockAudio() {
  const c = audioContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
