import { playGain } from './rtc.js';
// Live health of the WebRTC audio link, read from the browser's own RTP statistics every second.
// It answers: is audio really arriving? is MY microphone really being sent? which network path is used?
// On the receiver it also self-heals: if the microphone is loud but the encoder source stays silent (Web Audio bus broken), onStuck() fires.
export function monitorPc(pc, { micLevel, onStuck = () => {}, onUpdate = () => {}, onDead = () => {}, deadAfter = 5, intervalMs = 1000 } = {}) {
  let prev = null, deadRun = 0, silentRun = 0, stuckFired = false, stopped = false, t0 = Date.now();
  const h = { hear: 'wait', send: 'wait', hearQuietSec: 0, sendQuietSec: 0, lastHeardAt: 0, path: '', rtt: 0, ice: '', lost: 0, inBytes: 0, outBytes: 0 };
  const isAudio = (r) => (r.kind || r.mediaType) === 'audio';
  async function tick() {
    if (stopped) return;
    let st; try { st = await pc.getStats(); } catch (e) { return; }
    let inb = null, outb = null, src = null, pair = null, tId = null;
    st.forEach((r) => {
      if (r.type === 'inbound-rtp' && isAudio(r)) inb = r; else if (r.type === 'outbound-rtp' && isAudio(r)) outb = r;
      else if (r.type === 'media-source' && isAudio(r)) src = r; else if (r.type === 'transport' && r.selectedCandidatePairId) tId = r.selectedCandidatePairId;
    });
    st.forEach((r) => { if (r.type === 'candidate-pair' && (r.id === tId || (!tId && r.nominated && r.state === 'succeeded'))) pair = r; });
    h.ice = pc.iceConnectionState;
    if (pair) { const lc = st.get(pair.localCandidateId), rc = st.get(pair.remoteCandidateId); h.path = (lc && lc.candidateType) || ''; h.remotePath = (rc && rc.candidateType) || ''; h.rtt = Math.round((pair.currentRoundTripTime || 0) * 1000); }
    const cur = { inB: inb ? inb.bytesReceived || 0 : 0, inE: inb ? inb.totalAudioEnergy || 0 : 0, outB: outb ? outb.bytesSent || 0 : 0, srcE: src ? src.totalAudioEnergy || 0 : 0 };
    h.inBytes = cur.inB; h.outBytes = cur.outB; h.lost = inb ? inb.packetsLost || 0 : 0;
    if (prev) {
      if (!inb) h.hear = 'wait';
      else if (cur.inB - prev.inB <= 0) { h.hearQuietSec = 0; h.hear = Date.now() - t0 > 4000 ? 'nopackets' : 'wait'; }
      else if (cur.inE - prev.inE > 1e-4 * playGain.v * playGain.v) { h.hear = 'ok'; h.lastHeardAt = Date.now(); h.hearQuietSec = 0; }
      else { h.hear = 'quiet'; h.hearQuietSec++; }
      if (!outb) h.send = 'wait';
      else if (cur.outB - prev.outB <= 0) { h.send = Date.now() - t0 > 4000 ? 'nopackets' : 'wait'; h.sendQuietSec = 0; }
      else if (!src) h.send = 'ok';                                                          // browser exposes no source level (e.g. Firefox): packets are flowing
      else if (cur.srcE - prev.srcE > 1e-5) { h.send = 'ok'; h.sendQuietSec = 0; }
      else { h.send = 'quiet'; h.sendQuietSec++; }
      // loud real microphone but nothing (or only silence) reaches the encoder = the Web Audio bus is broken: ask the owner to bypass it
      if (micLevel && !stuckFired && pc.connectionState === 'connected' && outb) {
        if (micLevel() > 0.012) { const flat = src ? cur.srcE - prev.srcE < 1e-6 : cur.outB - prev.outB <= 0; if (flat) silentRun++; else silentRun = 0; }   // only windows in which the mic was really active count
        if (silentRun >= 3) { stuckFired = true; onStuck(); }
      }
    }
    // the link says "connected" but audio packets stopped flowing in either direction: ask for a new network path (ICE restart)
    if (prev && pc.connectionState === 'connected' && Date.now() - t0 > 6000) {
      const stalled = (inb && cur.inB - prev.inB <= 0) || (outb && cur.outB - prev.outB <= 0);
      deadRun = stalled ? deadRun + 1 : 0;
      if (deadRun >= deadAfter) { deadRun = 0; onDead({ hear: h.hear, send: h.send }); }
    } else deadRun = 0;
    prev = cur; onUpdate(Object.assign({}, h));
  }
  const timer = setInterval(tick, intervalMs);
  return { stop() { stopped = true; clearInterval(timer); }, get state() { return h; } };
}

/** Plain-language chips for the UI. cls: good | warn | crit | '' */
export function describeHealth(h, { who = 'other person' } = {}) {
  const net = h.path ? ({ host: 'same network', srflx: 'direct (STUN)', prflx: 'direct', relay: 'relayed (TURN)' }[h.path] || h.path) + (h.rtt ? ' · ' + h.rtt + ' ms' : '') : '';
  let hear, send;
  if (h.hear === 'ok') hear = { cls: 'good', t: `Hearing ${who} ✓`, tip: 'Audio from the other side is arriving and has sound.' };
  else if (h.hear === 'quiet') hear = { cls: h.hearQuietSec > 12 ? 'warn' : '', t: h.hearQuietSec > 12 ? `${who}: silent for ${h.hearQuietSec}s` : `Hearing ${who}: quiet`, tip: 'Packets arrive, but with no sound. Either they are not speaking, or their microphone is silent or muted.' };
  else if (h.hear === 'nopackets') hear = { cls: 'crit', t: `No audio from ${who}`, tip: 'No audio packets are arriving at all. The network is probably blocking the direct path: set up a TURN server (TURN_URLS in .env), or put both devices on the same Wi-Fi.' };
  else hear = { cls: '', t: 'Hearing: connecting…', tip: '' };
  if (h.send === 'ok') send = { cls: 'good', t: 'Your voice is going out ✓', tip: 'Your microphone audio is being sent and has sound.' };
  else if (h.send === 'quiet') send = { cls: h.sendQuietSec > 10 ? 'warn' : '', t: h.sendQuietSec > 10 ? 'Your mic sends silence' : 'Sending: quiet', tip: 'Audio is sent but silent. Check that the right microphone is selected in the system sound settings and that it is not muted.' };
  else if (h.send === 'nopackets') send = { cls: 'crit', t: 'Your audio is not leaving', tip: 'No packets are being sent. The connection is not established.' };
  else send = { cls: '', t: 'Sending: connecting…', tip: '' };
  return { hear, send, net };
}
