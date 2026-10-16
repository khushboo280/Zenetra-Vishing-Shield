// API1/API2 provider: Sarvam AI Saaras (Indian languages, Hindi-English code-mixing). POST {base}/speech-to-text, header api-subscription-key.
import { env, request, wav, sane, sttLang, ProviderError } from '../common.js';
const KEYTERMS = ['OTP', 'UPI', 'KYC', 'PIN', 'CVV', 'Aadhaar', 'PAN', 'bank account', 'debit card', 'credit card', 'CBI', 'police', 'AnyDesk', 'TeamViewer'];
export default {
  id: 'sarvam', label: 'Sarvam', needs: ['SARVAM_API_KEY'], ttsType: 'audio/wav',
  enabled: () => !!env('SARVAM_API_KEY'),
  async transcribe(pcm) {
    const model = env('SARVAM_MODEL', 'saaras:v3'), mode = env('SARVAM_MODE', 'codemix');
    const form = () => { const f = new FormData(); f.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'chunk.wav'); f.append('model', model); f.append('language_code', env('SARVAM_LANGUAGE') || ({ hi: 'hi-IN', en: 'en-IN' }[sttLang()]) || 'unknown');
      if (model.startsWith('saaras:v3') && mode) f.append('mode', mode); if (model.startsWith('saaras:v4')) f.append('keyterms', JSON.stringify(KEYTERMS)); return f; };
    const r = await request(env('SARVAM_BASE_URL', 'https://api.sarvam.ai').replace(/\/$/, '') + '/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': env('SARVAM_API_KEY') }, body: form() }, { label: 'Sarvam', key: env('SARVAM_API_KEY'), family: 'sarvam', hint: { 403: 'API key invalid or no credit', 429: 'rate limit' } });
    return sane((await r.json().catch(() => ({}))).transcript);
  },
  /** spoken alerts in Hindi / English: Sarvam Bulbul text-to-speech (returns base64 WAV) */
  async tts(text, lang) {
    const target = lang === 'hi' ? 'hi-IN' : 'en-IN', model = env('SARVAM_TTS_MODEL', 'bulbul:v2'), speaker = env('SARVAM_TTS_SPEAKER', 'anushka');
    const call = (body) => request(env('SARVAM_BASE_URL', 'https://api.sarvam.ai').replace(/\/$/, '') + '/text-to-speech', { method: 'POST', headers: { 'api-subscription-key': env('SARVAM_API_KEY'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { label: 'Sarvam TTS', key: env('SARVAM_API_KEY'), family: 'sarvam', timeoutMs: 25000, retries: 1, hint: { 403: 'API key invalid or no credit', 422: 'request not accepted (SARVAM_TTS_MODEL / SARVAM_TTS_SPEAKER)' } });
    let r; try { r = await call({ inputs: [text.slice(0, 500)], target_language_code: target, speaker, model, speech_sample_rate: 22050 }); }
    catch (e) { if (![400, 422].includes(e.status)) throw e; r = await call({ text: text.slice(0, 2500), target_language_code: target, speaker, model }); }   // newer models take a single `text`
    const j = await r.json().catch(() => ({})); const b64 = (j.audios && j.audios[0]) || j.audio;
    if (!b64) throw new ProviderError('Sarvam TTS returned no audio'); return Buffer.from(b64, 'base64');
  },
};
