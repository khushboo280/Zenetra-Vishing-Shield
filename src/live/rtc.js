// WebRTC plumbing shared by the receiver and the caller page: the three things that silently break two-way audio.
//  1. ICE candidates that arrive before the remote description are NOT errors to ignore - they must be queued and applied afterwards.
//  2. A remote stream is only heard if it is attached to a media element that is actually playing (autoplay rules block it until a tap).
//  3. An AudioContext that stays "suspended" produces silence (our outgoing mic bus), so it is watched and, if needed, bypassed.

/** Handle signalling messages strictly one after another, and queue ICE until a remote description exists. */
export function makeSignalHandler(pc, { onOffer, onAnswer, log = () => {} } = {}) {
  let chain = Promise.resolve(); const queue = [];
  const ready = () => !!(pc.remoteDescription && pc.remoteDescription.type);
  const flush = async () => { while (queue.length && ready()) { const c = queue.shift(); try { await pc.addIceCandidate(c); } catch (e) { log('ice', e); } } };
  const handle = async (m) => {
    if (!m) return;
    if (m.type === 'offer') { if (onOffer) await onOffer(m); await flush(); }
    else if (m.type === 'answer') { if (onAnswer) await onAnswer(m); await flush(); }
    else if (m.type === 'ice') {
      const c = m.candidate; if (!c) return;
      if (!ready()) { queue.push(c); return; }
      try { await pc.addIceCandidate(c); } catch (e) { log('ice', e); }
    }
  };
  return (m) => { chain = chain.then(() => handle(m)).catch((e) => log('signal', e)); return chain; };
}

/** One shared AudioContext for playback levelling (created lazily, resumed on any tap). */
/** playout volume of the <audio> element (the stats' energy is scaled by its square); health.js compensates for it */
export const playGain = { v: 1 };
let playCtx = null;
function playContext() {
  if (playCtx) return playCtx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  try { playCtx = new AC({ latencyHint: 'interactive' }); } catch (e) { return null; }
  const wake = () => { if (playCtx.state !== 'running') playCtx.resume().catch(() => {}); };
  ['pointerdown', 'keydown', 'touchend', 'click'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));
  return playCtx;
}
/** Voice leveller for what you HEAR: quiet speech is lifted, loud peaks are held back, so the other person is clear and even without turning
 *  the phone to maximum. Falls back to the plain element automatically if Web Audio is not running. */
function leveller(el, stream, boost) {
  const ctx = playContext(); if (!ctx || !boost || boost <= 1) return null;
  try {
    const src = ctx.createMediaStreamSource(stream), hp = ctx.createBiquadFilter(), comp = ctx.createDynamicsCompressor(), gain = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 90;                                          // rumble / handling noise
    comp.threshold.value = -32; comp.knee.value = 24; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    gain.gain.value = boost;
    src.connect(hp); hp.connect(comp); comp.connect(gain); gain.connect(ctx.destination);
    el.volume = playGain.v = 0.01;                                                                       // NOT muted: a muted element stops Chrome's playout stats (health checks would see silence). It only keeps the stream alive; the leveller is what you hear.
    const check = () => { if (ctx.state !== 'running') { el.volume = 1; return false; } el.volume = playGain.v = 0.01; return true; };
    ctx.resume().catch(() => {}); setTimeout(check, 1500); ctx.addEventListener('statechange', check);
    return { stop() { try { src.disconnect(); gain.disconnect(); } catch (e) {} el.volume = playGain.v = 1; } };
  } catch (e) { el.volume = playGain.v = 1; return null; }
}

/** Play a remote MediaStream. Returns { el, retry, stop }. Calls onBlocked() if the browser needs a tap (and offers one on screen). */
export function playRemote(stream, { muted = false, boost = 1, onBlocked = () => {}, onPlaying = () => {} } = {}) {
  const el = document.createElement('audio');
  el.autoplay = true; el.setAttribute('playsinline', ''); el.playsInline = true; el.muted = !!muted; el.srcObject = stream; el.style.display = 'none';
  document.body.appendChild(el);                                              // attached to the page: some mobile browsers refuse detached elements
  const lev = muted ? null : leveller(el, stream, boost);
  let banner = null, stopped = false;
  const hideBanner = () => { if (banner) { banner.remove(); banner = null; } };
  const retry = () => { if (stopped) return Promise.resolve(); return el.play().then(() => { hideBanner(); onPlaying(); }).catch(() => { showBanner(); onBlocked(); }); };
  function showBanner() {
    if (banner || stopped) return;
    banner = document.createElement('button'); banner.type = 'button'; banner.id = 'audioUnlock'; banner.textContent = '🔊 Tap to hear the other person';
    banner.style.cssText = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:99999;padding:12px 18px;border:0;border-radius:999px;background:#2563eb;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer';
    banner.addEventListener('click', () => { retry(); });
    document.body.appendChild(banner);
  }
  const gesture = () => { if (el.paused && !stopped) retry(); };
  const evs = ['pointerdown', 'keydown', 'touchend', 'click'];
  evs.forEach((ev) => document.addEventListener(ev, gesture, { passive: true }));
  el.addEventListener('playing', () => { hideBanner(); onPlaying(); });
  const onAdd = () => retry(); try { stream.addEventListener('addtrack', onAdd); } catch (e) {}
  const keep = setInterval(() => { if (!stopped && el.paused && stream.getAudioTracks().some((t) => t.readyState === 'live')) retry(); }, 2000);   // some browsers pause the element on a track change / network blip
  retry();
  return { el, retry, stop() { stopped = true; clearInterval(keep); hideBanner(); if (lev) lev.stop(); evs.forEach((ev) => document.removeEventListener(ev, gesture)); try { stream.removeEventListener('addtrack', onAdd); } catch (e) {} try { el.pause(); el.srcObject = null; el.remove(); } catch (e) {} } };
}

/** Keep an AudioContext alive. If it stays suspended after `graceMs`, call onStuck() (the caller then bypasses the Web Audio bus). */
export function watchContext(ctx, { graceMs = 1500, onStuck = () => {} } = {}) {
  let done = false;
  const t = setTimeout(() => { if (!done && ctx.state !== 'running') { ctx.resume().catch(() => {}); setTimeout(() => { if (!done && ctx.state !== 'running') onStuck(); }, 400); } }, graceMs);
  return () => { done = true; clearTimeout(t); };
}

/** The stream to play for a track event (some browsers deliver no stream object). */
export const streamOf = (e) => (e.streams && e.streams[0]) || new MediaStream([e.track]);

/** Kept as a no-op: v25's sender tuning was removed (call audio goes out exactly as negotiated). */
export function tuneSender() {}
