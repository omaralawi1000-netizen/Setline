import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupMessage, toPcm16k, b64FromBytes, floatFromB64Pcm, readServer } from '../js/live.js';

test('setupMessage: audio replies in the chosen voice, transcripts both ways, tools', () => {
  const m = setupMessage({ model: 'gemini-live-x', voice: 'Achird', system: 'Be a coach.', tools: [{ name: 'change_app', description: 'd', parameters: { type: 'OBJECT', properties: { changes_json: { type: 'STRING' } }, required: ['changes_json'] } }] });
  assert.equal(m.setup.model, 'models/gemini-live-x');
  assert.deepEqual(m.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(m.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Achird');
  assert.equal(m.setup.systemInstruction.parts[0].text, 'Be a coach.');
  assert.deepEqual(m.setup.inputAudioTranscription, {});
  assert.deepEqual(m.setup.outputAudioTranscription, {});
  assert.equal(m.setup.tools[0].functionDeclarations[0].name, 'change_app');
  assert.equal(setupMessage({ model: 'x', voice: 'Kore', system: '' }).setup.tools, undefined);
});

test('toPcm16k: 48 kHz float → a third as many 16-bit samples, clipped', () => {
  const x = new Float32Array(4800).fill(0.5);
  x[0] = 3; x[1] = 3; x[2] = 3;
  const out = toPcm16k(x, 48000);
  assert.equal(out.length, 1600);
  assert.equal(out[0], 0x7fff);
  assert.ok(Math.abs(out[5] / 0x7fff - 0.5) < 0.001);
});

test('PCM survives the base64 round trip', () => {
  const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);
  const back = floatFromB64Pcm(b64FromBytes(new Uint8Array(pcm.buffer)));
  assert.equal(back.length, 5);
  assert.ok(Math.abs(back[1] - 1000 / 32768) < 1e-6);
  assert.ok(Math.abs(back[2] + 1000 / 32768) < 1e-6);
  assert.equal(back[4], -1);
});

test('readServer: setup, audio, transcripts, interruptions, tool calls', () => {
  assert.equal(readServer({ setupComplete: {} }).setup, true);
  const r = readServer({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAA=' } }, { text: 'x' }] }, outputTranscription: { text: 'Hi' }, inputTranscription: { text: 'yo' }, turnComplete: true } });
  assert.deepEqual(r.audio, ['AAA=']);
  assert.equal(r.outText, 'Hi');
  assert.equal(r.inText, 'yo');
  assert.equal(r.turnComplete, true);
  assert.equal(readServer({ serverContent: { interrupted: true } }).interrupted, true);
  assert.deepEqual(readServer({ toolCall: { functionCalls: [{ id: '1', name: 'change_app', args: { changes_json: '[]' } }] } }).toolCalls, [{ id: '1', name: 'change_app', args: { changes_json: '[]' } }]);
  assert.deepEqual(readServer(null).audio, []);
});
