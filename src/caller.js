// CALLER page: a normal WebRTC peer. Joins the receiver's room through Socket.IO, answers the offer, and shows a phone-style
// in-call screen (Mute / Keypad / Speaker / End call) next to the live transcript. Works from any device on the internet.
import './styles/app.css';
import './styles/extra.css';
import './styles/caller.css';
import './styles/phone.css';
import './styles/live.css';
import { getConfig, makeSocket, getMic, tuneSdp, newAudioContext } from './live/connect.js';
import { ChunkStt } from './live/chunkStt.js';
import { playRemote, makeSignalHandler, streamOf, tuneSender } from './live/rtc.js';
import { monitorPc, describeHealth } from './live/health.js';
import { WebSpeech, webSpeechUsable as webSpeechSupported } from './live/webspeech.js';
import { createPhone } from './ui/phone.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = (id, text, cls) => { const e = $(id); e.textContent = text; e.className = 'chip' + (cls ? ' ' + cls : ''); };
$('#logo').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>';
const q = new URLSearchParams(location.search).get('room'); if (q) $('#room').value = q.toUpperCase();
try { const l = localStorage.getItem('vs.callerLang'); if (l) $('#lang').value = l; } catch (e) {}
const LABEL = { unknown: 'Unknown number', saved: 'Saved contact', business: 'Business number', intl: 'International number' };

let pc, socket, local, phone, speech, actx, sttTimer, ownStt, player, monitor, t0 = 0, timer = null, ended = false, closed = false, connected = false;

function fail(msg) { chip('#cLink', msg, 'crit'); $('#join').disabled = false; }
function render(turns) {
  const box = $('#msgs'), ts = turns.filter((t) => t.text);
  box.innerHTML = ts.length ? ts.map((t) => `<div class="msg ${t.who}" style="--lane-c:var(--${t.who === 'caller' ? 'info' : 'good'})"><b class="wl">${t.who === 'caller' ? 'You' : 'Receiver'}</b>${esc(t.text)}${t.partial ? '<span class="caret"></span>' : ''}</div>`).join('') : '<div class="msg empty">Words appear here as you both speak.</div>';
  box.scrollTop = box.scrollHeight;
}
function finish(why) {
  if (ended) return; ended = true; clearInterval(timer);
  if (phone) phone.setState('ended');
  try { speech && speech.stop(); } catch (e) {}
  try { clearInterval(sttTimer); ownStt && ownStt.stop(); actx && actx.close(); } catch (e) {}
  try { pc && pc.close(); } catch (e) {}
  local && local.getTracks().forEach((t) => t.stop());
  if (player) player.stop();
  if (monitor) monitor.stop();
  setTimeout(() => { try { socket && socket.close(); } catch (e) {} }, 300);
  chip('#trChip', why, 'warn');
}
function endByUser() { if (ended) return; try { socket.emit('hangup'); } catch (e) {} finish('you ended the call'); }

