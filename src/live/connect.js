// Network side of a call: Socket.IO signalling + WebRTC (STUN/TURN), shared by the receiver dashboard and the caller page.
import { io } from 'socket.io-client';
import { api } from './config.js';
import { startLiveCall } from './session.js';
import { S } from './state.js';
import { makeSignalHandler, watchContext, streamOf, tuneSender } from './rtc.js';
import { monitorPc } from './health.js';

const FALLBACK = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], stt: 'webspeech', ai: false, turn: false, callerSource: 'remote' };
export async function getConfig() {
  try { const r = await fetch(api('/api/config'), { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* offline server */ }
  return FALLBACK;
}
export const makeSocket = () => io(api('') || undefined, { transports: ['websocket', 'polling'], reconnectionAttempts: 12 });
export const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
// Browser-side cleanup is ON; 48 kHz mono is WebRTC's native format, so nothing has to be resampled (a classic cause of crackle).
export const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: { ideal: 48000 }, latency: { ideal: 0.02 } } };
export const getMic = async () => { try { return await navigator.mediaDevices.getUserMedia(MIC); } catch (e) { if (e.name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); throw e; } };
/** Opus tuning that avoids pops: no DTX (comfort-noise switching clicks), 20 ms packets, in-band FEC for lost packets. */
export function tuneSdp(sdp) {
  return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g, (m, pt, params) => {
    let p = params; for (const kv of ['usedtx=0', 'stereo=0', 'minptime=20', 'maxaveragebitrate=64000']) { const k = kv.split('=')[0]; p = new RegExp('(^|;)' + k + '=').test(p) ? p.replace(new RegExp(k + '=[^;]*'), kv) : p + ';' + kv; }
    return `a=fmtp:${pt} ${p}`;
  });
}
/** Outgoing audio bus (receiver): mic -> gain -> high-pass -> limiter -> one stable track. Mute and alert warnings are gain RAMPS on this bus,
 *  so there is no hard cut (click), no track swapping and no clipping. */
export function newAudioContext() {                                       // must be created inside the click that starts the call, or browsers keep it suspended (= silence, no transcript)
  const AC = window.AudioContext || window.webkitAudioContext; let ctx;
  try { ctx = new AC({ latencyHint: 'interactive', sampleRate: 48000 }); } catch (e) { ctx = new AC({ latencyHint: 'interactive' }); }
  ctx.resume().catch(() => {});
  const wake = () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));
  return ctx;
}
export const engineChoice = () => { try { return localStorage.getItem('vs.engine') || 'auto'; } catch (e) { return 'auto'; } };
export function buildOut(local, ctx) {
  const mic = ctx.createMediaStreamSource(local), micGain = ctx.createGain(), warnGain = ctx.createGain(); warnGain.gain.value = 0;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = 0.707;           // removes DC offset / rumble that cause thumps
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.12;
  const dest = ctx.createMediaStreamDestination(); dest.channelCount = 1;
  mic.connect(micGain); micGain.connect(hp); hp.connect(lim); warnGain.connect(lim); lim.connect(dest);
  return { ctx, dest, micGain, warnGain, stream: dest.stream };
}
export const sttLang = () => { try { return localStorage.getItem('vs.sttLang') || 'en-IN'; } catch (e) { return 'en-IN'; } };

