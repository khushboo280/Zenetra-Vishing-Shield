// Every provider is exercised against a local fake HTTP server that speaks that vendor's wire format. No real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const seen = [];
const srv = http.createServer((req, res) => { const ch = []; req.on('data', (d) => ch.push(d)); req.on('end', () => {
  const raw = Buffer.concat(ch), body = raw.toString('latin1'); seen.push({ url: req.url, h: req.headers, body });
  const json = (o, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const A = { relationship: 'stranger', familiarity: 4, mutual_recognition: false, identity_claim_unverified: true, intent_risk: 88, manipulation: 75, sentiment_risk: 60, receiver_compliance: 5, asks_sensitive: true, stages: { authority: true, pressure: true, secrecy: false, demand: true }, alert_level: 3, alert_now: true, alert_reason: 'asks OTP', language: 'hn', confidence: 0.9, summary: 'Caller asks for the OTP', evidence: [{ quote: 'OTP batao', category: 'otp', why: 'sensitive' }] };
  if (req.url === '/speech-to-text') return req.headers['api-subscription-key'] === 'good' ? json({ transcript: body.includes('JUNK') ? '।' : ' मुझे OTP चाहिए ' }) : json({ error: { message: 'Invalid API key' } }, 403);
  if (req.url === '/v1/audio/transcriptions') return json({ text: 'openai heard this' });
  if (req.url === '/el/v1/speech-to-text') return req.headers['xi-api-key'] === 'el' ? (body.includes('scribe_v2') ? json({ detail: { message: 'invalid model' } }, 422) : json({ text: 'elevenlabs heard this', language_code: 'hin' })) : json({ detail: 'bad key' }, 401);
  if (req.url === '/groq/audio/transcriptions') return json({ text: 'groq heard this' });
  if (req.url.startsWith('/dg/v1/listen')) return json({ results: { channels: [{ alternatives: [{ transcript: 'deepgram heard this' }] }] } });
  if (req.url.includes('gemini-2.5-flash:')) return json({ error: { message: 'quota' } }, 429);
  if (req.url.includes(':generateContent')) return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(A) }] } }] });
  if (req.url === '/v1/chat/completions' || req.url === '/xai/chat/completions') return json({ choices: [{ message: { content: JSON.stringify(Object.assign({}, A, req.url.startsWith('/xai') ? { alert_level: 2 } : {})) } }] });
  json({ error: 'nope' }, 404);
}); });
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
Object.assign(process.env, { SARVAM_BASE_URL: base, SARVAM_API_KEY: 'good', OPENAI_BASE_URL: base + '/v1', OPENAI_API_KEY: 'sk', GROQ_BASE_URL: base + '/groq', GROQ_API_KEY: 'gq', DEEPGRAM_BASE_URL: base + '/dg', DEEPGRAM_API_KEY: 'dg', GEMINI_BASE_URL: base + '/v1beta/models', GEMINI_API_KEY: 'g', XAI_BASE_URL: base + '/xai', XAI_API_KEY: 'x', LLAMA_BASE_URL: base + '/xai', LLAMA_API_KEY: 'lm', LLAMA_MODEL: 'Llama-test', ELEVENLABS_BASE_URL: base + '/el', ELEVENLABS_API_KEY: 'el' });
const P = await import('../server/providers/index.js');
const set = (a1, a2, a3) => Object.assign(process.env, { STT_API1: a1, STT_API2: a2, LLM_API3: a3 });
const tone = new Int16Array(32000); for (let i = 0; i < tone.length; i++) tone[i] = Math.round(Math.sin(i / 9) * 6000);
const pcm = Buffer.from(tone.buffer);
const turns = [{ who: 'caller', text: 'OTP batao' }, { who: 'receiver', text: 'kaun?' }];