async function join() {
  const room = $('#room').value.trim().toUpperCase();
  if (room.length < 4) { chip('#cLink', 'Enter the room code', 'warn'); return; }
  $('#join').disabled = true;
  try { actx = newAudioContext(); } catch (e) {}                          // created inside the click: browsers keep it suspended otherwise
  const kind = $('#kind').value, sttLang = $('#lang').value; try { localStorage.setItem('vs.callerLang', sttLang); } catch (e) {}
  try {
    chip('#cMic', 'Microphone: allow access…', 'warn');
    local = await getMic();
    chip('#cMic', 'Microphone: on', 'good');
    const cfg = await getConfig();
    pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceCandidatePoolSize: 4 });
    local.getTracks().forEach((t) => tuneSender(pc.addTrack(t, local)));
    // the receiver's voice: attached to a real, playing <audio> element (tap button appears if the browser blocks autoplay)
    pc.ontrack = (e) => { if (player) player.stop(); player = playRemote(streamOf(e), { onBlocked: () => chip('#cLink', 'Tap the blue button to hear the receiver', 'warn'), onPlaying: () => chip('#trChip', ownStt ? 'listening (your mic)' : 'call audio on', 'good') }); try { e.receiver.jitterBufferTarget = 120; } catch (x) {} };
    monitor = monitorPc(pc, { onDead: () => { if (socket) socket.emit('signal', { type: 'restart' }); }, onUpdate: (h) => { const d = describeHealth(h, { who: 'receiver' }); chip('#cHear', d.hear.t, d.hear.cls); chip('#cSend', d.send.t, d.send.cls); chip('#cPath', d.net ? 'Path: ' + d.net : 'Path: —', ''); $('#cHear').title = d.hear.tip; $('#cSend').title = d.send.tip; } });
    pc.onicecandidate = (e) => e.candidate && socket.emit('signal', { type: 'ice', candidate: e.candidate });
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState; chip('#cLink', 'Link: ' + s, s === 'connected' ? 'good' : 'warn');
      if (s === 'connected' && !connected) { connected = true; startCall(cfg); }
      if ((s === 'failed' || s === 'closed') && connected) finish('connection lost');
    };
    socket = makeSocket();
    const me = { number: kind === 'saved' ? 'Saved contact' : 'Web caller · ' + room, kind, label: LABEL[kind], speechLang: sttLang };
    socket.on('connect_error', () => fail('Cannot reach the server'));
    const onSignal = makeSignalHandler(pc, {
      onOffer: async (m) => { await pc.setRemoteDescription(m.sdp); const ans = await pc.createAnswer(); await pc.setLocalDescription({ type: ans.type, sdp: tuneSdp(ans.sdp) }); socket.emit('signal', { type: 'answer', sdp: pc.localDescription }); },
      log: (w, e) => console.warn('[signal]', w, e && e.message),
    });
    socket.on('signal', onSignal);
    socket.on('transcript', (m) => render(m.turns || []));
    socket.on('alert', (m) => {
      const w = $('#warnBox'); w.textContent = '⚠ Vishing Shield warned the receiver about this call. The call is still connected.'; w.classList.add('on');
      if (phone) phone.alert({ title: 'Call flagged', text: 'The receiver has been warned. You can keep talking or end the call.', level: 'warn', ms: 10000 });
      setTimeout(() => w.classList.remove('on'), 15000);
    });
    socket.on('stt-fallback', () => {                                       // the receiver's AI transcription failed: this browser transcribes the caller instead
      if (speech || !webSpeechSupported()) return;
      speech = new WebSpeech({ lang: $('#lang').value, onResult: (r) => socket.emit('stt', r), onError: (m) => chip('#trChip', m, 'warn') }); speech.start(); chip('#trChip', 'listening (browser)', 'good');
    });
    socket.on('hangup', () => finish('the receiver ended the call'));
    socket.on('peer-left', () => finish('the receiver left'));
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Server did not answer')), 8000);
      socket.emit('join', { room, role: 'caller', caller: me }, (a) => { clearTimeout(t); if (!a || !a.ok) return rej(new Error((a && a.error) || 'Could not join')); if (!a.peerPresent) return rej(new Error('No receiver in room ' + room + '. Check the code.')); res(); });
    });
    chip('#cLink', 'Link: ringing…', 'warn');
    $('#dial').hidden = true; $('#live').hidden = false;
    phone = createPhone($('#phoneHost'), {
      role: 'caller', name: 'Receiver', number: 'Room ' + room, onEnd: endByUser,
      onMute: (m) => local.getAudioTracks().forEach((t) => { t.enabled = !m; }),
      onSpeaker: (on) => { if (player) player.el.volume = on ? 1 : 0.35; },
    });
    phone.setStatus('calling…'); phone.setState('ringing');
  } catch (e) {
    try { socket && socket.close(); } catch (x) {} try { pc && pc.close(); } catch (x) {} local && local.getTracks().forEach((t) => t.stop());
    $('#dial').hidden = false; $('#live').hidden = true;
    chip('#cMic', e.name === 'NotAllowedError' ? 'Microphone blocked' : 'Microphone: off', e.name === 'NotAllowedError' ? 'crit' : '');
    fail(e.message || String(e));
  }
}
/* Only when CALLER_STT_SOURCE=device (or the receiver's page asked for a fallback): the caller's words are transcribed HERE from THIS
   device's own microphone (API2 runs on the server for this stream too) and sent to the receiver as text. */
