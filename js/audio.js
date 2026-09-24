// One shared AudioContext, unlocked on the first user gesture (used for the level meter and replies).
let ctx = null, primed = false;

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
  // Android only lets a page talk after it has spoken once inside a tap: a silent word does that
  if (!primed && globalThis.speechSynthesis) {
    primed = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {}
  }
}

// The rest-over bell: three bright notes (loud enough across a gym), or one soft tick.
export function chime(kind = 'end') {
  const c = audioContext();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t0 = c.currentTime + 0.02;
  const out = c.createGain();
  out.gain.value = kind === 'tick' ? 0.18 : 0.55;
  out.connect(c.destination);
  const notes = kind === 'tick' ? [[1320, 0, 0.09]] : [[880, 0, 0.5], [1175, 0.16, 0.5], [1760, 0.32, 0.9]];
  for (const [f, at, len] of notes) {
    for (const [mult, g] of [[1, 1], [2, 0.25]]) { // a bell: the note and a quieter octave
      const o = c.createOscillator(), e = c.createGain();
      o.type = 'sine'; o.frequency.value = f * mult;
      e.gain.setValueAtTime(0.0001, t0 + at);
      e.gain.exponentialRampToValueAtTime(g, t0 + at + 0.012);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(e); e.connect(out);
      o.start(t0 + at); o.stop(t0 + at + len + 0.05);
    }
  }
}
