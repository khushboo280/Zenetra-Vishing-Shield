// API1/API2 provider: ElevenLabs Scribe speech-to-text. POST {base}/v1/speech-to-text, header xi-api-key, multipart form.
// Language is auto-detected (Hindi, English, Hinglish...) unless ELEVENLABS_LANGUAGE is set (ISO code such as hi / en).
import { env, request, wav, sane, sttLang, ProviderError } from '../common.js';
const base = () => env('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io').replace(/\/$/, '');
export default {
  id: 'elevenlabs', label: 'ElevenLabs', needs: ['ELEVENLABS_API_KEY'], ttsType: 'audio/mpeg',
  enabled: () => !!env('ELEVENLABS_API_KEY'),
  async transcribe(pcm) {
    const models = [...new Set([env('ELEVENLABS_STT_MODEL', 'scribe_v2'), 'scribe_v1'])];
    let last;
    for (const model of models) {
      const f = new FormData(); f.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'chunk.wav'); f.append('model_id', model); f.append('tag_audio_events', 'false'); f.append('diarize', 'false');
      const lang = env('ELEVENLABS_LANGUAGE') || sttLang(); if (lang) f.append('language_code', lang);
      try {
        const r = await request(base() + '/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: f }, { label: 'ElevenLabs', key: env('ELEVENLABS_API_KEY'), family: 'elevenlabs', timeoutMs: 25000, hint: { 401: 'API key invalid', 402: 'no credit / plan does not include speech-to-text', 422: 'request not accepted (check ELEVENLABS_STT_MODEL)', 429: 'rate limit / quota' } });
        return sane((await r.json().catch(() => ({}))).text);
      } catch (e) { last = e; if (![400, 404, 422].includes(e.status)) throw e; }          // unknown model name: try the next one
    }
    throw last || new ProviderError('ElevenLabs failed');
  },
  /** whole recording with speaker separation: [{ voice, text, start, end }] */
  async diarize(pcm) {
    const models = [...new Set([env('ELEVENLABS_STT_MODEL', 'scribe_v2'), 'scribe_v1'])]; let last;
    for (const model of models) {
      const f = new FormData(); f.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'call.wav'); f.append('model_id', model); f.append('tag_audio_events', 'false'); f.append('diarize', 'true'); f.append('num_speakers', '2');
      const lang = env('ELEVENLABS_LANGUAGE') || sttLang(); if (lang) f.append('language_code', lang);
      try {
        const r = await request(base() + '/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY') }, body: f }, { label: 'ElevenLabs', key: env('ELEVENLABS_API_KEY'), family: 'elevenlabs', timeoutMs: 120000, retries: 1 });
        const words = ((await r.json().catch(() => ({}))).words || []).filter((w) => w.type === 'word' || (!w.type && w.text));
        const out = []; let cur = null;
        for (const w of words) {
          const v = String(w.speaker_id || 'speaker_0');
          if (cur && cur.voice === v && w.start - cur.end < 1.4) { cur.text += ' ' + w.text; cur.end = w.end; } else { cur = { voice: v, text: w.text, start: w.start, end: w.end }; out.push(cur); }
        }
        return out.map((u) => Object.assign(u, { text: sane(u.text) })).filter((u) => u.text);
      } catch (e) { last = e; if (![400, 404, 422].includes(e.status)) throw e; }
    }
    throw last || new ProviderError('ElevenLabs failed');
  },
  /** spoken alerts (Hindi / English): ElevenLabs text-to-speech, mp3 */
  async tts(text) {
    const voice = env('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM');
    const r = await request(`${base()}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: env('ELEVENLABS_TTS_MODEL', 'eleven_multilingual_v2'), voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) }, { label: 'ElevenLabs TTS', key: env('ELEVENLABS_API_KEY'), family: 'elevenlabs', timeoutMs: 25000, hint: { 401: 'API key invalid', 402: 'no credit / plan does not allow this voice via the API', 422: 'voice or model not accepted (ELEVENLABS_VOICE_ID / ELEVENLABS_TTS_MODEL)' } });
    return Buffer.from(await r.arrayBuffer());
  },
};
