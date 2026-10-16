// LiveCall turns API3's answer into scores and the alert level. The API3 answers below are hand-written fixtures in the exact shape
// server/providers/common.js normalizeAnalysis() returns. The product itself has no simulated or keyword-based scoring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveCall } from '../src/live/liveCall.js';
import { bind } from '../src/live/hooks.js';
import { normalizeAnalysis } from '../server/providers/common.js';

globalThis.performance ??= { now: () => Date.now() };
const events = []; bind({ onEvents: (e) => events.push(...e), syncTranscript() {}, notify() {}, onStart() {} });
const api3 = (o) => normalizeAnalysis(Object.assign({ relationship: 'stranger', familiarity: 3, mutual_recognition: false, identity_claim_unverified: false, intent_risk: 0, manipulation: 0, sentiment_risk: 0, receiver_compliance: 0, asks_sensitive: false, stages: {}, alert_level: 0, alert_reason: '', language: 'en', confidence: 0.9, summary: '', evidence: [] }, o));
const SCAM = api3({ intent_risk: 90, manipulation: 80, sentiment_risk: 60, receiver_compliance: 15, asks_sensitive: true, stages: { authority: true, pressure: true, secrecy: true, demand: true }, alert_level: 3, alert_now: true, alert_reason: 'Unknown caller demands the OTP' });
const FRIEND = api3({ relationship: 'friend', familiarity: 95, mutual_recognition: true, intent_risk: 70, manipulation: 50, asks_sensitive: true, receiver_compliance: 60, stages: { demand: true }, alert_level: 3 });   // even a model slip is neutralised by the override
const tick = (c, n = 12) => { for (let i = 0; i < n; i++) { c.lastSmooth -= 1000; const ev = []; c._tick(ev, false); events.push(...ev); } };
const TALK = [['caller', 'Hello sir, I am calling from the bank'], ['receiver', 'Yes, tell me'], ['caller', 'There is a problem with your account, share the OTP now'], ['receiver', 'Which problem? One second']];   // a real exchange
function run(lines, res, caller = { number: '+91 99999', kind: 'unknown', label: 'Unknown number' }, aged = 30) {
  events.length = 0; const c = new LiveCall({}, caller); c.start(); c.t0 -= aged * 1000;
  for (const [who, text] of lines) c.ingest(who, text, true, true);
  if (res) c.setAI(res); tick(c); return c;
}