async function ownMicStt(cfg) {
  const useBrowser = () => { if (speech || !webSpeechSupported()) { chip('#trChip', 'speech-to-text unavailable', 'crit'); return; } speech = new WebSpeech({ lang: $('#lang').value, onResult: (r) => socket.emit('stt', r), onError: (m) => chip('#trChip', m, 'warn') }); speech.start(); chip('#trChip', 'listening (browser)', 'good'); };
  try {
    if (!actx) actx = newAudioContext(); await actx.resume(); await actx.audioWorklet.addModule('/pcm-worklet.js');
    const src = actx.createMediaStreamSource(local), an = actx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const td = new Float32Array(1024); let floor = 0.003, on = false, lastV = 0;
    ownStt = new ChunkStt({
      who: 'caller', socket, isSpeaking: () => on,
      onText: (t) => socket.emit('stt', { text: t, segFinal: true, turnEnd: true }),
      onStatus: (ok, msg, n) => { chip('#trChip', ok ? 'listening (your mic)' : 'speech-to-text: ' + String(msg || '').slice(0, 40), ok ? 'good' : 'warn'); if (!ok && (n >= 2 || /HTTP 40[13]|quota|not set|billing|credit|rate limit/i.test(msg || ''))) { ownStt.stop(); useBrowser(); } },
    });
    const node = new AudioWorkletNode(actx, 'vs-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { channels: 1 } });
    const mute = actx.createGain(); mute.gain.value = 0; mute.connect(actx.destination); src.connect(node); node.connect(mute); node.port.onmessage = (e) => ownStt.push(e.data);
    sttTimer = setInterval(() => {                                                       // adaptive voice gate: a quiet phone mic still counts
      an.getFloatTimeDomainData(td); let sm = 0; for (let i = 0; i < td.length; i++) sm += td[i] * td[i]; const rms = Math.sqrt(sm / td.length), tn = performance.now();
      if (rms < floor * 1.6 || !on) floor = Math.min(0.02, Math.max(0.0012, floor * 0.985 + rms * 0.015));
      if (rms > Math.min(0.012, Math.max(0.0035, floor * 2.8))) lastV = tn; on = tn - lastV < 400;
    }, 33);
    chip('#trChip', 'listening (your mic)', 'good');
  } catch (e) { useBrowser(); }
}
function startCall(cfg) {
  t0 = Date.now(); phone.setState('live'); phone.setGuard('good', 'Connected over the internet');
  timer = setInterval(() => phone.setTimer((Date.now() - t0) / 1000), 500);
  if (cfg.stt === 'webspeech') {                                         // no provider keys / user chose browser speech: this browser transcribes the caller's voice
    if (!webSpeechSupported()) { chip('#trChip', 'transcribed on the receiver', 'good'); return; }
    speech = new WebSpeech({ lang: $('#lang').value, onResult: (r) => socket.emit('stt', r), onError: (m) => chip('#trChip', m, 'warn') });
    speech.start(); chip('#trChip', 'listening', 'good');
  } else if (cfg.callerSource === 'device') ownMicStt(cfg);
  else chip('#trChip', 'your voice is transcribed on the receiver (' + (cfg.sttEngine || 'AI') + ')', 'good');   // API2 reads the audio that arrives over WebRTC
}
$('#join').addEventListener('click', join);
