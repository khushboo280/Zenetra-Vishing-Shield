// LiveCall: the live state of one call. API3 (the LLM observer, via analyzer.js) reads the merged transcript and returns every score
// AND the alert level (0 none, 1 watch, 2 warning, 3 intervene). This class smooths those scores every 0.25 s, adds the two measured
// audio signals (hesitation H from real pauses/fillers, voice authenticity D from an optional scorer) and fuses them for the charts.
// There are NO keyword rules, thresholds or timers that raise an alert: the level IS API3's alertLevel. An alert never ends the call.
import E from '../engine/engine.js';
import { B } from './hooks.js';
import { now } from './state.js';
const { clamp, fuse, TICK, DEFAULT_CFG, callerBase, convLang } = E;

const FILLERS = /\b(?:u+m+|u+h+|e+r+m*|h+m+|a+h+|mm+)\b|अ+म+|उ+म+|हम्+म|आ+ह/giu;
const TAU = -TICK / Math.log(1 - 0.4);           // smoothing: alpha 0.4 per 0.25 s tick, as a time constant
const NO_STAGES = { authority: false, pressure: false, secrecy: false, demand: false };

class LiveCall {
  constructor(cfg, caller) {
    this.cfg = Object.assign({}, DEFAULT_CFG, cfg || {});
    this.cfg.th = Object.assign({}, DEFAULT_CFG.th, (cfg && cfg.th) || {});
    if (this.cfg.minAlertTurns == null) this.cfg.minAlertTurns = 4;         // API3 must have heard a real conversation before ANY warning level or voice alert is allowed
    if (this.cfg.minAlertSeconds == null) this.cfg.minAlertSeconds = 12;
    this.caller = caller || { number: 'Live caller', kind: 'unknown', label: 'Unknown number' };
    /* sim.shown keeps the shape the UI reads: { who, text, words[], partial } (+ meta, pause, at) */
    this.shown = []; this.open = { caller: null, receiver: null };
    this.t0 = null; this._tEnd = 0; this.tickN = 0; this.timer = null; this.lastSmooth = null; this.lastRegular = null;
    this.ended = false; this.endedBy = null; this.onChange = null;
    this.level = 0; this.callerSpeech = 0;
    this.sc = { I: 0, M: 0, S: 0, H: 0, D: 0, Fam: 0, C: callerBase(this.caller), R: 0 };
    this.F = 0; this.fusion = null; this.feat = null; this.hist = []; this.peakF = 0; this.peakLevel = 0;
    this.warnT = null; this.alertT = null; this.alerts = []; this.lastAlertAt = 0; this.alertBusy = false;
    this.ai = null; this.aiError = null; this.cost = 0.4;
    this.ingestN = 0; this.amp = { caller: 0, receiver: 0 }; this.speaker = null; this.speaking = { caller: false, receiver: false };
    this.lastSpoof = null; this.vadOff = { caller: 0, receiver: 0 }; this.gapBeforeCaller = 0; this.callerOnset = 0;
  }
  get t() { return this.t0 == null ? 0 : this.ended ? this._tEnd : (now() - this.t0) / 1000; }
  /** enough real conversation to judge? (a lone "I am calling from the bank" is not a basis for any alert) */
  get enoughHeard() {
    const t = this.shown.filter((x) => x.text && x.text.trim()), c = t.filter((x) => x.who === 'caller');
    const words = c.reduce((n, x) => n + x.text.split(/\s+/).length, 0);
    return this.t >= this.cfg.minAlertSeconds && ((t.length >= this.cfg.minAlertTurns && c.length >= 2) || words >= 45);
  }
  get familiar() { return !!(this.feat && this.feat.familiar); }

  start() {
    if (this.t0 != null) return;
    this.t0 = now(); this.lastSmooth = this.lastRegular = this.t0;
    this.timer = setInterval(() => this._pump(), TICK * 1000 / 2);
  }
  _pump() {
    if (this.ended) return;
    let n = 0;
    while (now() - this.lastRegular >= TICK * 1000 && n < 8) { this.lastRegular += TICK * 1000; n++; const ev = []; this._tick(ev, false); if (ev.length) B.onEvents(ev); }
    if (n === 8) this.lastRegular = now();
    for (const who of ['caller', 'receiver']) {   // a turn whose "final" never arrived is closed after 2.5 s of silence
      const o = this.open[who]; if (o && now() - o._u > 2500 && !this.speaking[who]) { this._close(who); this._after(who); }
    }
  }

