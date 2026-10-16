// API3 provider for any OpenAI-compatible /chat/completions endpoint: OpenAI, Grok (xAI), Groq, ...
import { env, request, wav, ProviderError, normalizeAnalysis, userPrompt, parseJson, strictSchema, keyFamily } from '../common.js';
import { ANALYZE_SYSTEM, ANALYZE_SCHEMA, ROLES_SYSTEM, rolesPrompt } from '../../prompts.js';
const SCHEMA = strictSchema(ANALYZE_SCHEMA);
// Hosts retire model names (e.g. Groq's llama-3.3-70b-versatile for some accounts). If the configured model is refused as unknown, ask the host which
// models THIS key can use and pick the best chat model from it. The result is remembered until the server restarts.
const NOT_CHAT = /whisper|guard|tts|embed|transcrib|moderation|image|dall|vision-preview|orpheus|playai|distil-whisper|safeguard/i;
const PREFER = [/llama-?3\.3.*70b/i, /llama-?4.*(maverick|scout)/i, /gpt-oss-120b/i, /llama-?3\.1.*(70b|405b)/i, /gpt-4\.1(?!.*nano)/i, /gpt-4o/i, /grok-?[34]/i, /70b|120b/i, /qwen.*(32b|72b)/i, /llama.*instruct|llama.*versatile/i, /llama.*8b/i, /gpt-oss-20b/i];
const learned = new Map();
async function discover(baseUrl, key, headers, label) {
  const r = await request(baseUrl + '/models', { headers }, { label, timeoutMs: 12000, retries: 0, key });
  const ids = ((await r.json()).data || []).map((m) => m.id).filter((id) => id && !NOT_CHAT.test(id));
  for (const re of PREFER) { const hit = ids.find((id) => re.test(id)); if (hit) return hit; }
  if (ids.length) return ids[0];
  throw new ProviderError(label + ': this key can list no chat models');
}
export function makeOpenAiCompatLlm({ family, auto, id, label, keyEnv, baseEnv, baseDefault, modelEnv, modelDefault, strict = true, tts = false }) {
  // auto(key) may recognise the key's own host (e.g. a gsk_ key -> Groq) when the user has not set the base URL / model explicitly
  const hostFor = () => (auto && !env(baseEnv) ? auto(env(keyEnv)) : null);
  const baseUrl = () => env(baseEnv) || (hostFor() && hostFor().base) || baseDefault;
  const lk = () => baseUrl() + '|' + env(keyEnv);
  const model = () => learned.get(lk()) || env(modelEnv) || (hostFor() && hostFor().model) || modelDefault;
  const fam = () => (hostFor() && hostFor().family) || (typeof family === 'function' ? family() : family);
  const headers = () => ({ Authorization: 'Bearer ' + env(keyEnv), 'Content-Type': 'application/json' });
  const url = (p) => baseUrl().replace(/\/$/, '') + p;
  const hint = { 401: 'API key invalid', 403: 'key blocked / no access to this model', 404: 'model not found: set ' + modelEnv, 429: 'rate limit / quota' };
  // one chat call; if the model name is refused as unknown, discover a model this key can use and retry once
  const chat = async (body, opt = {}) => {
    const go = () => request(url('/chat/completions'), { method: 'POST', headers: headers(), body: JSON.stringify(Object.assign({ model: model() }, body)) }, Object.assign({ label, key: env(keyEnv), family: fam, hint }, opt));
    try { return await go(); }
    catch (e) {
      if (![400, 404].includes(e.status) || !/model|not found|does not exist|access/i.test(e.message) || env(modelEnv + '_LOCK')) throw e;
      let found; try { found = await discover(baseUrl().replace(/\/$/, ''), env(keyEnv), headers(), label); } catch (d) { throw new ProviderError(e.message + ' (and the model list could not be read: ' + d.message + ')', e.status); }
      if (found === model()) throw e;
      const old = model(); learned.set(lk(), found); console.log(`  ${label}: model "${old}" refused; using "${found}" instead (set ${modelEnv}=${found} in .env to make it permanent)`);
      return go();
    }
  };
  const o = {
    id, label, needs: [keyEnv],
    enabled: () => !!env(keyEnv),
    async analyze(turns, caller) {
      const user = userPrompt(turns, caller);
      // strict json_schema where supported; otherwise json_object mode with the schema spelled out in the prompt
      const sys = strict ? ANALYZE_SYSTEM : ANALYZE_SYSTEM + '\n\nReturn ONLY one JSON object that matches this JSON schema exactly:\n' + JSON.stringify(SCHEMA);
      const response_format = strict ? { type: 'json_schema', json_schema: { name: 'call_analysis', strict: true, schema: SCHEMA } } : { type: 'json_object' };
      const r = await chat({ temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format }, { timeoutMs: +env('LLM_TIMEOUT_MS', 25000) });
      const j = await r.json(); let text; try { text = j.choices[0].message.content; } catch { throw new ProviderError(label + ': unexpected response'); }
      return normalizeAnalysis(parseJson(text));
    },
    async roles(items) {
      const sys = ROLES_SYSTEM + '\n\nReturn ONLY one JSON object: {"labels":[{"i":0,"who":"caller"}, ...]} with who = "caller" or "receiver".';
      const r = await chat({ temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: rolesPrompt(items) }], response_format: { type: 'json_object' } }, { timeoutMs: +env('LLM_TIMEOUT_MS', 25000) });
      const j = await r.json(); let text; try { text = j.choices[0].message.content; } catch { throw new ProviderError(label + ': unexpected response'); }
      return (parseJson(text).labels || []);
    },
    async check() { try { await chat({ max_tokens: 5, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }, { timeoutMs: 15000, retries: 0 }); return { ok: true, model: model() }; } catch (e) { return { ok: false, error: e.message }; } },
  };
  if (tts) {
    o.ttsType = 'audio/wav';
    const cache = new Map();
    o.tts = async (text, lang) => {
      const k = lang + '|' + text; if (cache.has(k)) return cache.get(k);
      const r = await request(url('/audio/speech'), { method: 'POST', headers: headers(), body: JSON.stringify({ model: env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'), voice: env('OPENAI_TTS_VOICE', 'alloy'), input: text, response_format: 'wav', instructions: 'Speak in a calm, clear, formal voice at a steady pace' + (lang === 'hi' ? ', in Hindi.' : '.') }) }, { label, key: env(keyEnv), family: fam, timeoutMs: 30000, hint });
      const out = Buffer.from(await r.arrayBuffer()); cache.set(k, out); return out;
    };
  }
  return o;
}
