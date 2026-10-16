// Live audio graph, call start and teardown.
//   remote stream (caller) + local mic (receiver) -> AnalyserNode -> wbuf (waveforms) + VAD
//                                                 -> AudioWorklet (16 kHz PCM) -> ChunkStt -> Socket.IO -> server -> API1 / API2
//   both texts are merged into ONE transcript (LiveCall.shown = [{ who: 'caller' | 'receiver', text }]) that API3 reads.
import E from '../engine/engine.js';
import { CONFIG, api } from './config.js';
import { Analyzer } from './analyzer.js';
import { WebSpeech, webSpeechUsable as webSpeechSupported } from './webspeech.js';
import { B } from './hooks.js';
import { S, now } from './state.js';
import { LiveCall } from './liveCall.js';
import { ChunkStt } from './chunkStt.js';
import { playRemote } from './rtc.js';

export async function startLiveCall(remoteStream, localStream, opts) {
  opts = opts || {};
  stopLiveCall(true);
  if (!remoteStream || !remoteStream.getAudioTracks().length) throw new Error('remoteStream has no audio track (call this from pc.ontrack)');
  if (!localStream || !localStream.getAudioTracks().length) throw new Error('localStream has no audio track (getUserMedia first)');
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = opts.out ? opts.out.ctx : new AC({ latencyHint: 'interactive' });
  /* 1) FIRST: make the caller audible. Done before any await so it still counts as part of the user's click, and a blocked autoplay shows a tap button. */
  const player = playRemote(remoteStream, { muted: !CONFIG.playRemote, onBlocked: () => B.notify('The browser blocked call audio: tap the blue button to hear the caller.', 1) });
  try { await ctx.resume(); } catch (e) {}
  const call = new LiveCall(B.getCfg(), opts.caller);
  Object.assign(S, { stats: { fails: 0, lastErr: '' }, out: opts.out || null, active: true, ctx, call, remoteStream, localStream, pc: opts.pc || null, timers: [], alertBusy: false, userMuted: false, speakerOn: true, warnEls: {}, spoofBuf: [], socket: opts.socket || null, test: !!opts.test, speech: null, analyzer: null, player, remoteEl: player.el });
  S.sender = opts.sender || (S.pc && S.pc.getSenders().find((s) => s.track && s.track.kind === 'audio')) || null;

  /* Chrome quirk: a remote WebRTC stream only delivers samples to WebAudio if it is also attached to a playing media element (done by playRemote above) */

  /* --- step 2: both streams -> AnalyserNode -> wbuf.caller / wbuf.receiver ---------- */
  const src = { caller: ctx.createMediaStreamSource(remoteStream), receiver: opts.out ? opts.out.micGain : ctx.createMediaStreamSource(localStream) };   // receiver tapped AFTER the mute/alert gain
  const an = {}, td = new Float32Array(1024);
  for (const w of ['caller', 'receiver']) { an[w] = ctx.createAnalyser(); an[w].fftSize = 1024; an[w].smoothingTimeConstant = 0.15; src[w].connect(an[w]); }
  const vad = { caller: { on: false, last: 0 }, receiver: { on: false, last: 0 } };
  let amp = { caller: 0.02, receiver: 0.02 };
  S.timers.push(setInterval(() => {
    if (opts.fileMode) return;                                               // uploaded recording: activity and waves are driven by fileTest.js
    const tn = now();
    for (const w of ['caller', 'receiver']) {
      an[w].getFloatTimeDomainData(td);
      let s = 0; for (let i = 0; i < td.length; i++) s += td[i] * td[i];
      const rms = Math.sqrt(s / td.length);
      const target = Math.max(0.02, Math.min(1, Math.pow(rms * 7, 0.75)));
      amp[w] += (target - amp[w]) * 0.55;
      if (B.wbuf) { const b = B.wbuf[w]; b.shift(); b.push(amp[w]); }          // <- the arrays drawWave() paints on #wC / #wR
      const v = vad[w];                                                       // adaptive gate: a quiet laptop mic must still count as speech
      v.floor = v.floor == null ? 0.003 : v.floor;
      if (rms < v.floor * 1.6 || !v.on) v.floor = Math.min(0.02, Math.max(0.0012, v.floor * 0.985 + rms * 0.015));   // learns the room's noise floor
      let thr = Math.min(CONFIG.vadThreshold, Math.max(0.0035, v.floor * 2.8));
      if (w === 'receiver' && vad.caller.on) thr = Math.max(thr, 0.035);        // the caller's voice leaking from the speaker into this mic is NOT the receiver talking
      if (rms > thr) vad[w].last = tn;
      const on = tn - vad[w].last < Math.max(CONFIG.vadHangMs, 400);
      vad[w].on = on; call.setActivity(w, on, amp[w]);
      // gate for speech-to-text: tighter than the on-screen indicator (absolute floor 0.006 = real speech, not room noise; short 150 ms hang = fast end-of-speech)
      if (rms > Math.max(thr, 0.006)) v.sttLast = tn;
      v.sttOn = tn - (v.sttLast || 0) < 150;
    }
  }, 33));

  /* --- 3) 16 kHz PCM taps -> ChunkStt -> API1 (receiver mic) / API2 (caller audio) -> ONE merged transcript ------------- */
  const cfg = opts.cfg || {};
  let sttMode = opts.fileMode ? 'none' : cfg.stt === 'server' ? 'server' : 'webspeech';
  const callerFromRemote = (cfg.callerSource || 'remote') !== 'device';       // false = the caller's own device sends its text ('stt' event)
  const wantSpoof = typeof CONFIG.spoofScorer === 'function';
  let pcmOk = false;
  if (sttMode === 'server' || wantSpoof) { pcmOk = true; try { await ctx.audioWorklet.addModule('/pcm-worklet.js'); } catch (e) { pcmOk = false; B.notify('AudioWorklet unavailable: ' + e.message, 2); } }
  if (sttMode === 'server' && (!pcmOk || !S.socket)) sttMode = 'webspeech';
  const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);   // keeps the worklets pulled by the graph, silent
  const tap = (node, fn) => { const n = new AudioWorkletNode(ctx, 'vs-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { channels: 1 } }); node.connect(n); n.connect(mute); n.port.onmessage = (e) => fn(e.data); return n; };
  S.stt = {};
  if (sttMode === 'server') {
    const lastTxt = { caller: { t: '', at: 0 }, receiver: { t: '', at: 0 } };
    const tok = (x) => new Set(String(x).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter((y) => y.length > 1));
    const sim = (a, b) => { const A = tok(a), B2 = tok(b); if (A.size < 3 || B2.size < 3) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0; let k = 0; A.forEach((x) => B2.has(x) && k++); return k / Math.min(A.size, B2.size); };
    /* Speaker -> microphone leakage shows up as the same words on BOTH streams within seconds: keep only the first one. */
    const echoOf = (w, t) => {
      const o = lastTxt[w === 'caller' ? 'receiver' : 'caller'], me = lastTxt[w], n = Date.now();
      const dup = (o.t && n - o.at < 6000 && sim(t, o.t) >= 0.6) || (me.t && n - me.at < 4000 && sim(t, me.t) >= 0.85);
      if (!dup) { me.t = t; me.at = n; } return dup;
    };
    S.noteCaller = (t) => { lastTxt.caller = { t, at: Date.now() }; };         // text the caller's own device transcribed (CALLER_STT_SOURCE=device)
    const failed = { caller: false, receiver: false };
    const fallback = (w) => {                                                // this stream's provider is unusable: switch ONLY this speaker to the browser's speech recognition
      if (failed[w]) return; failed[w] = true; S.stt[w] && S.stt[w].stop();
      const ok = webSpeechSupported();
      B.onSTTStatus(false, (w === 'caller' ? 'API2' : 'API1') + ' speech-to-text failed' + (ok ? '; using browser speech recognition' : ''), 'server');
      if (w === 'caller') { if (S.socket) S.socket.emit('stt-fallback'); return; }          // the caller's own browser transcribes its voice
      if (ok) { S.speech = new WebSpeech({ lang: opts.sttLang || 'en-IN', onResult: (r) => call.ingest('receiver', r.text, r.segFinal, r.turnEnd), onError: (m) => B.notify(m, 2) }); S.speech.start(); B.onSTTStatus(true, 'API1 failed; using browser speech recognition', 'browser'); }
    };
    const stream = (w) => new ChunkStt({
      who: w, socket: S.socket,
      isSpeaking: () => !S.alertBusy && vad[w].sttOn,                           // never transcribe our own warning playing out of a speaker
      isLeak: w === 'receiver' ? () => vad.caller.on : () => false,             // receiver mic: frames while the caller is audible are mostly speaker echo
      onText: (t, st) => { if (S.call === call && !call.ended && !echoOf(w, t)) call.ingest(w, t, true, true, st); },
      onStatus: (ok, msg, n, m) => {
        if (ok && m) { const L = S.stats.lat = S.stats.lat || {}; L[w] = { lat: m.lat, rt: m.rt }; }
        if (!ok) { S.stats.fails++; S.stats.lastErr = msg || ''; } B.onSTTStatus(ok, msg, 'server');
        if (!ok && (n >= 3 || /HTTP 40[13]|API key|quota|not set|billing|credit/i.test(msg || ''))) { B.notify(`${w === 'caller' ? 'API2 (caller)' : 'API1 (you)'} speech-to-text: ${msg}`, 2); fallback(w); }
      },
    });
    S.stt.receiver = stream('receiver');                                       // API1: THIS device's own microphone, tapped after the mute gain
    tap(src.receiver, (d) => S.stt.receiver.push(d));
    if (callerFromRemote) { S.stt.caller = stream('caller'); tap(src.caller, (d) => { S.stt.caller.push(d); if (wantSpoof) keepSpoofWindow(d); }); }   // API2: the caller's remote WebRTC audio
    else if (wantSpoof) tap(src.caller, keepSpoofWindow);
  } else if (wantSpoof && pcmOk) tap(src.caller, keepSpoofWindow);
  if (typeof CONFIG.spoofScorer === 'function') S.timers.push(setInterval(runSpoofScorer, CONFIG.spoofEveryMs));

  /* --- spoken alerts: a real voice (TTS provider) for BOTH people. No tone / beep anywhere. The voice is prepared as soon as the
         call's language is known; if an alert comes earlier, it waits for the voice instead of playing a tone. ------------------- */
  S.warnDest = opts.out ? opts.out.warnGain : ctx.createMediaStreamDestination();   // with the audio bus the warning is mixed in by gain ramps (no track swapping)
  S.recvEls = {}; S.ttsP = {}; S.ttsOn = !!cfg.tts;
  S.ensureAudio = (lang) => prefetchAlertAudio(lang, ctx);
  const origSetAI = call.setAI.bind(call);
  call.setAI = (r) => { origSetAI(r); if (S.ttsOn) prefetchAlertAudio(call.lang(), ctx); };

  /* call lifecycle: remote hang-up / ICE failure ends the call */
  const gone = (why) => () => { if (S.active && S.call === call && !call.ended) { call.endCall(why); B.onEvents([{ type: 'end', by: 'remote' }]); } };
  remoteStream.getAudioTracks().forEach((t) => t.addEventListener('ended', gone('remote-hangup')));
  if (S.pc) S.pc.addEventListener('connectionstatechange', () => { if (['failed', 'closed'].includes(S.pc.connectionState)) gone('connection-' + S.pc.connectionState)(); });

  call.start();
  B.onStart(call);
  if (sttMode === 'webspeech') {                                         // receiver's own words; the caller's arrive over the socket
    S.speech = new WebSpeech({ lang: opts.sttLang || 'en-IN', onResult: (r) => call.ingest('receiver', r.text, r.segFinal, r.turnEnd), onError: (m) => B.notify(m, 2) });
    S.speech.start();
    if (S.socket) S.socket.emit('stt-fallback');                          // the caller page then transcribes the caller's voice itself
  }
  if (S.socket) {
    S.analyzer = new Analyzer(S.socket, call);
    let relayT = null;
    call.onChange = () => {
      S.analyzer.poke();
      if (!relayT) relayT = setTimeout(() => { relayT = null; S.socket.emit('transcript', { turns: call.shown.map((t) => ({ who: t.who, text: t.text, partial: t.partial, at: t.at })) }); }, 150);
    };
  }
  return call;
}

function prefetchAlertAudio(lang, ctx) {
  if (!S.ttsOn) return Promise.resolve(false);
  if (S.ttsP[lang]) return S.ttsP[lang];
  const get = async (text) => { const r = await fetch(api('/api/tts?lang=' + lang + '&text=' + encodeURIComponent(text))); if (!r.ok) throw new Error('tts ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); return URL.createObjectURL(await r.blob()); };
  return (S.ttsP[lang] = (async () => {
    try {
      const [callerUrl, recvUrl] = await Promise.all([get(E.ALERTS[lang].caller), get(E.ALERTS[lang].receiver)]);
      if (!S.active || S.ctx !== ctx) return false;
      const a = new Audio(); a.crossOrigin = 'anonymous'; a.preload = 'auto'; a.src = callerUrl; a.addEventListener('error', () => { a._bad = true; });
      ctx.createMediaElementSource(a).connect(S.warnDest); S.warnEls[lang] = a;       // heard by the CALLER through the call
      const r = new Audio(); r.preload = 'auto'; r.src = recvUrl; r.addEventListener('error', () => { r._bad = true; }); S.recvEls[lang] = r;   // heard by the RECEIVER on the speaker
      S.warnVoice = Object.assign(S.warnVoice || {}, { [lang]: 'ai' }); return true;
    } catch (e) { B.notify('Voice alert audio could not be prepared: ' + e.message, 1); return false; }
  })());
}

/* --- phone controls: Mute and Speaker ------------------------------------------------- */
export function setMuted(m) {
  S.userMuted = !!m;
  if (S.out && !S.out.raw) { if (!S.alertBusy) S.out.micGain.gain.setTargetAtTime(m ? 0 : 1, S.ctx.currentTime, 0.02); return; }   // smooth ramp: no click
  if (S.localStream && !S.alertBusy) S.localStream.getAudioTracks().forEach((t) => { t.enabled = !m; });   // during an alert the mic is held off anyway
}
export function setSpeaker(on) { S.speakerOn = !!on; if (S.remoteEl) S.remoteEl.volume = on ? 1 : 0.35; }   // earpiece-like level when off

/* --- optional synthetic-voice hook: the last ~4 s of caller audio at 16 kHz -------------- */
function keepSpoofWindow(buf) {
  const b = S.spoofBuf; b.push(new Int16Array(buf)); if (b.length > 40) b.shift();
}
function runSpoofScorer() {
  const c = S.call; if (!c || c.ended || !c.speaking.caller) return;
  const n = S.spoofBuf.reduce((a, x) => a + x.length, 0), pcm = new Float32Array(n); let o = 0;
  for (const x of S.spoofBuf) for (let i = 0; i < x.length; i++) pcm[o++] = x[i] / 32768;
  Promise.resolve(CONFIG.spoofScorer(pcm, c.caller)).then((p) => { if (typeof p === 'number' && S.call === c) c.setSpoof(p); }, () => {});
}

export function stopLiveCall(silent, hangup) {
  if (!S.active) return;
  S.active = false;
  const call = S.call;
  S.timers.forEach(clearInterval);
  if (S.speech) S.speech.stop(); if (S.stt) Object.values(S.stt).forEach((g) => g.stop()); if (S.analyzer) S.analyzer.stop(); if (call) call.onChange = null;
  try { S.player && S.player.stop(); } catch (e) {}
  Object.values(S.warnEls).forEach((a) => { try { a.pause(); } catch (e) {} });
  if (hangup && CONFIG.hangupOnEnd && S.pc) { try { S.pc.close(); } catch (e) {} }
  setTimeout(() => { try { S.ctx.close(); } catch (e) {} }, 600);
  if (call && !call.ended) call.endCall('stopped');
  if (B.wbuf) for (const w of ['caller', 'receiver']) B.wbuf[w].fill(0.02);
  S.call = call;                                   // keep for report()
  if (!silent) { /* the app's handleEnd() renders the report */ }
}
