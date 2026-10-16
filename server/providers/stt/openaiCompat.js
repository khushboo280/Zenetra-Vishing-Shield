// Any OpenAI-compatible /audio/transcriptions endpoint: OpenAI (gpt-4o-transcribe / whisper-1), Groq (Whisper large-v3), ...
import { env, request, wav, sane, sttLang } from '../common.js';
// NO vocabulary prompt: Whisper-style models repeat their prompt on noise and silence (that was the random sentences in the receiver's transcript).
// Whisper models are asked for verbose_json so each segment's own confidence (no_speech_prob, avg_logprob, compression_ratio) can reject invented text.
export function makeOpenAiCompatStt({ family, id, label, keyEnv, baseEnv, baseDefault, modelEnv, modelDefault, fallbackModel, langEnv }) {
  return {
    id, label, needs: [keyEnv],
    enabled: () => !!env(keyEnv),
    async transcribe(pcm) {
      const base = env(baseEnv, baseDefault).replace(/\/$/, ''), model = env(modelEnv, modelDefault);
      const form = (m) => { const f = new FormData(); const verbose = /whisper/i.test(m); f.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'chunk.wav'); f.append('model', m); f.append('response_format', verbose ? 'verbose_json' : 'json'); f.append('temperature', '0');
        const l = env(langEnv) || sttLang(); if (l) f.append('language', l); const p = env('STT_PROMPT'); if (p) f.append('prompt', p); return f; };
      const go = (m) => request(base + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + env(keyEnv) }, body: form(m) }, { label, key: env(keyEnv), family, timeoutMs: 20000, retries: 1, hint: { 401: 'API key invalid', 429: 'rate limit / quota' } });
      let r, used = model; try { r = await go(model); } catch (e) { if (fallbackModel && model !== fallbackModel && [400, 403, 404].includes(e.status)) { used = fallbackModel; r = await go(fallbackModel); } else throw e; }
      const j = await r.json().catch(() => ({}));
      if (/whisper/i.test(used) && Array.isArray(j.segments)) {
        const keep = j.segments.filter((x) => !((x.no_speech_prob > 0.55) && (x.avg_logprob < -0.6)) && !(x.avg_logprob < -1.2) && !(x.compression_ratio > 2.4));
        return sane(keep.map((x) => x.text).join(' ').trim());
      }
      return sane(j.text);
    },
  };
}
