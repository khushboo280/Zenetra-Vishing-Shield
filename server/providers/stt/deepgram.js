// API1/API2 provider: Deepgram pre-recorded endpoint (one finished utterance per request). nova-3 + language=multi handles Hindi/English code-switching.
import { env, request, wav, sane, sttLang } from '../common.js';
const baseUrl = () => env('DEEPGRAM_BASE_URL', 'https://api.deepgram.com').replace(/\/$/, '');
export default {
  id: 'deepgram', label: 'Deepgram', needs: ['DEEPGRAM_API_KEY'],
  enabled: () => !!env('DEEPGRAM_API_KEY'),
  async transcribe(pcm) {
    const q = new URLSearchParams({ model: env('DEEPGRAM_MODEL', 'nova-3'), language: env('DEEPGRAM_LANGUAGE') || sttLang() || 'multi', smart_format: 'true', punctuate: 'true' });
    const r = await request(env('DEEPGRAM_BASE_URL', 'https://api.deepgram.com').replace(/\/$/, '') + '/v1/listen?' + q, { method: 'POST', headers: { Authorization: 'Token ' + env('DEEPGRAM_API_KEY'), 'Content-Type': 'audio/wav' }, body: wav(pcm) }, { label: 'Deepgram', key: env('DEEPGRAM_API_KEY'), family: 'deepgram', hint: { 401: 'API key invalid', 402: 'no credit' } });
    const j = await r.json().catch(() => ({}));
    return sane(j.results && j.results.channels && j.results.channels[0] && j.results.channels[0].alternatives && j.results.channels[0].alternatives[0] && j.results.channels[0].alternatives[0].transcript);
  },
  /** whole recording with speaker separation: [{ voice, text, start, end }] */
  async diarize(pcm) {
    const q = new URLSearchParams({ model: env('DEEPGRAM_MODEL', 'nova-3'), language: env('DEEPGRAM_LANGUAGE') || sttLang() || 'multi', smart_format: 'true', punctuate: 'true', diarize: 'true', utterances: 'true' });
    const r = await request(baseUrl() + '/v1/listen?' + q, { method: 'POST', headers: { Authorization: 'Token ' + env('DEEPGRAM_API_KEY'), 'Content-Type': 'audio/wav' }, body: wav(pcm) }, { label: 'Deepgram', key: env('DEEPGRAM_API_KEY'), family: 'deepgram', timeoutMs: 120000, retries: 1 });
    const j = await r.json().catch(() => ({}));
    return ((j.results && j.results.utterances) || []).map((u) => ({ voice: 'speaker_' + (u.speaker || 0), text: sane(u.transcript), start: u.start, end: u.end })).filter((u) => u.text);
  },
};