/** RECEIVER: opens a room, waits for the caller, negotiates the call, then hands both streams to startLiveCall(). */
export async function connectViaRoom({ onRoom, onStatus = () => {} }) {
  const actx = newAudioContext();                                         // FIRST line: still inside the user's click
  const cfg = await getConfig();
  if (engineChoice() === 'browser') cfg.stt = 'webspeech';               // user chose the browsers' own speech recognition (no provider keys needed)
  const room = newRoomCode();
  const local = await getMic();
  const out = buildOut(local, actx);
  const pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceCandidatePoolSize: 4 });
  out.stream.getAudioTracks().forEach((t) => pc.addTrack(t, out.stream));                 // the CLEAN bus track is what the caller hears
  const socket = makeSocket();
  let caller = { number: 'Web caller · ' + room, kind: 'unknown', label: 'Unknown number' };
  let started = false, offered = false, closed = false;
  const send = (m) => socket.emit('signal', m);
  const offer = async (iceRestart) => { const o = await pc.createOffer({ iceRestart }); await pc.setLocalDescription({ type: o.type, sdp: tuneSdp(o.sdp) }); send({ type: 'offer', sdp: pc.localDescription }); };

  const sender = pc.getSenders().find((x) => x.track && x.track.kind === 'audio'); tuneSender(sender);
  const rawTrack = local.getAudioTracks()[0];
  // If the Web Audio bus cannot start (browser keeps the context suspended) the caller would hear silence: send the raw mic track instead.
  const useRaw = (why) => { if (out.raw || !sender) return; out.raw = true; sender.replaceTrack(rawTrack).catch(() => {}); onStatus('note', why); };
  const stopWatch = watchContext(actx, { onStuck: () => useRaw('Audio engine blocked by the browser: sending the microphone directly.') });
  // real-microphone level (independent of the audio bus) + RTP statistics every second: detects "loud mic but nothing leaves" and switches to the raw mic
  const probe = actx.createAnalyser(); probe.fftSize = 1024; const pbuf = new Float32Array(1024); actx.createMediaStreamSource(local).connect(probe);
  let micPeak = 0; const pk = setInterval(() => { probe.getFloatTimeDomainData(pbuf); let q = 0; for (let i = 0; i < pbuf.length; i++) q += pbuf[i] * pbuf[i]; micPeak = Math.max(micPeak, Math.sqrt(q / pbuf.length)); }, 100);
  const micLevel = () => { const v = micPeak; micPeak = 0; return v; };          // loudest the real microphone was since the last check
  let healN = 0, lastHeal = 0;
  const heal = (why) => {                                                                // audio stopped although the link looks fine: new network path, and after 2 tries force the relay
    if (closed || Date.now() - lastHeal < 7000) return; lastHeal = Date.now(); healN++;
    onStatus('note', 'Audio stalled (' + why + '): re-connecting the audio path…');
    if (healN >= 3) { try { pc.setConfiguration(Object.assign(pc.getConfiguration(), { iceTransportPolicy: 'relay' })); } catch (e) { /* older browsers */ } }
    offer(true).catch(() => {});
  };
  const monitor = monitorPc(pc, { micLevel, onDead: (d) => heal(d.hear === 'nopackets' ? 'no audio arriving' : 'no audio leaving'), onStuck: () => useRaw('Your voice was not leaving the audio engine: switched to the microphone directly.'), onUpdate: (h) => { S.health = h; } });
  let restartT = null;

  pc.onicecandidate = (e) => e.candidate && send({ type: 'ice', candidate: e.candidate });
  pc.onconnectionstatechange = () => onStatus(pc.connectionState);
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState; clearTimeout(restartT);
    if (st === 'failed' && !closed) offer(true).catch(() => {});                         // network changed: renegotiate the path
    else if (st === 'disconnected' && !closed) restartT = setTimeout(() => { if (!closed && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') offer(true).catch(() => {}); }, 3000);
  };
  pc.ontrack = (e) => {
    if (started) return; started = true;
    try { e.receiver.jitterBufferTarget = 120; } catch (x) {}                              // a little extra jitter buffer: prevents underrun crackle on mobile networks
    startLiveCall(streamOf(e), local, { pc, caller, socket, cfg, sttLang: sttLang(), callerLang: caller.speechLang, out, sender }).catch((err) => onStatus('error', err.message));
  };

  socket.on('connect_error', () => onStatus('error', 'Cannot reach the signalling server.'));
  socket.on('peer-joined', async ({ caller: c } = {}) => {
    if (c) caller = Object.assign(caller, c);
    if (offered || started) return; offered = true;
    try { await offer(false); } catch (e) { offered = false; onStatus('error', 'Could not start the call: ' + e.message); }
  });
  const onSignal = makeSignalHandler(pc, { onAnswer: (m) => pc.setRemoteDescription(m.sdp), log: (w, e) => console.warn('[signal]', w, e && e.message) });
  socket.on('signal', (m) => { if (m && m.type === 'restart') return heal('the caller lost the audio'); return onSignal(m); });   // the caller can ask for a new path too
  socket.on('stt', (m) => { if (S.call && !S.call.ended) { S.noteCaller && S.noteCaller(m.text); S.call.ingest('caller', m.text, m.segFinal, m.turnEnd); } });   // only used when CALLER_STT_SOURCE=device
  socket.on('hangup', () => onStatus('peer-left'));
  socket.on('peer-left', () => onStatus('peer-left'));

  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Signalling server did not answer.')), 8000);
    socket.emit('join', { room, role: 'dashboard' }, (a) => { clearTimeout(t); a && a.ok ? res() : rej(new Error((a && a.error) || 'Could not open the room')); });
  });
  onRoom(room, `${cfg.publicUrl || location.origin}/caller.html?room=${room}`, cfg);
  return {
    room, pc, socket, cfg,
    sendAlert: (m) => socket.emit('alert', m),
    close() { closed = true; clearTimeout(restartT); stopWatch(); monitor.stop(); clearInterval(pk); try { socket.emit('hangup'); } catch (e) {} setTimeout(() => socket.close(), 200); try { pc.close(); } catch (e) {} local.getTracks().forEach((t) => t.stop()); try { out.ctx.close(); } catch (e) {} },
  };
}
