// Gemini as API3: retired model names are replaced by what Google really offers for the key; rate limits become a clear message + retry hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let mode = 'ok'; const hits = [];
const A = { relationship: 'stranger', familiarity: 3, mutual_recognition: false, identity_claim_unverified: false, intent_risk: 10, manipulation: 5, sentiment_risk: 0, receiver_compliance: 0, asks_sensitive: false, stages: {}, alert_level: 0, alert_reason: '', language: 'en', confidence: 0.9, summary: 's', evidence: [] };
const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => {
  hits.push(req.method + ' ' + req.url); const j = (o, c = 200) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.method === 'GET') return j({ models: [{ name: 'models/gemini-7-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-7-pro', supportedGenerationMethods: ['generateContent'] }] });
  if (mode === 'limit') return j({ error: { code: 429, message: 'You exceeded your current quota. Please retry in 23.4s.' } }, 429);
  if (req.url.includes('gemini-7-flash:')) return j({ candidates: [{ content: { parts: [{ text: JSON.stringify(A) }] } }] });
  j({ error: { message: 'models/x is not found for API version v1beta, or is not supported for generateContent.' } }, 404);
}); });
await new Promise((r) => srv.listen(0, r));
Object.assign(process.env, { GEMINI_API_KEY: 'AIzaTEST', GEMINI_BASE_URL: `http://127.0.0.1:${srv.address().port}/v1beta/models`, GEMINI_MODEL: 'gemini-retired-1' });
const { default: gemini, retryHint } = await import('../server/providers/llm/gemini.js');

test('every known model name is gone (404) -> the server lists the key\'s models and uses the newest flash one', async () => {
  const r = await gemini.analyze([{ who: 'caller', text: 'hello' }], {});
  assert.equal(r.alertLevel, 0); assert.ok(hits.some((h) => h.startsWith('GET')), 'asked Google for the model list'); assert.ok(hits.some((h) => h.includes('gemini-7-flash:generateContent')));
  assert.ok(!hits.some((h) => h.includes('gemini-7-pro')), 'only flash models are picked');
});
test('rate limit on every model -> clear message and a retry hint (the page then waits instead of hammering)', async () => {
  mode = 'limit';
  await assert.rejects(() => gemini.analyze([{ who: 'caller', text: 'hello again' }], {}), (e) => { assert.equal(e.status, 429); assert.match(e.message, /limit/i); assert.equal(retryHint(e), 23400); return true; });
});
test.after(() => srv.close());