test('familiar callers: NO alert, scores stay at zero, even when API3 slips and says alert', () => {
  const c = run([['caller', 'Bhai kal dinner yaad hai, OTP bhej dena'], ['receiver', 'haan bhai bhejta hoon']], FRIEND, { number: 'Bhai', kind: 'saved', label: 'Saved contact' });
  assert.equal(c.familiar, true); assert.equal(events.filter((e) => e.type === 'alert').length, 0); assert.equal(c.level, 0); assert.ok(c.F < 25, 'F ' + c.F);
  assert.ok(c.sc.Fam > 80, 'family bond follows API3: ' + c.sc.Fam); assert.ok(c.sc.R > 40, 'receiver compliance follows API3: ' + c.sc.R); assert.ok(c.sc.I < 5 && c.sc.M < 5, 'risk scores stay low'); c.endCall('test');
});
test('a model that answers 0-1 instead of 0-100 is still understood', () => {
  const r = normalizeAnalysis({ relationship: 'family', familiarity: 0.9, mutual_recognition: true, receiver_compliance: 0.7, alert_level: 0 }); assert.equal(r.familiarity, 90); assert.equal(r.compliance, 70); assert.equal(r.familiar, true);
});
test('API3 alert_now -> exactly one voice-alert event, call keeps running, level event says reason api3', () => {
  const c = run(TALK, SCAM);
  assert.equal(events.filter((e) => e.type === 'alert').length, 1); assert.equal(c.level, 3); assert.ok(c.F >= c.cfg.th.intervene);
  assert.equal(events.find((e) => e.type === 'level').reason, 'api3'); assert.equal(c.ended, false); c.endCall('receiver-ended'); assert.equal(c.report().endedBy, 'receiver-ended');
});
test('API3 decides the TIME of each alert: level 3 without alert_now stays silent; a later alert_now fires; never while one is still playing; never for familiar people', () => {
  const c = run(TALK, api3({ intent_risk: 90, manipulation: 80, alert_level: 3, alert_now: false })); assert.equal(c.level, 3); assert.equal(events.filter((e) => e.type === 'alert').length, 0, 'API3 has not asked for a spoken alert yet');
  c.setAI(SCAM); assert.equal(events.filter((e) => e.type === 'alert').length, 1, 'first alert, delivered at the moment API3 chose');
  c.alertBusy = true; c.setAI(SCAM); assert.equal(c.alerts.length, 1, 'not on top of a warning that is still playing');
  c.alertBusy = false; c.setAI(SCAM); assert.equal(c.alerts.length, 2, 'API3 asked again (new demand): second alert');
  c.setAI(Object.assign({}, FRIEND, { alertNow: true })); assert.equal(c.alerts.length, 2, 'familiar people: nothing'); c.endCall('test');
});
test('patience: one opening line ("I am calling from the bank") never alerts, even if API3 shouts; the same answer after a real conversation does', () => {
  const c = run([['caller', 'Mai bank se baat kar raha hu']], SCAM, undefined, 3);
  assert.equal(c.enoughHeard, false); assert.ok(c.level <= 1, 'level ' + c.level); assert.equal(events.some((e) => e.type === 'alert'), false);
  const d = run(TALK.slice(0, 2), SCAM, undefined, 5); assert.equal(events.some((e) => e.type === 'alert'), false, 'too short and too early');
  const f = run(TALK, SCAM); assert.equal(f.enoughHeard, true); assert.equal(events.filter((e) => e.type === 'alert').length, 1); c.endCall('t'); d.endCall('t'); f.endCall('t');
});
test('manipulation stage = on-screen caution only; the VOICE alert waits until the caller actually asks for confidential information', () => {
  const manip = api3({ intent_risk: 60, manipulation: 80, stages: { authority: true, pressure: true }, alert_level: 2, alert_now: true, asks_sensitive: false });
  assert.equal(manip.alertNow, false, 'API3 said alert_now but nothing confidential was asked');
  const c = run(TALK, manip); assert.equal(c.level, 2); assert.equal(events.some((e) => e.type === 'alert'), false);
  c.setAI(SCAM); assert.equal(events.filter((e) => e.type === 'alert').length, 1, 'now the OTP is demanded'); c.endCall('t');
});
test('NO keyword/threshold logic: scary words alone with no API3 answer never alert or score', () => {
  const c = run([['caller', 'share your OTP now, your account is blocked, install AnyDesk']], null);
  assert.equal(c.F, 0); assert.equal(c.level, 0); assert.equal(events.some((e) => e.type === 'alert'), false); c.endCall('test');
});
test('high scores but API3 level 1: no warning and no alert (API3 alone decides)', () => {
  const c = run([['caller', 'hello']], api3({ intent_risk: 85, manipulation: 80, alert_level: 1 }));
  assert.equal(c.level, 1); assert.equal(events.some((e) => e.type === 'alert'), false); c.endCall('test');
});
test('level follows API3 down again when the receiver refuses; AI outage keeps the last answer', () => {
  const c = run(TALK, api3({ intent_risk: 70, alert_level: 2, confidence: 0.8 })); assert.equal(c.level, 2);
  c.setAI(api3({ alert_level: 0 })); tick(c, 6); assert.equal(c.level, 0);
  c.aiError = 'HTTP 429'; tick(c, 4); assert.equal(c.level, 0); c.endCall('test');
});
test('both streams merge into ONE transcript in spoken order even when STT answers out of order', () => {
  const c = new LiveCall({}, { number: 'x', kind: 'unknown', label: 'Unknown number' }); c.start(); const t = performance.now();
  c.ingest('caller', 'second line from caller', true, true, t + 3000); c.ingest('receiver', 'first line from receiver', true, true, t + 1000);
  assert.deepEqual(c.shown.map((x) => [x.who, x.text]), [['receiver', 'first line from receiver'], ['caller', 'second line from caller']]); c.endCall('test');
});
