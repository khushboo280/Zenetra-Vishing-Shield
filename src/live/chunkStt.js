// Chunked speech-to-text for ONE audio stream (API1 = the receiver's own microphone, API2 = the caller's remote WebRTC audio).
// The AudioWorklet delivers 16 kHz Int16 frames (~100 ms). A voice gate cuts them into short utterances; each is sent over the
// Socket.IO WebSocket to the server, which routes it to the provider configured for this stream. Results go to onText(text, startedAt).
//
// Built for LOW LATENCY (speech -> text on screen in about 1-2 s with a fast provider):
//   * an utterance ends after ~380 ms of silence (not ~1.3 s)
//   * a long sentence is cut at its first natural dip after 3.5 s (hard cap 7 s), so words appear while the person is still talking
//   * up to 2 requests in flight per stream, no artificial spacing; results are merged later in SPOKEN order (LiveCall)
// and for ACCURACY: chunks that are mostly echo of the other side's voice, or too short / too quiet to be speech, are never sent.
const FRAME_MS = 100;
export class ChunkStt {
  constructor({ who, socket, isSpeaking, isLeak = () => false, onText, onStatus = () => {}, hangMs = 380, minVoiceMs = 300, softMs = 3500, softQuietMs = 200, maxMs = 7000, maxParallel = 2, leakLimit = 0.7 }) {
    Object.assign(this, { who, socket, isSpeaking, isLeak, onText, onStatus, hangMs, minVoiceMs, softMs, softQuietMs, maxMs, maxParallel, leakLimit });
    Object.assign(this, { pre: [], chunks: [], active: false, voiced: 0, leaked: 0, lastVoice: 0, t0: 0, q: [], inflight: 0, fails: 0, stopped: false, hist: '', lat: 0, rt: 0 });
  }
  /** feed one worklet frame (ArrayBuffer of Int16 @16 kHz) */
  push(buf, nowMs) {
    if (this.stopped) return;
    const a = new Int16Array(buf), now = nowMs == null ? performance.now() : nowMs, sp = !!this.isSpeaking(), ms = (a.length / 16) || FRAME_MS;
    if (!this.active) {
      this.pre.push(a); if (this.pre.length > 4) this.pre.shift();                  // keep 400 ms before the voice starts so the first word is not cut
      if (!sp) return;
      this.active = true; this.chunks = this.pre; this.pre = []; this.voiced = 0; this.leaked = 0; this.t0 = now - this.chunks.length * FRAME_MS; this.lastVoice = now;
    } else this.chunks.push(a);
    if (sp) { this.lastVoice = now; this.voiced += ms; if (this.isLeak()) this.leaked += ms; }
    const quiet = now - this.lastVoice, dur = now - this.t0;
    if (quiet > this.hangMs || dur > this.maxMs || (dur > this.softMs && quiet >= this.softQuietMs)) this._flush(now);
  }
  _flush(now) {
    const parts = this.chunks, voiced = this.voiced, leaked = this.leaked, t0 = this.t0, tEnd = this.lastVoice;
    this.chunks = []; this.active = false; this.voiced = 0; this.leaked = 0;
    if (voiced < this.minVoiceMs) return;                                            // a click or cough, not speech
    if (leaked / voiced > this.leakLimit) return;                                    // mostly the other person's voice coming out of the speaker
    const n = parts.reduce((s, p) => s + p.length, 0), pcm = new Int16Array(n); let o = 0;
    for (const p of parts) { pcm.set(p, o); o += p.length; }
    this.q.push({ pcm, t0, tEnd }); if (this.q.length > 6) this.q.shift();           // never build a backlog
    this._pump();
  }
  _pump() {
    while (!this.stopped && this.q.length && this.inflight < this.maxParallel) {
      const { pcm, t0, tEnd } = this.q.shift(); this.inflight++; const sent = performance.now();
      const done = (err, res) => {
        this.inflight--;
        if (!this.stopped) {
          if (err || !res || !res.ok) { this.fails++; this.onStatus(false, err ? 'speech-to-text did not answer in time' : res && res.error, this.fails); }
          else {
            this.fails = 0; const t = performance.now();
            this.rt = this.rt ? this.rt * 0.6 + (res.ms || t - sent) * 0.4 : (res.ms || t - sent); this.lat = this.lat ? this.lat * 0.6 + (t - tEnd) * 0.4 : t - tEnd;   // provider time / end-of-speech -> text
            this.onStatus(true, '', 0, { lat: this.lat, rt: this.rt });
            if (res.text) { this.hist = (this.hist + ' ' + res.text).slice(-160); this.onText(res.text, t0); }
          }
        }
        this._pump();
      };
      try { this.socket.timeout(25000).emit('transcribe', { who: this.who, pcm: pcm.buffer, ctx: this.hist }, done); }
      catch (e) { done(e); }
    }
  }
  stop() { this.stopped = true; this.q = []; }
}
