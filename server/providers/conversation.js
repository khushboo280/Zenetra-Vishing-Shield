// Upload-voice test mode: ONE recording of a call (caller + receiver together) -> [{ who, text, start, end }].
//  1. speakers are separated by a diarizing speech-to-text (ElevenLabs Scribe or Deepgram) when one of those keys is set;
//     otherwise the recording is cut at its pauses and each piece is transcribed by the API2 provider (speaker unknown);
//  2. API3 (the LLM) decides who is the CALLER and who is the RECEIVER from what is said (the first-voice option is only a fallback).
import { STT_PROVIDERS, slots, transcribe, llm, ProviderError } from './index.js';
import { env } from './common.js';

const RATE = 16000;
/** cut 16 kHz mono PCM at pauses: [{ start, end, pcm }] in seconds */
export function segment(pcm, { minSilence = 0.45, maxLen = 14, minLen = 0.4 } = {}) {
  const fr = 320, n = Math.floor(pcm.length / fr), rms = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < fr; j++) { const v = pcm[i * fr + j] / 32768; s += v * v; } rms[i] = Math.sqrt(s / fr); }
  const sorted = [...rms].sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.2)] || 0, thr = Math.max(0.008, floor * 3);
  const out = []; let st = -1, last = -1;
  for (let i = 0; i < n; i++) {
    if (rms[i] > thr) { if (st < 0) st = i; last = i; }
    else if (st >= 0 && (i - last) * 0.02 > minSilence) { out.push([st, last + 1]); st = -1; }
  }
  if (st >= 0) out.push([st, last + 1]);
  const segs = [];
  for (const [a, b] of out) for (let x = a; x < b; x += maxLen * 50) { const y = Math.min(b, x + maxLen * 50); if ((y - x) * 0.02 >= minLen) segs.push({ start: Math.max(0, x * 0.02 - 0.1), end: y * 0.02 + 0.1, pcm: pcm.subarray(Math.max(0, x * fr - 1600), Math.min(pcm.length, y * fr + 1600)) }); }
  return segs;
}
async function pool(items, size, fn) { const res = new Array(items.length); let k = 0; await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (k < items.length) { const i = k++; res[i] = await fn(items[i], i); } })); return res; }

/** how the speakers were separated, for the UI */
export const diarizer = () => [STT_PROVIDERS.elevenlabs, STT_PROVIDERS.deepgram].find((p) => p && p.enabled() && p.diarize) || null;

export async function analyzeRecording(pcm, { firstIs = 'auto' } = {}) {
  if (!pcm || pcm.length < RATE * 1) throw new ProviderError('The recording is too short (under 1 second).');
  const seconds = pcm.length / RATE, buf = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  let utts, method;
  const d = diarizer();
  if (d) { utts = await d.diarize(buf(pcm)); method = d.label + ' (speaker separation)'; }
  else {
    const p = slots().api2; if (!p.enabled()) throw new ProviderError(`${p.label} key is not set: run npm run setup`);
    const segs = segment(pcm); if (!segs.length) throw new ProviderError('No speech was found in the recording.');
    const texts = await pool(segs, 3, (s) => transcribe('caller', buf(s.pcm)).catch((e) => { throw e; }));
    utts = segs.map((s, i) => ({ voice: '', text: texts[i], start: s.start, end: s.end })).filter((u) => u.text);
    method = p.label + ' (cut at pauses) + API3 speaker roles';
  }
  if (!utts.length) throw new ProviderError('No words could be recognised in the recording.');
  // who is who: API3 reads the whole conversation and decides
  const L = llm(), letters = {}; let nl = 0;
  const items = utts.map((u, i) => ({ i, text: u.text, voice: u.voice ? (letters[u.voice] || (letters[u.voice] = String.fromCharCode(65 + nl++))) : '' }));
  let who = null;
  if (L.enabled() && L.roles) {
    try { const got = new Map((await L.roles(items)).map((x) => [x.i, x.who])); if (items.every((x) => got.has(x.i))) who = items.map((x) => got.get(x.i)); } catch (e) { console.warn('  speaker roles (API3):', e.message); }
  }
  if (who && Object.keys(letters).length) {                                // one voice = one role: majority vote over that voice's lines
    const vote = {}; items.forEach((x, i) => { if (!x.voice) return; (vote[x.voice] = vote[x.voice] || { caller: 0, receiver: 0 })[who[i]]++; });
    who = items.map((x, i) => (x.voice ? (vote[x.voice].caller >= vote[x.voice].receiver ? 'caller' : 'receiver') : who[i]));
  }
  let note = '';
  if (!who) {
    if (!Object.keys(letters).length) throw new ProviderError('API3 (the AI observer) is needed to tell caller and receiver apart in this recording: check its key (npm run setup).');
    const first = firstIs === 'receiver' ? 'receiver' : 'caller'; note = 'API3 could not decide who is who; the first voice was taken as the ' + first + '.';
    const firstVoice = items[0].voice; who = items.map((x) => (x.voice === firstVoice ? first : first === 'caller' ? 'receiver' : 'caller'));
  } else if (firstIs !== 'auto' && Object.keys(letters).length) { /* user override */
    const first = firstIs === 'receiver' ? 'receiver' : 'caller', firstVoice = items[0].voice; who = items.map((x) => (x.voice === firstVoice ? first : first === 'caller' ? 'receiver' : 'caller')); note = 'Roles set by you.';
  }
  return { turns: utts.map((u, i) => ({ who: who[i], text: u.text, start: +u.start.toFixed(2), end: +u.end.toFixed(2) })), method, note, seconds };
}
