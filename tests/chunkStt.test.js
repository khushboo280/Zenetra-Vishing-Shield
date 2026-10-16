// The client-side segmenter is pure logic, so it is tested directly: latency of cutting, leak/echo rejection, parallel requests.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.performance ??= { now: () => Date.now() };
const { ChunkStt } = await import('../src/live/chunkStt.js');
const frame = () => new Int16Array(1600).fill(3000).buffer;                       // 100 ms @16 kHz
function rig(opt = {}) {
  const sent = []; const socket = { timeout: () => ({ emit: (ev, p, cb) => { sent.push({ p, cb }); } }) };
  const st = { speaking: false, leak: false }; const texts = [];
  const s = new ChunkStt(Object.assign({ who: 'receiver', socket, isSpeaking: () => st.speaking, isLeak: () => st.leak, onText: (t, t0) => texts.push([t, t0]) }, opt));
  let clock = 1000; const feed = (ms, speaking, leak = false) => { st.speaking = speaking; st.leak = leak; for (let i = 0; i < ms / 100; i++) { clock += 100; s.push(frame(), clock); } };
  return { s, sent, feed, texts, clock: () => clock };
}
test('a sentence is sent about 0.4 s after the speaker stops (not >1 s)', () => {
  const r = rig(); r.feed(1500, true); assert.equal(r.sent.length, 0); r.feed(300, false); assert.equal(r.sent.length, 0, 'still inside the hang time'); r.feed(200, false); assert.equal(r.sent.length, 1);
});
test('a long monologue is split at its first pause after 3.5 s, and hard-capped at 7 s', () => {
  const r = rig(); r.feed(3600, true); r.feed(200, false); assert.equal(r.sent.length, 1, 'soft split at the dip');
  const q = rig(); q.feed(7300, true); assert.ok(q.sent.length >= 1, 'hard cap flushes without any pause');
});
test('clicks, and chunks that are mostly echo of the other side, are never sent', () => {
  const r = rig(); r.feed(200, true); r.feed(600, false); assert.equal(r.sent.length, 0, 'too short');
  const e = rig(); e.feed(1500, true, true); e.feed(600, false); assert.equal(e.sent.length, 0, 'leak');
  const m = rig(); m.feed(1000, true, true); m.feed(1000, true, false); m.feed(600, false); assert.equal(m.sent.length, 1, 'half real speech passes');
});
test('two requests in flight, answers merged by start time, latency is measured', () => {
  const r = rig(); r.feed(1000, true); r.feed(500, false); r.feed(1000, true); r.feed(500, false);
  assert.equal(r.sent.length, 2, 'second utterance does not wait for the first answer');
  r.sent[1].cb(null, { ok: true, text: 'second', ms: 400 }); r.sent[0].cb(null, { ok: true, text: 'first', ms: 900 });
  assert.deepEqual(r.texts.map((x) => x[0]), ['second', 'first']); assert.ok(r.texts[0][1] > r.texts[1][1], 'carries each utterance start so the transcript can be ordered');
  assert.ok(r.s.rt > 0 && Number.isFinite(r.s.lat));
});
