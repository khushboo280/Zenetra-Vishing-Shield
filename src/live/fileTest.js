// BACKUP / DEMO MODE ("Upload voice"): ONE recording of a call (caller + receiver together) drives the whole pipeline.
//   file -> server: speaker separation + speech-to-text (+ API3 decides who is caller / receiver) -> the words are fed to the call in step with
//   the audio playing on the speaker -> API3 reads the growing conversation, scores fraud confidence and chooses when to give the voice alert.
// Nothing is made up: every word comes from the speech-to-text of the uploaded file, every score from API3.
import { startLiveCall } from './session.js';
import { getConfig, makeSocket, newRoomCode } from './connect.js';
import { api } from './config.js';
import { S } from './state.js';
import { B } from './hooks.js';

let T = null;
export const testRunning = () => !!T;
export function stopFileTest() {
  if (!T) return; const t = T; T = null;
  clearInterval(t.timer); try { t.audio.pause(); URL.revokeObjectURL(t.url); } catch (e) {}
  try { t.socket.close(); } catch (e) {}
  setTimeout(() => { try { t.ctx.close(); } catch (e) {} }, 300);
}
/** 16 kHz mono Float32 of a file (the browser decodes wav / mp3 / m4a / ogg / webm) */
async function toMono16k(file) {
  const AC = window.AudioContext || window.webkitAudioContext; let dc;
  try { dc = new AC({ sampleRate: 16000 }); } catch (e) { dc = new AC(); }
  try {
    const buf = await dc.decodeAudioData(await file.arrayBuffer());
    const n = buf.length, mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
    if (buf.sampleRate === 16000) return mono;
    const out = new Float32Array(Math.floor(n * 16000 / buf.sampleRate)), r = buf.sampleRate / 16000;       // simple resample (only for browsers that ignore sampleRate)
    for (let i = 0; i < out.length; i++) out[i] = mono[Math.min(n - 1, Math.floor(i * r))];
    return out;
  } catch (e) { throw new Error(`"${file.name}" could not be read as audio (use wav, mp3, m4a, ogg or webm).`); }
  finally { try { dc.close(); } catch (e) {} }
}
/** Must be called from the click that starts the test (audio autoplay rules). */
export async function startFileTest({ file, kind = 'unknown', firstIs = 'auto', sttLang = 'en-IN', onStage = () => {}, onEnded = () => {} }) {
  if (!file) throw new Error('Choose the recording first.');
  const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC({ latencyHint: 'interactive' });
  await ctx.resume().catch(() => {});
  const audio = new Audio(); const url = URL.createObjectURL(file); audio.src = url; audio.preload = 'auto';
  audio.play().then(() => audio.pause()).catch(() => {});                       // unlock playback inside the click; real playback starts when the words are ready
  try {
    const cfg = await getConfig();
    if (!cfg.ai) throw new Error('API3 (the AI observer) has no key: run npm run setup.');
    onStage('Reading the recording…');
    const f32 = await toMono16k(file), pcm = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
    const secs = f32.length / 16000;
    onStage(`Separating the two voices and writing the transcript (about ${Math.max(5, Math.round(secs * 0.25 + 6))} s)…`);
    const r = await fetch(api('/api/transcribe-file?firstIs=' + encodeURIComponent(firstIs)), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm.buffer });
    const j = await r.json().catch(() => ({ ok: false, error: 'Server answered with HTTP ' + r.status }));
    if (!j.ok) throw new Error(j.error || 'Transcription failed');
    const turns = j.turns.filter((t) => t.text);
    if (!turns.length) throw new Error('No speech was found in the recording.');

    const dummy = () => ctx.createMediaStreamDestination().stream;               // the live pipeline needs two streams; here the words come from the file instead
    const socket = makeSocket();
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Server did not answer.')), 8000); socket.once('connect', () => { clearTimeout(t); res(); }); socket.once('connect_error', () => { clearTimeout(t); rej(new Error('Cannot reach the server.')); }); });
    await new Promise((res, rej) => socket.emit('join', { room: newRoomCode(), role: 'dashboard' }, (a) => (a && a.ok ? res() : rej(new Error((a && a.error) || 'Could not open a session on the server')))));   // the server only lets a dashboard ask API3
    cfg.stt = 'file';
    const call = await startLiveCall(dummy(), dummy(), { cfg, socket, sttLang, test: true, fileMode: true, caller: { number: kind === 'saved' ? 'Saved contact' : 'Uploaded recording', kind, label: kind === 'saved' ? 'Saved contact' : 'Unknown number' } });
    if (j.note) B.notify(j.note, 1);
    B.notify(`Recording processed with ${j.method}: ${turns.length} turns.`, 0);

    const sent = new Array(turns.length).fill(false), amp = { caller: 0.02, receiver: 0.02 };
    const rmsAt = (t) => { const a = Math.max(0, Math.floor((t - 0.06) * 16000)), b = Math.min(f32.length, Math.floor(t * 16000)); let s = 0; for (let i = a; i < b; i++) s += f32[i] * f32[i]; return b > a ? Math.sqrt(s / (b - a)) : 0; };
    let finished = false;
    const timer = setInterval(() => {
      if (S.call !== call || call.ended) return;
      const t = audio.currentTime, ended = audio.ended;
      turns.forEach((u, i) => { if (!sent[i] && (u.end <= t || ended)) { sent[i] = true; call.ingest(u.who, u.text, true, true); } });   // a phrase is "heard" when it has been spoken
      const act = turns.find((u) => u.start <= t && t < u.end);
      for (const w of ['caller', 'receiver']) {
        const on = !!act && act.who === w, target = on ? Math.max(0.05, Math.min(1, Math.pow(rmsAt(t) * 7, 0.75))) : 0.02;
        amp[w] += (target - amp[w]) * 0.55;
        if (B.wbuf) { const b = B.wbuf[w]; b.shift(); b.push(amp[w]); }
        call.setActivity(w, on, amp[w]);
      }
      audio.volume = S.alertBusy ? 0.25 : 1;                                        // the voice alert is spoken over a lowered recording
      if (ended && !finished && sent.every(Boolean)) { finished = true; onEnded(secs); }
    }, 50);
    T = { ctx, socket, audio, url, timer };
    await audio.play().catch(() => { throw new Error('The browser blocked audio playback: click Run test again.'); });
    return { seconds: secs, turns: turns.length, method: j.method };
  } catch (e) { URL.revokeObjectURL(url); try { ctx.close(); } catch (x) {} throw e; }
}
