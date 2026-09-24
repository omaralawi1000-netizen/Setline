import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTtsModel } from '../js/tts.js';
import { buildPrompt } from '../js/stt.js';
import { createCatalog } from '../js/catalog.js';
import { getKey, setKey, clearKeys, mask } from '../js/keys.js';
import { sanitize, ttsModelId, sttModelId, DEFAULT_TTS_MODEL } from '../js/settings.js';

const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('TTS model: preferred name if listed, else newest stable flash-lite tts', () => {
  const models = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-lite-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-4.0-flash-lite-tts-preview', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.9-flash-lite-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.9-pro-tts', supportedGenerationMethods: ['generateContent'] }
  ];
  assert.equal(pickTtsModel(models, 'gemini-3.8-flash-lite-tts'), 'gemini-4.0-flash-lite-tts-preview', 'newer generation wins over the default');
  assert.equal(pickTtsModel(models.filter(m => !/4\.0|3\.9/.test(m.name)), 'gemini-3.8-flash-lite-tts'), 'gemini-3.8-flash-lite-tts');
  assert.equal(pickTtsModel(models.filter(m => !/4\.0/.test(m.name)), 'gone-model'), 'gemini-3.9-flash-lite-tts');
  assert.equal(pickTtsModel(models.slice(0, 2)), 'gemini-2.5-flash-preview-tts', 'falls back to flash tts');
  assert.equal(pickTtsModel([{ name: 'models/gemini-2.5-flash' }]), null);
});

test('STT prompt has current and recent exercises in both languages', () => {
  const p = buildPrompt({ current: 'bench-press', recent: ['deadlift', 'bench-press'], catalog: createCatalog() });
  assert.match(p, /^Bænkpres, Bench press, Dødløft, Deadlift\. /);
  assert.match(p, /Bænkpres 82,5 kilo 8 gentagelser\. Bench press 80 kg for 8\./);
  assert.ok(p.length < 600);
});

test('keys live apart from settings and are masked', () => {
  const s = mem();
  setKey('groq', '  gsk_abcdef123456  ', s);
  assert.equal(getKey('groq', s), 'gsk_abcdef123456');
  assert.equal(mask(getKey('groq', s)), '••••3456');
  setKey('groq', '', s);
  assert.equal(getKey('groq', s), '');
  setKey('google', 'AIza-x', s);
  clearKeys(s);
  assert.equal(getKey('google', s), '');
  assert.equal(sanitize({ groq: 'x', google: 'y' }).groq, undefined, 'settings never carry keys');
});

test('voice settings sanitize and model ids', () => {
  const s = sanitize({ voiceLang: 'da', micMode: 'tap', spoken: 'full', voice: 'Puck', stt: 'accurate', ttsOverride: 'bad id!' });
  assert.equal(s.voiceLang, 'da');
  assert.equal(s.micMode, 'tap');
  assert.equal(s.spoken, 'full');
  assert.equal(s.voice, 'Puck');
  assert.equal(s.ttsOverride, '');
  assert.equal(sttModelId(s), 'whisper-large-v3');
  assert.equal(sttModelId(sanitize({})), 'whisper-large-v3-turbo');
  assert.equal(ttsModelId(sanitize({})), 'device', 'default: the phone speaks at once');
  assert.equal(ttsModelId(sanitize({ ttsQuality: 'natural', ttsV: 1 })), DEFAULT_TTS_MODEL);
  assert.equal(ttsModelId(sanitize({ ttsModel: 'gemini-x-tts', ttsOverride: 'gemini-y-tts' })), 'gemini-y-tts');
  assert.equal(sanitize({ voice: 'Nobody' }).voice, 'Achird');
  assert.equal(sanitize({ voice: 'Kore' }).voice, 'Achird', 'old default migrates once');
  assert.equal(sanitize({ voice: 'Kore', voiceV: 2 }).voice, 'Kore', 'a deliberate choice stays');
});
