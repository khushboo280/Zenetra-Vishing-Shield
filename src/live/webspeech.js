// Browser speech recognition (Chrome / Edge / Android Chrome): free, no key. It hears the microphone of the device it runs on,
// so each side transcribes its OWN voice: the receiver's dashboard -> 'receiver', the caller page -> 'caller' (sent over the socket).
export const webSpeechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
// On phones every (re)start of SpeechRecognition plays the system "mic on" beep and it fights WebRTC for the microphone, so the
// browser engine is only used automatically on desktop. Phones are transcribed through the server providers instead.
export const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform || ''));
export const webSpeechUsable = () => webSpeechSupported() && !isMobile();

export class WebSpeech {
  constructor({ lang = 'en-IN', onResult, onError, endMs = 1100 }) { Object.assign(this, { lang, onResult, onError, endMs, active: false, rec: null, endTimer: null }); }
  start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.onError && this.onError('This browser has no speech recognition. Use Chrome or Edge, or set the provider keys (npm run setup).'); return false; }
    this.active = true; this._spawn(SR); return true;
  }
  _spawn(SR) {
    const rec = new SR(); this.rec = rec;
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], text = r[0].transcript.trim(); if (!text) continue;
        this.onResult({ text, segFinal: r.isFinal, turnEnd: false });
        clearTimeout(this.endTimer);
        this.endTimer = setTimeout(() => this.onResult({ text: '', segFinal: false, turnEnd: true }), this.endMs);   // a pause closes the turn
      }
    };
    rec.onerror = (e) => { if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) { this.active = false; this.onError && this.onError('Speech recognition blocked: ' + e.error); } };
    const t0 = Date.now();
    rec.onend = () => {                                                  // Chrome stops every so often: restart, but back off when it ends at once (no beep storm)
      if (!this.active) return;
      this.quick = Date.now() - t0 < 4000 ? (this.quick || 0) + 1 : 0;
      setTimeout(() => this.active && this._spawn(SR), Math.min(5000, 150 + this.quick * 600));
    };
    try { rec.start(); } catch (e) {}
  }
  stop() { this.active = false; clearTimeout(this.endTimer); try { this.rec && this.rec.stop(); } catch (e) {} }
}
