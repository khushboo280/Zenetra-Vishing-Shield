import test from 'node:test';
import assert from 'node:assert/strict';
import { prep, sane } from '../server/providers/common.js';
test('quiet audio is normalised', () => {
  const a = new Int16Array(16000); for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.sin(i / 7) * 800);
  const o = new Int16Array(prep(Buffer.from(a.buffer)).buffer.slice(0)); let pk = 0; for (const v of o) pk = Math.max(pk, Math.abs(v)); assert.ok(pk > 3000 && pk < 3500, 'boosted x4 (capped so noise is not inflated): ' + pk);
});
test('random-language / looping / prompt-echo hallucinations are dropped, real Hinglish is kept', async () => {
  const { sane, notEcho } = await import('../server/providers/common.js');
  for (const j of ['مرحبا بكم في القناة', 'Спасибо за просмотр', 'ご視聴ありがとうございました', 'ho jayega ho jayega ho jayega ho jayega ho jayega ho jayega', 'Thanks for watching!', 'सब्सक्राइब करना न भूलें']) assert.equal(sane(j), '', j);
  for (const ok of ['Main bank se bol raha hoon', 'मुझे OTP चाहिए', 'haan ji okay', 'Hello, who is this?']) assert.equal(sane(ok), ok, ok);
  assert.equal(notEcho('main bank se bol raha hoon aapka account block ho jayega', 'main bank se bol raha hoon aapka account block ho jayega'), '');
  assert.equal(notEcho('kal dinner pe milte hain', 'main bank se bol raha hoon aapka account'), 'kal dinner pe milte hain');
});
test('junk: punctuation only, looping words and silence hallucinations are dropped', () => {
  for (const j of ['।', '। ।', 'प्रश्न प्रश्न', 'the the the', '...', 'Thank you.']) assert.equal(sane(j), '', j);
  assert.equal(sane('Mujhe OTP chahiye'), 'Mujhe OTP chahiye');
});
