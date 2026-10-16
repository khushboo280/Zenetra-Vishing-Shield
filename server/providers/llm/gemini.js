// API3 provider: Google Gemini (REST, no SDK). Also provides the spoken alert (TTS).
import { env, request, sleep, wav, ProviderError, normalizeAnalysis, userPrompt, parseJson } from '../common.js';
import { ANALYZE_SYSTEM, ANALYZE_SCHEMA, ROLES_SYSTEM, ROLES_SCHEMA, rolesPrompt } from '../../prompts.js';

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'];   // each model has its OWN quota
let goodModel = null, discovered = null, noThink = false;
const base = () => env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/models').replace(/\/$/, '');
async function once(model, body, useQuery) {
  const key = env('GEMINI_API_KEY');
  // Gemini 2.5 'thinks' before answering (3-8 s). Scoring a transcript does not need it: budget 0 = answer immediately.
  if (!noThink && /gemini-2\.5-flash/.test(model) && body.generationConfig && !body.generationConfig.responseModalities) body = Object.assign({}, body, { generationConfig: Object.assign({}, body.generationConfig, { thinkingConfig: { thinkingBudget: 0 } }) });
  const headers = { 'Content-Type': 'application/json' }; if (!useQuery) headers['x-goog-api-key'] = key;
  const r = await request(`${base()}/${model}:generateContent` + (useQuery ? `?key=${encodeURIComponent(key)}` : ''), { method: 'POST', headers, body: JSON.stringify(body) }, { label: 'Gemini', key, family: 'gemini', timeoutMs: +env('GEMINI_TIMEOUT_MS', 15000), retries: 0 });
  return r.json();
}
/** Ask Google which models THIS key may use (names change and old ones are retired): newest flash models that support generateContent. */
async function discover() {
  if (discovered) return discovered;
  try {
    const key = env('GEMINI_API_KEY'), r = await request(`${base()}?pageSize=200`, { headers: { 'x-goog-api-key': key } }, { label: 'Gemini model list', key, family: 'gemini', timeoutMs: 8000, retries: 0 });
    const j = await r.json(), ok = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, '')).filter((n) => /^gemini-[\d.]+-flash(-lite)?(-latest)?$|^gemini-flash(-lite)?-latest$/.test(n));
    const rank = (n) => -((+((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 99) * 10) + (/lite/.test(n) ? 1 : 0);   // newest first, full flash before lite
    discovered = ok.sort((x, y) => rank(x) - rank(y));
  } catch (e) { discovered = []; }
  return discovered;
}
export const retryHint = (e) => { if (e && e.retryMs) return e.retryMs; const m = /retry in ([\d.]+)s|"retryDelay":\s*"(\d+)s"/i.exec(String(e && e.message)); return m ? Math.ceil(+(m[1] || m[2]) * 1000) : 0; };
async function generate(model, body) {
  if (!env('GEMINI_API_KEY')) throw new ProviderError('GEMINI_API_KEY is not set (run: npm run setup)');
  const main = env('GEMINI_MODEL', 'gemini-2.5-flash');
  let models = [...new Set([goodModel && model === main ? goodModel : model, ...(model === main ? FALLBACK_MODELS : [])].filter(Boolean))], triedDiscovery = false;
  let last, quota = 0, tried = 0;
  for (let i = 0; i < models.length; i++) {
    const m = models[i]; let q = false; tried++;
    for (let a = 0; a < 3; a++) {
      try { const r = await once(m, body, q); if (model === main) goodModel = m; return r; }
      catch (e) { last = e;
        if ((e.status === 401 || e.status === 403) && !q) { q = true; continue; }
        if (e.status === 400 && /thinking/i.test(e.message) && !noThink) { noThink = true; continue; }          // this model does not take thinkingBudget: retry without it
        if (e.status >= 500 || e.status === 0) { await sleep(400); continue; }
        if (e.status === 429) quota++;
        break; }
    }
    if (last && (last.status === 401 || last.status === 403)) break;
    if (i === models.length - 1 && !triedDiscovery && model === main && last && [400, 404].includes(last.status)) {   // every known name failed: ask Google what exists
      triedDiscovery = true; const d = (await discover()).filter((n) => !models.includes(n)); if (d.length) models = models.concat(d);
    }
  }
  if (quota && quota === tried) {
    const zero = /limit:\s*0\b/.test(last.message), wait = retryHint(last);
    throw Object.assign(new ProviderError(zero
      ? 'Gemini: this key has NO free quota for these models (Google shows "limit: 0" - typical for a key from a project without free tier, or in some countries). Fix: create a NEW key at aistudio.google.com/apikey ("Create API key in new project"), or enable billing on the project, or choose Groq (free) as API3 in npm run setup.'
      : 'Gemini free-tier limit reached on every model (about 5-15 requests/minute per model). Wait a minute, enable billing on the key, or choose another LLM_API3.', 429), { retryMs: wait });
  }
  throw last;
}
const textOf = (resp) => { try { return resp.candidates[0].content.parts.map((p) => p.text || '').join(''); } catch { throw new ProviderError('Gemini: unexpected response ' + JSON.stringify(resp).slice(0, 160)); } };
const ttsCache = new Map();
export default {
  id: 'gemini', label: 'Gemini', needs: ['GEMINI_API_KEY'], ttsType: 'audio/wav',
  enabled: () => !!env('GEMINI_API_KEY'),
  async analyze(turns, caller) {
    const user = userPrompt(turns, caller), main = env('GEMINI_MODEL', 'gemini-2.5-flash');
    const req = (cfg) => ({ systemInstruction: { parts: [{ text: ANALYZE_SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: Object.assign({ temperature: 0, responseMimeType: 'application/json' }, cfg) });
    let resp; try { resp = await generate(main, req({ responseSchema: ANALYZE_SCHEMA })); } catch (e) { if (e.status !== 400) throw e; resp = await generate(main, req({})); }
    return normalizeAnalysis(parseJson(textOf(resp)));
  },
  async roles(items) {
    const main = env('GEMINI_MODEL', 'gemini-2.5-flash');
    const resp = await generate(main, { systemInstruction: { parts: [{ text: ROLES_SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: rolesPrompt(items) }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: ROLES_SCHEMA } });
    return (parseJson(textOf(resp)).labels || []);
  },
  async tts(text, lang) {
    const key = lang + '|' + text; if (ttsCache.has(key)) return ttsCache.get(key);
    const resp = await generate(env('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'), { contents: [{ role: 'user', parts: [{ text: 'Say in a calm, clear, formal voice at a steady pace' + (lang === 'hi' ? ' in Hindi' : '') + ': ' + text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env('GEMINI_TTS_VOICE', 'Kore') } } } } });
    let b64; try { b64 = resp.candidates[0].content.parts[0].inlineData.data; } catch { throw new ProviderError('Gemini TTS returned no audio'); }
    const out = wav(Buffer.from(b64, 'base64'), 24000); ttsCache.set(key, out); return out;
  },
  async check() { try { await generate(env('GEMINI_MODEL', 'gemini-2.5-flash'), { contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }], generationConfig: { maxOutputTokens: 8 } }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } },
};
