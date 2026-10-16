// Sends the growing transcript to AI (through the server, so the key stays secret) and feeds the answer to LiveCall.
// One request in flight at a time; if words arrive meanwhile, one more request follows. No transcript -> no request.
import { B } from './hooks.js';

export class Analyzer {
  constructor(socket, call, { minGapMs = 1200 } = {}) {
    Object.assign(this, { socket, call, minGapMs, busy: false, dirty: false, timer: null, lastRun: 0, lastKey: '', fails: 0, backoff: 0, warned: false, stopped: false });
  }
  poke() { if (this.stopped) return; this.dirty = true; if (!this.busy && !this.timer) this._schedule(); }
  _schedule() { this.timer = setTimeout(() => { this.timer = null; this._run(); }, Math.max(0, this.lastRun + Math.max(this.minGapMs, this.backoff) - Date.now())); }
  _run() {
    if (this.stopped || this.call.ended) return;
    const turns = this.call.shown.filter((t) => t.text.trim()).map((t) => ({ who: t.who, text: t.text }));
    const key = JSON.stringify(turns);
    this.dirty = false;
    if (!turns.length || key === this.lastKey) return;
    this.busy = true; this.lastRun = Date.now();
    this.socket.timeout(25000).emit('analyze', { turns, caller: { label: this.call.caller.label, alertsSpoken: this.call.alerts.length, secondsSinceAlert: this.call.alerts.length ? (performance.now() - this.call.lastAlertAt) / 1000 : 0, callSeconds: this.call.t, turns: turns.length, callerTurns: turns.filter((x) => x.who === 'caller').length, receiverTurns: turns.filter((x) => x.who === 'receiver').length } }, (err, res) => {
      this.busy = false;
      if (this.stopped) return;
      if (err || !res || !res.ok) {
        const msg = err ? 'AI did not answer in time' : res && res.error;
        this.call.aiError = msg; this.fails++; this.backoff = (res && res.retryMs) || Math.min(15000, 1500 * 2 ** Math.min(this.fails, 4));   // never hammer a provider that is rate-limiting or down
        if (!this.warned || this.fails % 10 === 0) { this.warned = true; B.notify('AI scoring unavailable: ' + msg + '. Scores stay where they are.', 2); }
        B.onAIStatus && B.onAIStatus(false, msg);
      } else {
        this.lastKey = key; this.fails = 0; this.backoff = 0; this.warned = false;
        this.call.setAI(res.result); B.onAIStatus && B.onAIStatus(true);
      }
      if (this.dirty || this.fails) this._schedule();
    });
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
}
