import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTranscript, isJunk } from '../js/stt.js';
import { systemPrompt } from '../js/coach.js';

test('subtitle credits Whisper hears in silence are dropped', () => {
  assert.ok(isJunk('Danske tekster af Jesper Buhl Scandinavian Text Service 2018'));
  assert.ok(isJunk('Tak fordi du så med!'));
  assert.ok(isJunk('Thank you for watching.'));
  assert.ok(!isJunk('Bænkpres 80 kilo 8'));
  assert.equal(cleanTranscript({ text: 'Danske tekster af Jesper Buhl', language: 'danish' }).text, '');
});

test('segments the model marks as not speech are left out', () => {
  const r = cleanTranscript({ text: 'x', language: 'danish', segments: [
    { text: ' Hvad skal jeg spise i aften?', no_speech_prob: 0.02, avg_logprob: -0.2, compression_ratio: 1.2 },
    { text: ' Dæk.', no_speech_prob: 0.9, avg_logprob: -1.3, compression_ratio: 0.8 }
  ] });
  assert.deepEqual(r, { text: 'Hvad skal jeg spise i aften?', lang: 'da' });
});

test('the heard language is reported so a Norwegian guess can be redone as Danish', () => {
  assert.equal(cleanTranscript({ text: 'Jeg vet ikke', language: 'norwegian' }).lang, 'other');
  assert.equal(cleanTranscript({ text: 'Hi', language: 'english' }).lang, 'en');
  assert.equal(cleanTranscript({ text: 'Hej' }).lang, '');
  assert.equal(cleanTranscript(null), null);
});

test('the coach answers what was said and does not repeat itself', () => {
  const p = systemPrompt('da');
  assert.match(p, /First answer exactly what they just said/);
  assert.match(p, /Never repeat a point/);
  assert.match(p, /misheard/);
});

test('talk mode drops stray letters', async () => {
  const { isNoise } = await import('../js/coach.js');
  assert.ok(isNoise('L'));
  assert.ok(isNoise('Jd.'));
  assert.ok(isNoise('a h'));
  assert.ok(!isNoise('ja'));
  assert.ok(!isNoise('no'));
  assert.ok(!isNoise('Hvad kan I hjælpe dem i dag?'));
});
