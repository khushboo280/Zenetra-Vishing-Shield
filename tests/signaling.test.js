import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io } from 'socket.io-client';
import { attachSignaling } from '../server/signaling.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot() {
  const server = http.createServer(); attachSignaling(server); await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const mk = () => new Promise((res) => { const s = io(url, { transports: ['websocket'] }); s.inbox = []; s.onAny((e, m) => s.inbox.push([e, m])); s.on('connect', () => res(s)); });
  const join = (s, room, role, caller) => new Promise((r) => s.emit('join', { room, role, caller }, r));
  return { server, mk, join };
}

test('offer / answer / ICE / transcript / alert / hangup are relayed between the two peers', async () => {
  const { server, mk, join } = await boot();
  const d = await mk(), c = await mk();
  assert.equal((await join(d, 'ABCD', 'dashboard')).ok, true);
  const a = await join(c, 'abcd', 'caller', { label: 'Unknown number' });
  assert.deepEqual([a.ok, a.peerPresent], [true, true]);
  d.emit('signal', { type: 'offer', sdp: 'x' }); c.emit('signal', { type: 'answer', sdp: 'y' }); c.emit('signal', { type: 'ice', candidate: { c: 1 } });
  d.emit('transcript', { turns: [{ who: 'caller', text: 'hello' }] }); d.emit('alert', { lang: 'en' }); c.emit('stt', { text: 'hi there', segFinal: true, turnEnd: false }); c.emit('hangup');
  await wait(200);
  assert.deepEqual(d.inbox.map((x) => x[0]), ['peer-joined', 'signal', 'signal', 'stt', 'hangup']);
  assert.deepEqual(c.inbox.map((x) => x[0]), ['signal', 'transcript', 'alert']);
  assert.equal(d.inbox[0][1].caller.label, 'Unknown number');
  c.close(); await wait(150);
  assert.equal(d.inbox.at(-1)[0], 'peer-left');
  d.close(); server.close();
});

test('rooms reject bad codes and a second peer of the same role', async () => {
  const { server, mk, join } = await boot();
  const a = await mk(), b = await mk();
  assert.equal((await join(a, '!!', 'dashboard')).ok, false);
  assert.equal((await join(a, 'ROOM1', 'dashboard')).ok, true);
  assert.equal((await join(b, 'ROOM1', 'dashboard')).ok, false);
  a.close(); b.close(); server.close();
});

test('transcribe: API1 for the receiver stream, API2 for the caller stream (different vendors); analyze goes to API3; errors are readable', async () => {
  const fake = http.createServer((req, res) => { const ch = []; req.on('data', (d) => ch.push(d)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/speech-to-text') return res.end('{"transcript":"receiver words"}');
    if (req.url === '/v1/audio/transcriptions') return res.end('{"text":"caller words"}');
    if (req.url.includes('generateContent')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ relationship: 'stranger', familiarity: 3, mutual_recognition: false, identity_claim_unverified: false, intent_risk: 80, manipulation: 70, sentiment_risk: 50, receiver_compliance: 10, asks_sensitive: true, stages: { authority: true, pressure: true, secrecy: false, demand: true }, alert_level: 3, alert_reason: 'otp', language: 'en', confidence: 0.9, summary: 's', evidence: [] }) }] } }] }));
    res.statusCode = 404; res.end('{}'); }); });
  await new Promise((r) => fake.listen(0, r)); const b = `http://127.0.0.1:${fake.address().port}`;
  const keep = { ...process.env };
  Object.assign(process.env, { STT_API1: 'sarvam', STT_API2: 'openai', LLM_API3: 'gemini', SARVAM_BASE_URL: b, SARVAM_API_KEY: 'k', OPENAI_BASE_URL: b + '/v1', OPENAI_API_KEY: 'k', GEMINI_BASE_URL: b + '/m', GEMINI_API_KEY: 'k' });
  const { server, mk, join } = await boot(); const d = await mk(), c = await mk();
  await join(d, 'ROOM9', 'dashboard'); await join(c, 'ROOM9', 'caller');
  const tr = (s, who) => new Promise((r) => s.emit('transcribe', { who, pcm: Int16Array.from({ length: 16000 }, (_, i) => Math.round(Math.sin(i / 9) * 6000)).buffer, ctx: '' }, r));
  const r1 = await tr(d, 'receiver'); assert.ok(typeof r1.ms === 'number'); delete r1.ms; assert.deepEqual(r1, { ok: true, who: 'receiver', provider: 'sarvam', text: 'receiver words' });
  const r2 = await tr(d, 'caller'); delete r2.ms; assert.deepEqual(r2, { ok: true, who: 'caller', provider: 'openai', text: 'caller words' });
  const forged = await tr(c, 'receiver'); assert.equal(forged.who, 'caller', 'a caller-role socket can only submit caller audio');
  const an = await new Promise((r) => d.emit('analyze', { turns: [{ who: 'caller', text: 'OTP do' }], caller: {} }, r)); assert.equal(an.ok, true); assert.equal(an.result.alertLevel, 3);
  const denied = await new Promise((r) => c.emit('analyze', { turns: [] }, r)); assert.equal(denied.ok, false);
  delete process.env.OPENAI_API_KEY; const nokey = await tr(d, 'caller'); assert.equal(nokey.ok, false); assert.match(nokey.error, /OPENAI_API_KEY/);
  Object.assign(process.env, keep); d.close(); c.close(); server.close(); fake.close();
});
