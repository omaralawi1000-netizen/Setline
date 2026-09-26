// Gemini Live: a spoken conversation with the Coach over one WebSocket. You talk, it answers in its
// own voice straight away, you can cut in, and it can change the app through tools. Both sides are
// written out as text so the chat stays the record. The pure parts (messages, audio conversion) are
// exported for tests; the session itself needs a browser.
import { audioContext } from './audio.js';

const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const IN_RATE = 16000, OUT_RATE = 24000;

// ---------- pure ----------

export function setupMessage({ model, voice, system, tools }) {
  const setup = {
    model: `models/${model}`,
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    systemInstruction: { parts: [{ text: system }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  };
  if (tools?.length) setup.tools = [{ functionDeclarations: tools }];
  return { setup };
}

// Mic samples (any rate, float) → 16 kHz 16-bit PCM, averaging each output sample's span.
export function toPcm16k(input, rate) {
  const ratio = rate / IN_RATE, n = Math.floor(input.length / ratio), out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function b64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function floatFromB64Pcm(b64) {
  const bin = atob(b64), n = bin.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

// One server message → what happened in it.
export function readServer(msg) {
  const out = { audio: [], inText: '', outText: '', toolCalls: [], setup: false, interrupted: false, turnComplete: false, goAway: false };
  if (!msg || typeof msg !== 'object') return out;
  if (msg.setupComplete) out.setup = true;
  if (msg.goAway) out.goAway = true;
  const sc = msg.serverContent;
  if (sc) {
    for (const p of sc.modelTurn?.parts || []) if (p.inlineData?.data && /audio/.test(p.inlineData.mimeType || 'audio')) out.audio.push(p.inlineData.data);
    out.inText = sc.inputTranscription?.text || '';
    out.outText = sc.outputTranscription?.text || '';
    out.interrupted = !!sc.interrupted;
    out.turnComplete = !!sc.turnComplete;
  }
  for (const c of msg.toolCall?.functionCalls || []) out.toolCalls.push({ id: c.id, name: c.name, args: c.args || {} });
  return out;
}

// ---------- the session ----------

let current = null;
export const liveOn = () => !!current;
export const stopLive = reason => current?.stop(reason);

// startLive({key, model, voice, system, tools, onTool(name, args) → Promise<object>, on: {state, user, model, level, error, latency}})
// Resolves once the session is set up (or rejects: no Live for this key/model, mic denied, offline).
export function startLive(opts) {
  current?.stop('replaced');
  const s = new Session(opts);
  current = s;
  return s.open().then(() => s);
}

class Session {
  constructor(o) {
    Object.assign(this, { o, on: o.on || {}, ws: null, stream: null, src: null, node: null, sink: null, outGain: null, outAn: null, inAn: null,
      nextAt: 0, sources: new Set(), raf: 0, stopped: false, state: 'connecting', lastVoiceAt: 0, turnAudioAt: 0, heardText: '', saidText: '', quietTimer: 0, echoCuts: 0, half: false });
  }

  async open() {
    const ac = audioContext();
    if (!ac?.audioWorklet || !navigator.mediaDevices?.getUserMedia || !globalThis.WebSocket) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    if (ac.state !== 'running') ac.resume().catch(() => {});
    // the phone's echo cancelling keeps the Coach's own voice out of the mic, so you can talk over it
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch(e => { throw Object.assign(e, { code: e?.name === 'NotAllowedError' ? 'mic' : 'failed' }); });
    if (this.stopped) { this.release(); throw Object.assign(new Error('stopped'), { code: 'stopped' }); }
    await ac.audioWorklet.addModule('js/tap-worklet.js');
    await this.connect();
    this.src = ac.createMediaStreamSource(this.stream);
    this.inAn = ac.createAnalyser(); this.inAn.fftSize = 512;
    this.node = new AudioWorkletNode(ac, 'setline-tap');
    this.sink = ac.createGain(); this.sink.gain.value = 0;
    this.src.connect(this.inAn);
    this.src.connect(this.node).connect(this.sink).connect(ac.destination);
    this.node.port.onmessage = e => this.mic(e.data, ac.sampleRate);
    this.outGain = ac.createGain();
    this.outAn = ac.createAnalyser(); this.outAn.fftSize = 512;
    this.outGain.connect(this.outAn); this.outGain.connect(ac.destination);
    this.meter();
    this.set('listening');
    this.idle();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(`${WS}?key=${encodeURIComponent(this.o.key)}`);
      let ready = false;
      const fail = code => { if (!ready) { reject(Object.assign(new Error('live ' + code), { code })); this.stop('failed'); } };
      const timer = setTimeout(() => fail('timeout'), 8000);
      ws.onopen = () => ws.send(JSON.stringify(setupMessage(this.o)));
      ws.onmessage = async e => {
        const text = typeof e.data === 'string' ? e.data : await e.data.text();
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        const r = readServer(msg);
        if (r.setup && !ready) { ready = true; clearTimeout(timer); resolve(); }
        this.handle(r);
      };
      ws.onerror = () => fail('network');
      ws.onclose = e => {
        clearTimeout(timer);
        if (!ready) return fail(e.code === 1007 || e.code === 1008 ? 'refused' : 'closed');
        if (!this.stopped) { this.on.error?.(e.reason || 'closed'); this.stop('closed'); }
      };
    });
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  mic(buf, rate) {
    if (this.stopped || this.ws?.readyState !== 1) return;
    // a fallback for phones whose echo cancelling doesn't reach the Coach's voice: after it keeps
    // cutting itself off, the mic pauses while it speaks (you can still tap the orb to stop it)
    if (this.half && this.sources.size) return;
    const pcm = toPcm16k(buf, rate);
    this.send({ realtimeInput: { audio: { data: b64FromBytes(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
  }

  // You speaking is measured to time how quickly the answer starts
  meter() {
    const a = new Float32Array(512), b = new Float32Array(512);
    const rms = (an, x) => { an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
    const step = () => {
      if (this.stopped) return;
      const inL = rms(this.inAn, a), outL = rms(this.outAn, b);
      const speaking = this.sources.size > 0;
      if (!speaking && inL > 0.03) { this.lastVoiceAt = performance.now(); if (this.state !== 'hearing') this.set('hearing'); this.idle(); }
      else if (!speaking && this.state === 'hearing' && performance.now() - this.lastVoiceAt > 500) this.set('thinking');
      this.on.level?.(Math.min(1, inL * 9), Math.min(1, outL * 6));
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  play(b64) {
    const ac = audioContext();
    const samples = floatFromB64Pcm(b64);
    if (!samples.length) return;
    const buf = ac.createBuffer(1, samples.length, OUT_RATE);
    buf.getChannelData(0).set(samples);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain);
    const at = Math.max(ac.currentTime + 0.03, this.nextAt);
    src.start(at);
    this.nextAt = at + buf.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size && !this.stopped && this.state === 'speaking') { this.set('listening'); this.idle(); }
    };
  }

  cut() {
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources.clear();
    this.nextAt = 0;
  }

  async handle(r) {
    if (r.inText) { this.heardText += r.inText; this.on.user?.(this.heardText, false); }
    if (r.audio.length || r.outText) {
      if (this.heardText) { this.on.user?.(this.heardText, true); this.heardText = ''; }
      if (r.audio.length && !this.turnAudioAt) {
        this.turnAudioAt = performance.now();
        if (this.lastVoiceAt) this.on.latency?.(Math.round(this.turnAudioAt - this.lastVoiceAt));
      }
      if (this.state !== 'speaking') this.set('speaking');
    }
    for (const a of r.audio) this.play(a);
    if (r.outText) { this.saidText += r.outText; this.on.model?.(this.saidText, false); }
    if (r.interrupted) {
      // cut off within a moment of starting, with nothing heard from you: likely its own echo
      if (this.turnAudioAt && performance.now() - this.turnAudioAt < 900 && !this.heardText) { if (++this.echoCuts >= 2) this.half = true; }
      this.cut();
    }
    if (r.interrupted || r.turnComplete) {
      if (this.saidText) this.on.model?.(this.saidText, true);
      this.saidText = ''; this.turnAudioAt = 0;
      if (!this.sources.size) { this.set('listening'); this.idle(); }
    }
    // what you said goes into the chat before anything the Coach does about it
    if (r.toolCalls.length && this.heardText) { this.on.user?.(this.heardText, true); this.heardText = ''; }
    for (const c of r.toolCalls) {
      let response;
      try { response = await this.o.onTool?.(c.name, c.args) || { ok: true }; } catch (e) { response = { ok: false, error: String(e?.message || e) }; }
      this.send({ toolResponse: { functionResponses: [{ id: c.id, name: c.name, response }] } });
    }
    if (r.goAway) this.on.error?.('goaway');
  }

  sendText(text) {
    this.cut();
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
    this.lastVoiceAt = performance.now();
    this.set('thinking');
  }

  // a long silence on both sides ends the session (it's billed while open)
  idle() {
    clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => { if (!this.sources.size) this.stop('idle'); else this.idle(); }, 60000);
  }

  set(state) {
    if (this.state === state) return;
    this.state = state;
    this.on.state?.(state);
  }

  release() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.quietTimer);
    try { this.src?.disconnect(); this.node?.disconnect(); this.sink?.disconnect(); this.outGain?.disconnect(); this.inAn?.disconnect(); this.outAn?.disconnect(); } catch {}
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach(t => t.stop());
  }

  stop(reason = 'user') {
    if (this.stopped) return;
    this.stopped = true;
    this.cut();
    this.release();
    try { this.ws?.close(1000); } catch {}
    if (current === this) current = null;
    this.on.state?.('off', reason);
  }
}
