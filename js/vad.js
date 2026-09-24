// Voice activity detection for hands-free mode, on raw samples. Pure.
//
// An adaptive noise floor follows the room (music, clanging); a stretch of frames clearly above it
// starts an utterance (with a little audio from just before, so the first word isn't clipped),
// and a pause ends it. Only utterances go to speech-to-text, never the silence in between.

export function createVad({ rate = 48000, frameMs = 20, preMs = 400, startMs = 140, endMs = 750, maxMs = 8000, minMs = 300, floorInit = 0.004 } = {}) {
  const F = Math.max(1, Math.round((rate * frameMs) / 1000));
  const pre = Math.round(preMs / frameMs), startN = Math.max(1, Math.round(startMs / frameMs));
  const endN = Math.round(endMs / frameMs), maxN = Math.round(maxMs / frameMs), minN = Math.round(minMs / frameMs);
  let frame = new Float32Array(F), fill = 0;
  let floor = floorInit, ring = [], run = 0;
  const warmN = Math.round(500 / frameMs); // listen to the room first
  let warm = [];
  let utt = null; // {frames: [], voiced, silence}
  let level = 0;

  const thresholdFor = f => Math.max(0.012, f * 3.2);

  function onFrame(fr) {
    let e = 0;
    for (let i = 0; i < fr.length; i++) e += fr[i] * fr[i];
    const rms = Math.sqrt(e / fr.length);
    level = rms;
    const out = [];
    if (warm) {
      warm.push(rms);
      if (warm.length >= warmN) { floor = Math.max(floorInit * 0.5, [...warm].sort((a, b) => a - b)[warm.length >> 1]); warm = null; }
      ring.push(fr);
      if (ring.length > pre + startN) ring.shift();
      return out;
    }
    const voiced = rms > thresholdFor(floor);
    if (!utt) {
      // the floor drifts toward the room, quickly down and slowly up
      floor = rms < floor ? floor * 0.8 + rms * 0.2 : floor * 0.985 + rms * 0.015;
      ring.push(fr);
      if (ring.length > pre + startN) ring.shift();
      run = voiced ? run + 1 : 0;
      if (run >= startN) { utt = { frames: [...ring], levels: [], voiced: run, silence: 0 }; ring = []; run = 0; }
      return out;
    }
    utt.frames.push(fr);
    utt.levels.push(rms);
    // a sound that keeps going slowly becomes the room (music starting, a fan)
    floor = floor * 0.996 + Math.min(rms, floor * 4) * 0.004;
    if (voiced) { utt.voiced++; utt.silence = 0; } else utt.silence++;
    if (utt.silence >= endN) {
      const keep = utt.frames.length - Math.max(0, utt.silence - Math.round(200 / frameMs)); // 200 ms after the last word
      if (utt.voiced >= minN) out.push(concat(utt.frames.slice(0, keep)));
      utt = null;
    } else if (utt.frames.length >= maxN) {
      // commands are short: something this long is noise, so learn it instead of sending it
      floor = Math.max(floor, [...utt.levels].sort((a, b) => a - b)[utt.levels.length >> 1] * 0.9);
      utt = null;
    }
    return out;
  }

  return {
    // Feed samples; returns finished utterances (Float32Array at `rate`).
    push(samples) {
      const out = [];
      for (let i = 0; i < samples.length; i++) {
        frame[fill++] = samples[i];
        if (fill === F) { out.push(...onFrame(frame)); frame = new Float32Array(F); fill = 0; }
      }
      return out;
    },
    // Drop whatever is being heard (e.g. while the app itself is speaking).
    reset() { utt = null; ring = []; run = 0; fill = 0; },
    get calibrating() { return !!warm; },
    get speaking() { return !!utt; },
    get level() { return level; },
    get floor() { return floor; }
  };
}

function concat(frames) {
  const out = new Float32Array(frames.reduce((a, f) => a + f.length, 0));
  let o = 0;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}

// Mono float samples → 16-bit PCM WAV at outRate (averaging decimation is plenty for speech).
export function toWav(samples, rate, outRate = 16000) {
  const k = rate / outRate;
  const n = Math.floor(samples.length / k);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * k), b = Math.min(samples.length, Math.floor((i + 1) * k));
    let s = 0;
    for (let j = a; j < b; j++) s += samples[j];
    const x = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}

// Tap-to-talk end of speech, from the display level (0..1) the orb already reads each frame:
// once you've spoken for a moment, a pause of `endMs` means you're done. The floor follows the
// room, so a noisy gym doesn't keep it listening forever.
export function createEndpointer({ endMs = 1000, startMs = 240 } = {}) {
  let floor = null, heard = 0, quiet = 0;
  return {
    push(level, dt) {
      if (!Number.isFinite(level) || !(dt > 0)) return false;
      dt = Math.min(dt, 100); // a stalled frame isn't a second of silence
      floor = floor == null ? level : level < floor ? floor + (level - floor) * 0.3 : floor + (level - floor) * Math.min(1, dt / 4000);
      const speech = level > Math.max(0.24, floor + 0.16), silent = level < Math.max(0.15, floor + 0.07);
      if (speech) { heard += dt; quiet = 0; }
      else if (silent && heard >= startMs) quiet += dt;
      return heard >= startMs && quiet >= endMs;
    },
    reset() { floor = null; heard = 0; quiet = 0; }
  };
}
