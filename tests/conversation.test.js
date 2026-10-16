// Upload-voice test mode: one recording -> turns with caller / receiver.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let el = true;
const srv = http.createServer((req, res) => { const ch = []; req.on('data', (d) => ch.push(d)); req.on('end', () => {
  const body = Buffer.concat(ch).toString('latin1'); const j = (o, c = 200) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.url === '/el/v1/speech-to-text') return j({ words: [
    { text: 'Hello', start: 0.2, end: 0.6, type: 'word', speaker_id: 'speaker_1' }, { text: ' ', type: 'spacing' }, { text: 'who', start: 0.7, end: 0.9, type: 'word', speaker_id: 'speaker_1' }, { text: 'is', start: 0.9, end: 1.0, type: 'word', speaker_id: 'speaker_1' }, { text: 'this', start: 1.0, end: 1.3, type: 'word', speaker_id: 'speaker_1' },
    { text: 'Bank', start: 2.0, end: 2.3, type: 'word', speaker_id: 'speaker_0' }, { text: 'officer', start: 2.3, end: 2.8, type: 'word', speaker_id: 'speaker_0' }, { text: 'share', start: 2.9, end: 3.2, type: 'word', speaker_id: 'speaker_0' }, { text: 'your', start: 3.2, end: 3.4, type: 'word', speaker_id: 'speaker_0' }, { text: 'OTP', start: 3.4, end: 3.8, type: 'word', speaker_id: 'speaker_0' }] });
  if (req.url === '/speech-to-text') return j({ transcript: 'segment text ' + Math.random().toString(36).slice(2, 6) });
  if (req.url.includes(':generateContent')) {                         // API3 labels: the line mentioning "OTP"/"Bank" is the caller, the others the receiver
    const lines = [...JSON.parse(body).contents[0].parts[0].text.matchAll(/\[(\d+)\][^\n]*/g)];
    return j({ candidates: [{ content: { parts: [{ text: JSON.stringify({ labels: lines.map((m) => ({ i: +m[1], who: /OTP|Bank/.test(m[0]) ? 'caller' : 'receiver' })) }) }] } }] });
  }
  j({}, 404);
}); });
await new Promise((r) => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
Object.assign(process.env, { ELEVENLABS_API_KEY: 'el', ELEVENLABS_BASE_URL: base + '/el', SARVAM_API_KEY: 'sv', SARVAM_BASE_URL: base, GEMINI_API_KEY: 'AIzaX', GEMINI_BASE_URL: base + '/v1beta/models', STT_API1: 'sarvam', STT_API2: 'sarvam', LLM_API3: 'gemini' });
const { analyzeRecording, segment } = await import('../server/providers/conversation.js');
const pcmOf = (parts) => { const a = new Int16Array(16000 * parts.reduce((s, p) => s + p[1], 0)); let o = 0; for (const [amp, sec] of parts) { for (let i = 0; i < 16000 * sec; i++) a[o + i] = amp ? Math.round(Math.sin(i / 7) * amp) : 0; o += 16000 * sec; } return a; };

test('every provider keeps a plain-text label (a method called "label" once overwrote it and crashed startup)', async () => {
  const P = await import('../server/providers/index.js');
  for (const o of [...Object.values(P.STT_PROVIDERS), ...Object.values(P.LLM_PROVIDERS)]) assert.equal(typeof o.label, 'string', o.id);
});
test('segment(): cuts a recording at its pauses', () => {
  const s = segment(pcmOf([[0, 0.5], [9000, 2], [0, 1], [9000, 2], [0, 0.5]])); assert.equal(s.length, 2); assert.ok(s[0].end < s[1].start);
});
test('diarizing provider (ElevenLabs) + API3 roles: two voices become caller and receiver, in order', async () => {
  const r = await analyzeRecording(pcmOf([[9000, 5]]));
  assert.match(r.method, /ElevenLabs/); assert.deepEqual(r.turns.map((t) => t.who), ['receiver', 'caller']); assert.equal(r.turns[0].text, 'Hello who is this'); assert.match(r.turns[1].text, /OTP/); assert.ok(r.turns[0].end < r.turns[1].start);
});
test('no diarizer key: cut at pauses, transcribe with API2, API3 labels each piece', async () => {
  delete process.env.ELEVENLABS_API_KEY;
  const r = await analyzeRecording(pcmOf([[0, 0.5], [9000, 2], [0, 1], [9000, 2], [0, 0.5]]));
  assert.match(r.method, /cut at pauses/); assert.equal(r.turns.length, 2); assert.ok(r.turns.every((t) => ['caller', 'receiver'].includes(t.who)));
});
test('API3 unavailable and no voice separation: a clear error instead of guessing', async () => {
  process.env.GEMINI_API_KEY = '';
  await assert.rejects(() => analyzeRecording(pcmOf([[0, 0.5], [9000, 2], [0, 1], [9000, 2]])), /API3/);
});
test.after(() => srv.close());
