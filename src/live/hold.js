// ALERT delivery: while the warning plays the receiver's mic is held off and the caller hears the pre-recorded / AI-voiced
// warning instead (RTCRtpSender.replaceTrack). When it ends everything is put back and the call simply continues.
// Nothing here ends the call: only the user's End Call button (or the other side hanging up) does.
import { S } from './state.js';
import { B } from './hooks.js';

function waitEnded(a, ms) {
  return new Promise((res) => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    a.addEventListener('ended', fin, { once: true }); a.addEventListener('error', fin, { once: true });
    setTimeout(fin, ms);
  });
}
/** Voice for the caller. There is deliberately NO beep fallback: if no voice is available the caller is simply not interrupted, and the receiver is told why. */
export async function playWarning(lang) {
  if (S.ensureAudio) await S.ensureAudio(lang);                                   // a TTS request may still be running: wait for the voice instead of playing a tone
  const a = S.warnEls[lang];
  if (!a || a._bad) return false;
  try { a.currentTime = 0; await a.play(); await waitEnded(a, Math.max(4000, ((a.duration || 12) + 1.5) * 1000)); return true; } catch (e) { return false; }
}

/** The receiver hears the warning in the same AI voice. Resolves true when played, false when the browser's own speech should be used instead. */
export async function playReceiverWarning(lang) {
  if (S.ensureAudio) await S.ensureAudio(lang);
  const a = S.recvEls && S.recvEls[lang]; if (!a || a._bad) return false;
  try { a.currentTime = 0; await a.play(); await waitEnded(a, Math.max(4000, ((a.duration || 14) + 1.5) * 1000)); return true; } catch (e) { return false; }
}

/** Plays the warning to the caller. `alsoWait` (optional promise) keeps the mic held until the receiver's own spoken warning is done too. */
export async function alertCaller(lang, alsoWait) {
  if (!S.active || S.alertBusy) return false;
  if (S.test) { S.alertBusy = true; if (S.call) S.call.alertBusy = true; try { await alsoWait; } finally { S.alertBusy = false; if (S.call) S.call.alertBusy = false; } return true; }   // uploaded-recording test: there is no caller device to speak to
  if (S.ensureAudio) await S.ensureAudio(lang);
  const voice = S.warnEls[lang]; if (!voice || voice._bad) { B.notify('No voice provider (ElevenLabs / Sarvam / OpenAI / Gemini key): the caller could not be warned by voice. The receiver was warned.', 1); return false; }
  S.alertBusy = true; if (S.call) S.call.alertBusy = true;
  if (S.out) {                                                                     // click-free path: crossfade mic -> warning -> mic with gain ramps
    const { ctx, micGain, warnGain } = S.out, ramp = (p, v) => p.setTargetAtTime(v, ctx.currentTime, 0.02);
    try { ramp(micGain.gain, 0); ramp(warnGain.gain, 1); await Promise.all([playWarning(lang), alsoWait || null]); }
    finally {
      if (S.active) { ramp(warnGain.gain, 0); await new Promise((r) => setTimeout(r, 120)); ramp(micGain.gain, S.userMuted ? 0 : 1); }
      S.alertBusy = false; if (S.call) S.call.alertBusy = false;
    }
    return true;
  }
  const tracks = S.localStream.getAudioTracks();
  tracks.forEach((t) => { t.enabled = false; });                                   // (a) the caller no longer hears the receiver
  const sender = S.sender, orig = sender && sender.track;
  if (sender) { try { await sender.replaceTrack(S.warnDest.stream.getAudioTracks()[0]); } catch (e) { B.notify('replaceTrack failed: ' + e.message, 2); } }   // (b) the caller hears the warning
  else B.notify('No RTCRtpSender: the warning cannot be sent to the caller. Pass { pc } to startLiveCall.', 2);
  try { await Promise.all([playWarning(lang), alsoWait || null]); } finally {
    if (S.active && sender && orig) { try { await sender.replaceTrack(orig); } catch (e) { B.notify('Could not restore the mic track: ' + e.message, 2); } }
    if (S.active) tracks.forEach((t) => { t.enabled = !S.userMuted; });            // the call carries on exactly as before (respecting a manual Mute)
    S.alertBusy = false; if (S.call) S.call.alertBusy = false;
  }
  return true;
}
