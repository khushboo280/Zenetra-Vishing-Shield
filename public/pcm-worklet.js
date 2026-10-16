// Runs on the audio thread. Averages the input down to 16 kHz and posts ~100 ms Int16 frames.
//   channels = 1  ->  mono frames                      (one STT socket per stream)
//   channels = 2  ->  interleaved L/R frames           (Deepgram multichannel: ch0 = caller, ch1 = receiver)
class PCM extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.n = o.processorOptions.channels;
    this.r = sampleRate / 16000;
    this.pos = 0; this.cnt = 0; this.k = 0;
    this.acc = new Float64Array(this.n);
    this.out = new Int16Array(1600 * this.n);
  }
  process(inputs) {
    const len = inputs[0] && inputs[0][0] ? inputs[0][0].length : 0;
    if (!len) return true;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.n; c++) { const ch = inputs[c] && inputs[c][0]; this.acc[c] += ch ? ch[i] : 0; }
      this.cnt++; this.pos++;
      if (this.pos >= this.r) {
        this.pos -= this.r;
        for (let c = 0; c < this.n; c++) {
          const v = Math.max(-1, Math.min(1, this.acc[c] / this.cnt));
          this.out[this.k++] = v < 0 ? v * 32768 : v * 32767;
          this.acc[c] = 0;
        }
        this.cnt = 0;
        if (this.k >= this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(1600 * this.n); this.k = 0; }
      }
    }
    return true;
  }
}
registerProcessor('vs-pcm', PCM);
