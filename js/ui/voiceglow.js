// Voice glow: a soft light along the bottom of the voice screen that rises and brightens with your
// voice, and breathes slowly while the words are being worked out.
//
// One static radial gradient in the theme's colours, painted once. Per frame only its opacity and a
// scale from the bottom centre change, so the phone composites it and never repaints it. (It used to
// be a port of Libraries.dev's voice-glow: seven masked lobes in three layers, 21 GPU layers with
// masks, which was part of what ran the phone's GPU out of memory while the sheet opened.) It reads
// the voice from the recorder's own analyser: no second microphone stream.

const follow = (x, to, dt, up, down) => x + (to - x) * (1 - Math.exp(-dt / (to > x ? up : down)));

export function createVoiceGlow(host, before = null) {
  const el = document.createElement('div');
  el.className = 'vglow';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="vg-light"></i>';
  host.insertBefore(el, before);
  const light = el.firstChild;
  const s = { on: false, level: 0, busy: 0, t: 0 };

  // src: {listening, processing, rms, voice:[low, mid, high]}; still: no breathing (reduced motion)
  function step(dt, src, still) {
    const on = src.listening || src.processing;
    if (on !== s.on) { s.on = on; el.classList.toggle('on', on); }
    if (!on) { s.level = 0; s.busy = 0; return; } // off: fades out by the element's own opacity
    s.t += dt;
    // the voice, gated and softly saturated, rises quickly and settles slowly
    const raw = src.listening ? Math.max(0, (src.rms || 0) * 9 - 0.04) : 0;
    s.level = follow(s.level, Math.min(1, raw / (1 + raw)), dt, 0.08, 0.35);
    s.busy = follow(s.busy, src.processing ? 1 : 0, dt, 0.3, 0.3);
    const breathe = still ? 0.5 : 0.5 + 0.5 * Math.sin(s.t * 2.2);
    const lift = Math.max(s.level, s.busy * (0.25 + 0.2 * breathe), src.listening ? 0.12 : 0);
    light.style.opacity = (0.35 + 0.65 * lift).toFixed(3);
    light.style.transform = `scale(${(0.85 + 0.45 * lift).toFixed(3)})`;
  }

  function off() { s.on = false; s.level = 0; s.busy = 0; el.classList.remove('on'); }

  return { el, step, off, get on() { return s.on; } };
}