  /* ---- transcript wiring ---------------------------------------------------------------
     text = words of THIS segment · segFinal = segment will not change · turnEnd = the speaker's turn is over        */
  ingest(who, text, segFinal, turnEnd, startedAt) {
    text = (text || '').trim(); if (text && segFinal) this.ingestN++;
    let turn = this.open[who];
    if (!turn) { if (!text) return; turn = this._newTurn(who, startedAt); }
    if (text) {
      if (segFinal) { turn._base = (turn._base ? turn._base + ' ' : '') + text; turn._tail = ''; } else turn._tail = text;
      turn.text = (turn._base + (turn._tail ? (turn._base ? ' ' : '') + turn._tail : '')).trim();
      turn.words = turn.text.split(/\s+/);
      const nf = (turn.text.match(FILLERS) || []).length; turn.meta.fillers = nf;
      turn.meta.script = who === 'caller' && turn.words.length >= 18 && nf === 0 ? 25 : 0;
    }
    turn._u = now(); turn.partial = !turnEnd;
    if (turnEnd) this._close(who);
    this._after(who);
  }
  _newTurn(who, startedAt) {                      // startedAt (ms, same clock as now()) = when the utterance began: the two streams answer at different speeds, so turns are merged in SPOKEN order
    const pause = who === 'caller' && now() - this.callerOnset < 6000 ? Math.round(this.gapBeforeCaller) : 0;
    const st = startedAt != null && this.t0 != null ? Math.max(this.t0, startedAt) : now();
    const turn = { who, text: '', words: [], partial: true, at: Math.max(0, (st - (this.t0 == null ? st : this.t0)) / 1000), meta: { spoof: this.lastSpoof, fillers: 0, script: 0 }, pause, _base: '', _tail: '', _u: now(), _st: st };
    let i = this.shown.length; while (i > 0 && (this.shown[i - 1]._st || 0) > st) i--;
    this.shown.splice(i, 0, turn); this.open[who] = turn; return turn;
  }
  _close(who) { const o = this.open[who]; if (o) { o.partial = false; this.open[who] = null; } }
  _after(who) {                                  // repaint the transcript, ask AI again, re-score right away
    B.syncTranscript();
    if (this.onChange) this.onChange(who);
    const ev = [{ type: 'words', who }]; this._tick(ev, true); B.onEvents(ev);
  }

  /* ---- AI's read of the conversation ------------------------------------------------ */
  setAI(res) {
    this.ai = res; this.aiError = null;
    const ev = []; this._tick(ev, true);
    // API3 alone decides WHEN a spoken alert goes out (alertNow). Never while the people know each other, never on top of one that is still playing.
    if (res.alertNow && !res.familiar && this.enoughHeard && !this.alertBusy && !this.ended) this._alert(ev, 'api3', this.F, this.t);
    B.onEvents(ev);
  }
  _features() {
    const ai = this.ai;
    const none = { I: 0, M: 0, S: 0, Fam: 0, R: 0, hardAsk: false, asks: {}, stages: Object.assign({}, NO_STAGES), stageCount: 0, familiar: false, counts: {} };
    if (!ai) return none;
    // FAMILIARITY OVERRIDE: API3 says these two people know each other -> every risk score stays at zero, whatever the topic
    if (ai.familiar) return Object.assign(none, { Fam: ai.familiarity, R: ai.compliance, familiar: true });   // the bond and the receiver's willingness are real measurements; the risk scores stay at zero
    const stages = Object.assign({}, NO_STAGES, ai.stages);
    return {
      I: ai.intent, M: ai.manipulation, S: ai.sentiment, R: ai.compliance, Fam: ai.claimUnverified ? Math.min(ai.familiarity, 25) : ai.familiarity,
      hardAsk: !!ai.asksSensitive, asks: { otp: !!ai.asksSensitive }, stages, stageCount: Object.values(stages).filter(Boolean).length, familiar: false, counts: {},
    };
  }

  /* ---- audio-derived signals -------------------------------------------------------------- */
  setActivity(who, speaking, amp) {
    const was = this.speaking[who]; this.speaking[who] = speaking; this.amp[who] = amp;
    this.speaker = this.speaking.caller ? 'caller' : this.speaking.receiver ? 'receiver' : null;
    const tn = now();
    if (was && !speaking) this.vadOff[who] = tn;
    if (!was && speaking && who === 'caller') { this.callerOnset = tn; this.gapBeforeCaller = this.vadOff.receiver ? Math.min(6000, tn - this.vadOff.receiver) : 0; }
  }
  setSpoof(p) {
    this.lastSpoof = clamp(p);
    const c = this.open.caller || [...this.shown].reverse().find((x) => x.who === 'caller');
    if (c) c.meta.spoof = this.lastSpoof;
  }