test('API1 and API2 can use DIFFERENT vendors; each stream is routed to its own', async () => {
  set('sarvam', 'openai', 'gemini'); seen.length = 0;
  assert.equal(await P.transcribe('receiver', pcm), 'मुझे OTP चाहिए');
  assert.equal(await P.transcribe('caller', pcm), 'openai heard this');
  assert.equal(seen[0].url, '/speech-to-text'); assert.equal(seen[0].h['api-subscription-key'], 'good'); assert.match(seen[0].body, /RIFF/); assert.match(seen[0].body, /saaras:v3/); assert.match(seen[0].body, /codemix/);
  assert.equal(seen[1].url, '/v1/audio/transcriptions'); assert.equal(seen[1].h.authorization, 'Bearer sk'); assert.match(seen[1].body, /gpt-4o-transcribe/);
});
test('swap vendors with env only: groq, whisper, deepgram', async () => {
  set('groq', 'deepgram', 'gemini'); assert.equal(await P.transcribe('receiver', pcm), 'groq heard this'); assert.equal(await P.transcribe('caller', pcm), 'deepgram heard this');
  set('whisper', 'whisper', 'gemini'); seen.length = 0; assert.equal(await P.transcribe('caller', pcm), 'openai heard this'); assert.match(seen[0].body, /whisper-1/);
});
test('ElevenLabs Scribe: xi-api-key header, multipart WAV, falls back to scribe_v1 if the model is refused', async () => {
  set('elevenlabs', 'elevenlabs', 'gemini'); seen.length = 0;
  assert.equal(await P.transcribe('receiver', pcm), 'elevenlabs heard this');
  assert.equal(seen[0].url, '/el/v1/speech-to-text'); assert.equal(seen[0].h['xi-api-key'], 'el'); assert.match(seen[0].body, /RIFF/); assert.match(seen[0].body, /scribe_v2/); assert.match(seen.at(-1).body, /scribe_v1/);
  process.env.ELEVENLABS_API_KEY = 'wrong'; await assert.rejects(() => P.transcribe('caller', pcm), /ElevenLabs HTTP 401.*API key invalid/); process.env.ELEVENLABS_API_KEY = 'el';
});
test('junk output is dropped, bad key gives a readable error, unknown provider name is rejected', async () => {
  set('sarvam', 'sarvam', 'gemini');
  const real = process.env.SARVAM_API_KEY; process.env.SARVAM_API_KEY = 'bad';
  await assert.rejects(() => P.transcribe('receiver', pcm), /Sarvam HTTP 403.*API key invalid/);
  const ck = await P.checkAll(); assert.equal(ck.api1.ok, false); assert.equal(ck.api3.ok, true);
  process.env.SARVAM_API_KEY = real;
  set('nonsense', 'sarvam', 'gemini'); assert.throws(() => P.slots(), /STT_API1=nonsense is not a known provider/);
  set('sarvam', 'sarvam', 'gemini');
  await assert.rejects(() => P.transcribe('caller', Buffer.alloc(100)), /too short/);
  seen.length = 0; assert.equal(await P.transcribe('caller', Buffer.alloc(32000, 1)), '', 'silence is never sent to a recogniser'); assert.equal(seen.length, 0);
});
test('API3 gemini: model fallback on 429, alert_level 3 -> alert', async () => {
  set('sarvam', 'sarvam', 'gemini'); seen.length = 0;
  const r = await P.llm().analyze(turns, { label: 'Unknown number' });
  assert.equal(r.alertLevel, 3); assert.equal(r.alert, true); assert.equal(r.alertNow, true); assert.equal(r.intent, 88); assert.equal(r.claimUnverified, true); assert.equal(r.familiar, false); assert.equal(r.evidence[0].category, 'otp');
  assert.match(JSON.stringify(seen.at(-1).body), /CALLER: OTP batao/); assert.ok(seen.some((s) => s.url.includes('flash-lite')), 'ended on the fallback model (the earlier health check already learned that 2.5-flash is rate-limited)');
});
test('API3 swap: openai (strict json_schema) and grok (json_object + schema in prompt)', async () => {
  set('sarvam', 'sarvam', 'openai'); seen.length = 0;
  let r = await P.llm().analyze(turns, {}); assert.equal(r.alertLevel, 3);
  let b = JSON.parse(seen[0].body); assert.equal(b.response_format.type, 'json_schema'); assert.equal(b.response_format.json_schema.strict, true); assert.equal(b.response_format.json_schema.schema.additionalProperties, false); assert.equal(seen[0].h.authorization, 'Bearer sk');
  set('sarvam', 'sarvam', 'grok'); seen.length = 0;
  r = await P.llm().analyze(turns, {}); assert.equal(r.alertLevel, 2); assert.equal(r.alert, true);
  b = JSON.parse(seen[0].body); assert.equal(b.response_format.type, 'json_object'); assert.match(b.messages[0].content, /alert_level/); assert.equal(seen[0].h.authorization, 'Bearer x');
});
test('API3 llama: OpenAI-compatible host chosen by LLAMA_BASE_URL, json_object mode, configured model', async () => {
  set('sarvam', 'sarvam', 'llama'); seen.length = 0;
  const r = await P.llm().analyze(turns, {}); assert.equal(r.alertLevel, 2);
  const b = JSON.parse(seen[0].body); assert.equal(b.model, 'Llama-test'); assert.equal(b.response_format.type, 'json_object'); assert.equal(seen[0].h.authorization, 'Bearer lm'); assert.equal(seen[0].url, '/xai/chat/completions');
});
test('wrong-service key: 401 explains which service the key belongs to; llama auto-detects Groq / OpenRouter keys', async () => {
  const { keyFamily, mismatchAdvice } = await import('../server/providers/common.js');
  assert.equal(keyFamily('gsk_abc123'), 'groq'); assert.equal(keyFamily('AIzaSyA-xyz'), 'gemini'); assert.equal(keyFamily('sk-proj-' + 'a'.repeat(30)), 'openai'); assert.equal(keyFamily('sk-or-v1-abc'), 'openrouter'); assert.equal(keyFamily('xai-abc'), 'xai');
  assert.match(mismatchAdvice('gsk_abc', 'meta', 'Llama'), /looks like a Groq key.*LLM_API3=groq/);
  // gemini key sent to a Llama host that rejects it (fake host answers 401 for unknown keys)
  const bad = http.createServer((q, r) => { r.statusCode = 401; r.end('{"error":{"message":"Authentication Error"}}'); }); await new Promise((r) => bad.listen(0, r));
  const keep = { b: process.env.LLAMA_BASE_URL, k: process.env.LLAMA_API_KEY };
  Object.assign(process.env, { LLAMA_BASE_URL: `http://127.0.0.1:${bad.address().port}`, LLAMA_API_KEY: 'AIzaSyFAKEFAKEFAKEFAKEFAKE' }); set('sarvam', 'sarvam', 'llama');
  const c = await P.llm().check(); assert.equal(c.ok, false); assert.match(c.error, /HTTP 401.*looks like a Google Gemini key.*LLM_API3=gemini.*127\.0\.0\.1/);
  // a Groq key with no explicit base URL goes to Groq's host with a Llama model
  delete process.env.LLAMA_BASE_URL; delete process.env.LLAMA_MODEL; process.env.LLAMA_API_KEY = 'gsk_test';
  const seenHosts = []; const orig = globalThis.fetch; globalThis.fetch = async (u, i) => { seenHosts.push([String(u), JSON.parse(i.body).model]); return new Response('{"error":{"message":"x"}}', { status: 401 }); };
  await P.llm().check(); globalThis.fetch = orig; assert.deepEqual(seenHosts[0], ['https://api.groq.com/openai/v1/chat/completions', 'llama-3.3-70b-versatile']);
  Object.assign(process.env, { LLAMA_BASE_URL: keep.b || base + '/xai', LLAMA_API_KEY: keep.k || 'lm', LLAMA_MODEL: 'Llama-test' }); bad.close();
});
test('retired / unavailable model: discovers a usable chat model from the host and retries', async () => {
  const hits = [];
  const h = http.createServer((q, r) => { const ch = []; q.on('data', (d) => ch.push(d)); q.on('end', () => { r.setHeader('content-type', 'application/json'); const b = Buffer.concat(ch).toString();
    hits.push(q.url + ' ' + (b ? JSON.parse(b).model : ''));
    if (q.url === '/v1/models') return r.end(JSON.stringify({ data: [{ id: 'whisper-large-v3' }, { id: 'llama-guard-4-12b' }, { id: 'llama-3.1-8b-instant' }, { id: 'meta-llama/llama-4-scout-17b' }, { id: 'llama-3.2-1b' }] }));
    if (JSON.parse(b).model !== 'meta-llama/llama-4-scout-17b') { r.statusCode = 404; return r.end('{"error":{"message":"The model `llama-3.3-70b-versatile` does not exist or you do not have access to it."}}'); }
    r.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); }); });
  await new Promise((r) => h.listen(0, r));
  const keep = { b: process.env.GROQ_BASE_URL, m: process.env.GROQ_LLM_MODEL };
  Object.assign(process.env, { GROQ_BASE_URL: `http://127.0.0.1:${h.address().port}/v1`, GROQ_LLM_MODEL: 'llama-3.3-70b-versatile' }); set('sarvam', 'sarvam', 'groq');
  const c = await P.llm().check(); assert.equal(c.ok, true, c.error); assert.equal(c.model, 'meta-llama/llama-4-scout-17b');
  assert.ok(hits[0].endsWith('llama-3.3-70b-versatile') && hits[1] === '/v1/models ' && hits[2].endsWith('llama-4-scout-17b'), hits.join(' | '));
  Object.assign(process.env, { GROQ_BASE_URL: keep.b || '', GROQ_LLM_MODEL: keep.m || '' }); h.close();
});
test('FAMILIARITY OVERRIDE is enforced even if the model still returns an alert level', async () => {
  const { normalizeAnalysis } = await import('../server/providers/common.js');
  const r = normalizeAnalysis({ relationship: 'family', familiarity: 92, mutual_recognition: true, identity_claim_unverified: false, intent_risk: 70, manipulation: 60, sentiment_risk: 40, receiver_compliance: 50, asks_sensitive: true, stages: {}, alert_level: 3, alert_reason: 'otp', language: 'hn', confidence: 0.9, summary: 's', evidence: [] });
  assert.equal(r.alertLevel, 0); assert.equal(r.alert, false); assert.equal(r.alertNow, false); assert.equal(r.familiar, true);
  const s = normalizeAnalysis({ relationship: 'family', familiarity: 92, mutual_recognition: true, identity_claim_unverified: true, alert_level: 3, stages: {} });
  assert.equal(s.alertLevel, 3, 'a caller who only CLAIMS to be family is not exempt');
});
test('API3 gets the alert history, Gemini thinking is off for latency, TTS provider is chosen (ElevenLabs mp3)', async () => {
  set('sarvam', 'sarvam', 'gemini'); seen.length = 0;
  await P.llm().analyze(turns, { label: 'Unknown number', alertsSpoken: 1, secondsSinceAlert: 31, callSeconds: 80 });
  const b = JSON.parse(seen.at(-1).body); assert.match(JSON.stringify(b.contents), /Spoken alerts already played in this call: 1, the last one 31 s ago/); assert.equal(b.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(P.ttsProvider().id, 'gemini'); process.env.TTS_API = 'elevenlabs'; assert.equal(P.ttsProvider().id, 'elevenlabs'); assert.equal(P.ttsProvider().ttsType, 'audio/mpeg'); process.env.TTS_API = 'none'; assert.equal(P.ttsProvider(), null); delete process.env.TTS_API;
});
test('empty transcript is rejected before any API call', async () => {
  set('sarvam', 'sarvam', 'gemini'); seen.length = 0;
  await assert.rejects(() => P.llm().analyze([{ who: 'caller', text: '  ' }], {}), /empty transcript/); assert.equal(seen.length, 0);
});
test.after(() => srv.close());
