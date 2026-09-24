// Tap-to-talk end of speech. Pure.
//
// The orb reads a display level (0..1) every frame. After you've spoken, a pause raises 'pause'
// once; speaking again raises 'resume'. The caller then transcribes what it has so far and only
// sends when it sounds finished (looksUnfinished), so stopping to think doesn't send half a sentence.
// The floor follows the room, so gym music isn't taken for speech.

export function createEndpointer({ pauseMs = 1300, startMs = 240 } = {}) {
  let floor = null, heard = 0, quiet = 0, paused = false;
  return {
    push(level, dt) {
      if (!Number.isFinite(level) || !(dt > 0)) return null;
      dt = Math.min(dt, 100); // a stalled frame isn't a second of silence
      floor = floor == null ? level : level < floor ? floor + (level - floor) * 0.3 : floor + (level - floor) * Math.min(1, dt / 4000);
      const speech = level > Math.max(0.24, floor + 0.16), silent = level < Math.max(0.15, floor + 0.07);
      if (speech) {
        heard += dt; quiet = 0;
        if (paused) { paused = false; return 'resume'; }
        return null;
      }
      if (silent && heard >= startMs) quiet += dt;
      if (!paused && heard >= startMs && quiet >= pauseMs) { paused = true; return 'pause'; }
      return null;
    },
    get quietMs() { return quiet; },
    get spoke() { return heard >= startMs; },
    reset() { floor = null; heard = 0; quiet = 0; paused = false; }
  };
}

// Words a sentence doesn't end on: "80 kilos for…", "and", "um", "med", "øh".
const TRAILING = new Set(('and or but with for to the a an of at on in my i um uh uhm umm er erm hmm like so then because plus ' +
  'by is was it that what how if about from next my maybe also og eller men med til på af en et den det min mit jeg øh øhm ' +
  'hmm så fordi plus hvis om fra også måske som har er var der lige').split(' '));

export function looksUnfinished(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (/(\.\.\.|…|[-–—,:])\s*$/.test(raw)) return true; // Whisper marks a trailing-off voice with "..." or a dash
  const last = raw.toLowerCase().replace(/[.!?"'”’)\]]+$/, '').split(/\s+/).pop();
  return TRAILING.has(last);
}