  /* ---- the 0.25 s scoring tick ------------------------------------------------------------- */
  _tick(ev, immediate) {
    if (this.ended) return;
    const tn = now(), t = this.t;
    if (!immediate) { this.tickN++; if (this.speaking.caller) this.callerSpeech += TICK; }
    const c0 = now();
    const f = this._features();
    const caller = this.shown.filter((x) => x.who === 'caller');
    const lastC = caller.slice(-2);
    const hOf = (x) => { const m = x.meta || {}; return clamp(((x.pause || 0) - 500) / 20) + (m.fillers || 0) * 7 + (m.script || 0) * 0.4; };
    const Ht = lastC.length ? clamp(lastC.reduce((a, x, k) => a + hOf(x) * (k === lastC.length - 1 ? 0.65 : 0.35), 0) / (lastC.length === 1 ? 0.65 : 1)) : 0;
    const scored = caller.filter((x) => x.meta && x.meta.spoof != null);                 // D comes ONLY from a real voice-authenticity scorer; none installed = 0
    const conf = 1 - Math.exp(-this.callerSpeech / 3.2);
    const Dt = scored.length ? clamp(scored.reduce((a, x) => a + x.meta.spoof, 0) / scored.length * conf) : 0;
    const tg = { I: f.I, M: f.M, S: f.S, H: Ht, D: Dt, Fam: f.Fam, R: f.R };
    const dt = Math.min(1, (tn - this.lastSmooth) / 1000); this.lastSmooth = tn;
    const al = 1 - Math.exp(-dt / TAU);
    for (const k of Object.keys(tg)) this.sc[k] = clamp(this.sc[k] + (tg[k] - this.sc[k]) * al);
    const feat = Object.assign({}, f, { H: this.sc.H, D: this.sc.D, C: this.sc.C, I: this.sc.I, M: this.sc.M, S: this.sc.S, Fam: this.sc.Fam, R: this.sc.R });
    const fu = fuse(feat); this.fusion = fu; this.feat = f; this.cost = now() - c0;
    const th = this.cfg.th, ai = this.ai;
    let F = this.shown.length && ai ? fu.F : 0;
    const target = ai && this.shown.length ? (this.enoughHeard ? ai.alertLevel : Math.min(ai.alertLevel, 1)) : 0;   // API3 decides the level, but only once it has heard a real conversation
    // keep the risk wave consistent with API3's decision (the fused number is for display only)
    if (target >= 3) F = Math.max(F, th.intervene); else if (target === 2) F = clamp(Math.max(F, th.warn), 0, th.intervene - 1); else if (target === 1) F = clamp(Math.max(F, th.watch), 0, th.warn - 1); else F = Math.min(F, th.watch - 1);
    this.F = F; this.peakF = Math.max(this.peakF, F);
    if (target !== this.level) {
      const from = this.level; this.level = target; this.peakLevel = Math.max(this.peakLevel, target);
      if (target >= 2 && this.warnT == null) this.warnT = t;
      ev.push({ type: 'level', from, to: target, reason: 'api3', F, t });
    }
    const sample = { t, F, I: this.sc.I, M: this.sc.M, S: this.sc.S, H: this.sc.H, D: this.sc.D, Fam: this.sc.Fam, C: this.sc.C, R: this.sc.R, level: this.level };
    if (!immediate) this.hist.push(sample);
    ev.push({ type: 'tick', sample, immediate: !!immediate });
  }
  _alert(ev, reason, F, t) {
    this.lastAlertAt = now(); if (this.alertT == null) this.alertT = t;
    const a = { t, F, reason, why: this.ai ? (this.ai.alertReason || this.ai.summary) : '' }; this.alerts.push(a);
    ev.push({ type: 'alert', ...a });
  }

  /* only the receiver (user) ends a call, or the other side hangs up */
  endCall(by) {
    if (this.ended) return;
    this._tEnd = this.t; this.ended = true; this.endedBy = this.endedBy || by || 'ended';
    clearInterval(this.timer); this.timer = null;
    ['caller', 'receiver'].forEach((w) => this._close(w));
  }
  lang() { return this.ai && this.ai.language ? (this.ai.language === 'en' ? 'en' : 'hi') : convLang(this.shown, this.cfg.langOverride); }
  report() {
    const lvl = this.peakLevel;
    const verdict = this.familiar && lvl === 0 ? 'Known caller' : lvl >= 3 ? 'Fraud flagged' : lvl === 2 ? 'Suspicious' : lvl === 1 ? 'Low risk' : 'Genuine';
    return { verdict, outcome: 'n/a', truth: null, peakF: this.peakF, peakLevel: lvl, warnT: this.warnT, alertT: this.alertT, alerts: this.alerts.length, lang: this.lang(), duration: this.t, endedBy: this.endedBy || (this.ended ? 'finished' : 'running'), turns: this.shown.length, summary: this.ai ? this.ai.summary : '' };
  }
}

export { LiveCall };
