// Provider registry. THE ONLY PLACE that knows which vendor does what:
//   API1 = speech-to-text for the RECEIVER's microphone     (STT_API1, default sarvam)
//   API2 = speech-to-text for the CALLER's audio            (STT_API2, default sarvam)
//   API3 = the LLM observer that scores the merged transcript (LLM_API3, default gemini)
// Swap a vendor by changing one value in .env (npm run setup asks). To add a vendor: add one file here and one line below.
import { env, prep, level, ProviderError, keyFamily } from './common.js';
export { ProviderError };
import sarvam from './stt/sarvam.js';
import deepgram from './stt/deepgram.js';
import elevenlabs from './stt/elevenlabs.js';
import { makeOpenAiCompatStt } from './stt/openaiCompat.js';
import gemini from './llm/gemini.js';
import { makeOpenAiCompatLlm } from './llm/openaiCompat.js';

// Llama can run on several hosts, and a key only works on its own host. Recognise the common ones from the key itself.
const llamaHost = (key) => { const f = keyFamily(key);
  if (f === 'groq') return { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', family: 'groq' };
  if (f === 'openrouter') return { base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct', family: 'openrouter' };
  return null; };
export const STT_PROVIDERS = {
  sarvam,
  deepgram,
  elevenlabs,
  openai: makeOpenAiCompatStt({ family: 'openai', id: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', baseEnv: 'OPENAI_BASE_URL', baseDefault: 'https://api.openai.com/v1', modelEnv: 'OPENAI_STT_MODEL', modelDefault: 'gpt-4o-transcribe', fallbackModel: 'whisper-1', langEnv: 'OPENAI_STT_LANGUAGE' }),
  whisper: makeOpenAiCompatStt({ family: 'openai', id: 'whisper', label: 'Whisper (OpenAI)', keyEnv: 'OPENAI_API_KEY', baseEnv: 'OPENAI_BASE_URL', baseDefault: 'https://api.openai.com/v1', modelEnv: 'WHISPER_MODEL', modelDefault: 'whisper-1', langEnv: 'OPENAI_STT_LANGUAGE' }),
  groq: makeOpenAiCompatStt({ family: 'groq', id: 'groq', label: 'Whisper (Groq)', keyEnv: 'GROQ_API_KEY', baseEnv: 'GROQ_BASE_URL', baseDefault: 'https://api.groq.com/openai/v1', modelEnv: 'GROQ_STT_MODEL', modelDefault: 'whisper-large-v3', langEnv: 'GROQ_LANGUAGE' }),
};
export const LLM_PROVIDERS = {
  gemini,
  openai: makeOpenAiCompatLlm({ family: 'openai', id: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', baseEnv: 'OPENAI_BASE_URL', baseDefault: 'https://api.openai.com/v1', modelEnv: 'OPENAI_MODEL', modelDefault: 'gpt-4.1-mini', strict: true, tts: true }),
  grok: makeOpenAiCompatLlm({ family: 'xai', id: 'grok', label: 'Grok (xAI)', keyEnv: 'XAI_API_KEY', baseEnv: 'XAI_BASE_URL', baseDefault: 'https://api.x.ai/v1', modelEnv: 'XAI_MODEL', modelDefault: 'grok-4', strict: false }),
  // Llama through ANY OpenAI-compatible host: Meta Llama API (default), Together, OpenRouter, Fireworks, a local Ollama (http://localhost:11434/v1) ... change LLAMA_BASE_URL + LLAMA_MODEL
  llama: makeOpenAiCompatLlm({ family: 'meta', auto: llamaHost, id: 'llama', label: 'Llama', keyEnv: 'LLAMA_API_KEY', baseEnv: 'LLAMA_BASE_URL', baseDefault: 'https://api.llama.com/compat/v1', modelEnv: 'LLAMA_MODEL', modelDefault: 'Llama-3.3-70B-Instruct', strict: false }),
  groq: makeOpenAiCompatLlm({ family: 'groq', id: 'groq', label: 'Groq (LLM)', keyEnv: 'GROQ_API_KEY', baseEnv: 'GROQ_BASE_URL', baseDefault: 'https://api.groq.com/openai/v1', modelEnv: 'GROQ_LLM_MODEL', modelDefault: 'llama-3.3-70b-versatile', strict: false }),
};
// Spoken alerts: whichever of these can talk. TTS_API=gemini|openai|elevenlabs|sarvam|none forces one; default = API3's own voice if it has one, else the first available.
const TTS = () => ({ gemini: LLM_PROVIDERS.gemini, openai: LLM_PROVIDERS.openai, elevenlabs: STT_PROVIDERS.elevenlabs, sarvam: STT_PROVIDERS.sarvam });
export function ttsProvider() {
  const t = TTS(), want = env('TTS_API').toLowerCase(); if (want === 'none') return null;
  if (want) return t[want] && t[want].enabled() ? t[want] : null;
  const a3 = LLM_PROVIDERS[env('LLM_API3', 'gemini').toLowerCase()];
  return [a3, t.sarvam, t.elevenlabs, t.openai, t.gemini].find((p) => p && typeof p.tts === 'function' && p.enabled()) || null;
}
const pick = (table, name, slot) => { const p = table[String(name).toLowerCase()]; if (!p) throw new ProviderError(`${slot}=${name} is not a known provider (choose: ${Object.keys(table).join(', ')})`); return p; };

// read the env at call time, so changing .env + restart (or a test) is all it takes
export const slots = () => ({
  api1: pick(STT_PROVIDERS, env('STT_API1', 'sarvam'), 'STT_API1'),
  api2: pick(STT_PROVIDERS, env('STT_API2', 'sarvam'), 'STT_API2'),
  api3: pick(LLM_PROVIDERS, env('LLM_API3', 'gemini'), 'LLM_API3'),
});
export const slotFor = (who) => (who === 'caller' ? 'api2' : 'api1');
export const sttFor = (who) => slots()[slotFor(who)];
export const llm = () => slots().api3;
export const sttReady = () => { const s = slots(); return s.api1.enabled() && s.api2.enabled(); };
export const llmReady = () => llm().enabled();
export const callerSource = () => (env('CALLER_STT_SOURCE', 'remote') === 'device' ? 'device' : 'remote');   // remote = the receiver page transcribes the caller's WebRTC audio

export async function transcribe(who, pcm, context = '') {
  const p = sttFor(who);
  if (!p.enabled()) throw new ProviderError(`${p.label} key is not set (${p.needs.join(', ')}): run npm run setup`);
  const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  if (buf.length < 16000) throw new ProviderError('audio too short');
  if (buf.length > 16000 * 2 * 29) throw new ProviderError('audio too long');
  if (level(buf).peak < 400) return '';                              // silence / room noise: never ask a recogniser (it would invent words) and save the round trip
  return p.transcribe(prep(buf), { who, context });
}
export function describe() {
  const s = slots();
  return { api1: { id: s.api1.id, label: s.api1.label, ready: s.api1.enabled() }, api2: { id: s.api2.id, label: s.api2.label, ready: s.api2.enabled() }, api3: { id: s.api3.id, label: s.api3.label, ready: s.api3.enabled() } };
}
export async function checkAll() {
  const s = slots(), out = {};
  const stt = async (p) => { if (!p.enabled()) return { ok: false, error: `${p.needs.join(', ')} is not set (run: npm run setup)` }; try { await p.transcribe(Buffer.alloc(32000), {}); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } };
  out.api1 = Object.assign({ label: s.api1.label }, await stt(s.api1));
  out.api2 = s.api2.id === s.api1.id ? Object.assign({}, out.api1) : Object.assign({ label: s.api2.label }, await stt(s.api2));
  out.api3 = Object.assign({ label: s.api3.label }, s.api3.enabled() ? await s.api3.check() : { ok: false, error: `${s.api3.needs.join(', ')} is not set (run: npm run setup)` });
  return out;
}
