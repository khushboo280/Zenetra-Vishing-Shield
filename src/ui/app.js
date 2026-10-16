import E from '../engine/engine.js';
import * as VSLive from '../live/index.js';
import { connectViaRoom } from '../live/connect.js';
import { describeHealth } from '../live/health.js';
import { createPhone } from './phone.js';
import { drawRiskWave, riskWord } from './timeline.js';
import { initFusion } from './fusion.js';
import { downloadTranscript } from './pdf.js';

(function () {
'use strict';
const root = document.documentElement;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); };
const clamp = E.clamp;

/* ---------- icons ---------- */
const PATH = {
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  live: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z"/><path d="M8 7h7M8 11h5"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  play: '<path d="M7 4l13 8-13 8V4z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATH[n]}</svg>`;
$$('[data-i]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.i)); });

/* ---------- preferences & theme ---------- */
const DEF = { mode: 'light', palette: 'mist', motion: true, voice: true, trusted: true, lang: 'auto', speed: 1, th: { watch: 30, warn: 55, intervene: 80 } };
let P = Object.assign({}, DEF, { th: Object.assign({}, DEF.th) });
try { const r = JSON.parse(localStorage.getItem('vs.prefs') || 'null'); if (r) P = Object.assign(P, r, { th: Object.assign({}, DEF.th, r.th || {}) }); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem('vs.prefs', JSON.stringify(P)); } catch (e) {} };
const PALS = [
  { id: 'mist', name: 'Mist', sub: 'Cool teal · default', bg: 'hsl(200 34% 94%)', ac: 'hsl(176 70% 33%)' },
  { id: 'saffron', name: 'Saffron', sub: 'Warm and festive', bg: 'hsl(40 40% 93%)', ac: 'hsl(26 80% 42%)' },
  { id: 'lotus', name: 'Lotus', sub: 'Soft rose', bg: 'hsl(322 30% 94%)', ac: 'hsl(332 65% 45%)' },
  { id: 'ocean', name: 'Ocean', sub: 'Clear blue', bg: 'hsl(218 38% 94%)', ac: 'hsl(216 72% 42%)' },
  { id: 'forest', name: 'Forest', sub: 'Calm green', bg: 'hsl(140 26% 93%)', ac: 'hsl(150 60% 29%)' },
  { id: 'graphite', name: 'Graphite', sub: 'Quiet and neutral', bg: 'hsl(250 6% 92%)', ac: 'hsl(256 42% 42%)' },
];
const colCache = {};
let probe;
function col(name) {
  if (colCache[name]) return colCache[name];
  if (!probe) { probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'; document.body.appendChild(probe); }
  probe.style.color = 'var(--' + name + ')';
  let c = getComputedStyle(probe).color;
  let m = c.match(/-?[\d.]+/g) || [0, 0, 0];
  if (/^color\(/.test(c)) m = m.slice(0, 3).map((v) => Math.round(v * 255));
  colCache[name] = m.slice(0, 3).map(Number);
  return colCache[name];
}
const rgba = (name, a) => { const m = col(name); return `rgba(${m[0]},${m[1]},${m[2]},${a})`; };
const isDark = () => P.mode === 'dark' || (P.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
function modeSeg(el) {
  el.innerHTML = [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'monitor', 'Auto']].map(([m, i, l]) => `<button data-mode="${m}" aria-pressed="false" style="flex:1;justify-content:center">${icon(i)}${l}</button>`).join('');
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
}
function palButtons(el, big) {
  el.innerHTML = PALS.map((p) => big
    ? `<button data-p="${p.id}" aria-pressed="false" style="--p-bg:${p.bg};--p-ac:${p.ac}"><span class="mini"></span><b>${p.name}</b><small>${p.sub}</small></button>`
    : `<button class="pal" data-p="${p.id}" aria-pressed="false" style="--p-bg:${p.bg};--p-ac:${p.ac}"><i></i>${p.name}</button>`).join('');
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPalette(b.dataset.p); });
}
function applyTheme() {
  root.dataset.mode = P.mode; root.dataset.palette = P.palette; root.dataset.motion = P.motion ? 'on' : 'off';
  Object.keys(colCache).forEach((k) => delete colCache[k]);
  $$('[data-mode]').forEach((b) => b.tagName === 'BUTTON' && b.setAttribute('aria-pressed', String(b.dataset.mode === P.mode)));
  $$('[data-p]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === P.palette)));
  const dk = isDark(); const mb = $('#modeBtn'); mb.innerHTML = icon(dk ? 'sun' : 'moon'); mb.setAttribute('aria-pressed', String(dk));
  mb.title = dk ? 'Switch to light mode' : 'Switch to dark mode';
  const sw = (id, v) => $(id).setAttribute('aria-checked', String(v)); sw('#swMotion', P.motion); sw('#swVoice', P.voice); sw('#swTrusted', P.trusted);
  tlDirty = true;
}
function setMode(m) { P.mode = m; savePrefs(); applyTheme(); }
function setPalette(p) { P.palette = p; savePrefs(); applyTheme(); }
modeSeg($('#popMode')); modeSeg($('#setMode')); palButtons($('#popPal'), false); palButtons($('#setPal'), true);
$('#modeBtn').addEventListener('click', () => setMode(isDark() ? 'light' : 'dark'));
const pop = $('#pop'), palBtn = $('#palBtn');
palBtn.addEventListener('click', (e) => { e.stopPropagation(); const o = pop.classList.toggle('open'); palBtn.setAttribute('aria-expanded', String(o)); });
document.addEventListener('click', (e) => { if (!pop.contains(e.target)) { pop.classList.remove('open'); palBtn.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pop.classList.remove('open'); closeOv(); } });

/* ---------- toast ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800); }

/* ---------- views ---------- */
const TITLES = {
  live: ['Live call', 'Real-time scoring · 8 signals fused every 0.25 s'],
  history: ['Call history', 'Outcomes and lead time of past calls'],
  how: ['How it works', 'Calling, AI scoring and non-blocking alerts'],
  settings: ['Settings', 'Theme, thresholds and voice'],
};
let view = 'live';
function showView(v, quiet) {
  view = v;
  $$('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + v));
  $$('#nav button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.view === v) || (b.dataset.view !== v && b.removeAttribute('aria-current')));
  $$('#nav button').forEach((b) => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); });
  $('#vt').innerHTML = esc(TITLES[v][0]) + '<small>' + esc(TITLES[v][1]) + '</small>';
  $$('#v-' + v + ' .panel, #v-' + v + ' .stat').forEach((p, i) => { p.classList.remove('rise'); void p.offsetWidth; p.style.setProperty('--i', i); p.classList.add('rise'); });
  if (v === 'history') renderHistory();
  if (!quiet) { try { history.replaceState(null, '', '#' + v); } catch (e) {} }
  tlDirty = true; window.scrollTo({ top: 0 });
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showView(b.dataset.view); });

/* ---------- scoreboard definitions ---------- */
const CARDS = [
  { k: 'I', n: 'Intent risk', sub: (v) => v < 15 ? 'No sensitive ask yet' : v < 45 ? 'Authority or threat cues' : v < 70 ? 'Money or action requested' : 'OTP / PIN / app requested' },
  { k: 'M', n: 'Manipulation', sub: (v) => v < 15 ? 'Calm, natural pace' : v < 45 ? 'Urgency building' : v < 70 ? 'Fear and secrecy tactics' : 'Coercive script detected' },
  { k: 'S', n: 'Sentiment risk', sub: (v) => v < 15 ? 'Warm or neutral tone' : v < 45 ? 'Tension rising' : v < 70 ? 'Receiver is anxious' : 'Fear-driven exchange' },
  { k: 'H', n: 'Hesitation', sub: (v) => v < 15 ? 'Fluent, spontaneous' : v < 45 ? 'Some filler words' : v < 70 ? 'Long pauses, reading cues' : 'Scripted, reading aloud' },
  { k: 'D', n: 'Voice deepfake', sub: (v) => v < 20 ? 'Natural voice' : v < 50 ? 'Slight artefacts' : v < 75 ? 'Synthetic traits' : 'Likely cloned voice' },
  { k: 'Fam', n: 'Family bond', inv: true, sub: (v) => v < 15 ? 'No personal cues' : v < 40 ? 'Some familiar cues' : v < 65 ? 'Shared memories heard' : 'Strong relationship signals' },
  { k: 'C', n: 'Caller number', sub: (v) => v < 10 ? 'Saved contact' : v < 30 ? 'Business number' : v < 60 ? 'Unknown number' : 'International or spoofed' },
  { k: 'R', n: 'Receiver compliance', sub: (v) => v < 15 ? 'Not complying' : v < 45 ? 'Hesitating' : 'Receiver is complying' },
];
const sb = $('#sb');
sb.innerHTML = CARDS.map((c) => `<div class="sc info" data-k="${c.k}"><div class="sc-h"><span>${c.n}</span><span class="sc-dot"></span></div><div class="sc-v"><b class="num">0</b><small>/100</small></div><div class="sc-bar"><i></i></div><svg class="sc-spark" viewBox="0 0 100 26" preserveAspectRatio="none"><polyline points=""/></svg><div class="sc-s">—</div></div>`).join('');
const cardEls = {};
CARDS.forEach((c) => { const el = $(`.sc[data-k="${c.k}"]`, sb); cardEls[c.k] = { def: c, el, v: $('b', el), bar: $('.sc-bar i', el), dot: $('.sc-dot', el), poly: $('polyline', el), sub: $('.sc-s', el), cls: '' }; });


const LV_COL = ['good', 'info', 'warn', 'crit'], LV_NAME = ['Safe', 'Watch', 'Warn', 'Intervene'];
$('#ladder').innerHTML = LV_NAME.map((n, i) => `<div style="--lc:var(--${LV_COL[i]})">${n}</div>`).join('');
const ladEls = $$('#ladder div');
const STG = [['authority', 'Authority'], ['pressure', 'Pressure'], ['secrecy', 'Secrecy'], ['demand', 'Demand']];
$('#stages').innerHTML = STG.map(([k, n], i) => `${i ? '<span class="stage-line"></span>' : ''}<div class="stage" data-k="${k}"><i>${icon('check')}</i>${n}</div>`).join('');
const stgEls = {}; $$('#stages .stage').forEach((s) => { stgEls[s.dataset.k] = s; });

/* weights list */
$('#wRule').innerHTML = [['bias', E.W.b], ['intent', E.W.I], ['manipulation', E.W.M], ['sentiment', E.W.S], ['hesitation', E.W.H], ['deepfake', E.W.D], ['caller no.', E.W.C], ['compliance', E.W.R], ['scam stages', E.W.St], ['family', -E.W.Fam]].map(([n, w]) => `<b>${n}</b><span>${w > 0 ? '+' : '−'}${Math.abs(w).toFixed(3)}</span>`).join('');

/* ---------- state ---------- */
let conn = null, waiting = false, sim = null, running = false, lastTs = 0, nowTs = 0, tlDirty = true, tlHover = null, done = false;
let disp = {}, msgEls = [], evKey = '', logN = 0, cost = 0.4, startedAt = new Date(), lastAI = null, whisperT = null;
const wbuf = { caller: new Array(72).fill(0.02), receiver: new Array(72).fill(0.02) };
let scn = { name: 'Live call', caller: { number: 'Waiting for call…', kind: 'unknown', label: 'Unknown number' }, blurb: 'Live WebRTC call. Everything on this page comes from the real conversation.' };
function cfg() { return { th: Object.assign({}, P.th), trusted: P.trusted, langOverride: P.lang }; }
const fusion = initFusion($('#fus'));
const sttPref = () => { try { return localStorage.getItem('vs.sttLang') || 'en-IN'; } catch (e) { return 'en-IN'; } };

/* ---------- the receiver's phone ---------- */
let phone = null;
function buildPhone() {
  if (phone) phone.destroy();
  phone = createPhone($('#phoneHost'), {
    role: 'receiver', name: 'No call yet', number: 'Press “Connect call”',
    onEnd: endByUser,
    onMute: (m) => VSLive.setMuted(m),
    onSpeaker: (on) => VSLive.setSpeaker(on),
  });
  phone.setStatus('idle'); phone.setState('idle');
}

/* ---------- LIVE wiring: the live modules push into these ---------- */
VSLive.bind({
  wbuf,
  getCfg: cfg,
  onEvents: (ev) => onEvents(ev),
  syncTranscript: () => syncTranscript(),
  notify: (m, l) => { log(esc(m), l || 0); if (l === 2) toast(m); },
  onAIStatus: (ok, msg) => setAIChip(ok ? 'ok' : 'bad', msg),
  onSTTStatus: (ok, msg, eng) => { const c = $('#sttChip'); c.textContent = ok ? 'Speech: ' + (eng === 'server' ? (window.__sttShort || 'AI') : eng || 'live') : 'Speech: error'; c.className = 'chip ' + (ok ? 'good' : 'crit'); c.title = msg || ''; if (!ok && msg) log('⚠ ' + esc(msg), 2); },
  onStart: (call) => {
    waiting = false; scn.caller = call.caller; resetUI(call); running = true; startedAt = new Date();
    phone.setName(call.caller.label || 'Unknown caller'); phone.setNumber(call.caller.number); phone.setState('live'); phone.setGuard('good', 'Vishing Shield is listening');
    $('#conn').hidden = true; statusUI(); toast('Call connected');
  },
});
/* live health strip: tells you WHICH link of the chain is broken (audio, speech-to-text, AI) */
const dg = (cls, t, tip) => `<span class="chip ${cls}" title="${esc(tip || '')}">${t}</span>`;
let lastDiag = 0;
function updateDiag(ts) {
  if (ts - lastDiag < 500) return; lastDiag = ts;
  const box = $('#diag'); if (!running || !sim) { box.innerHTML = ''; return; }
  const peak = (b) => Math.max(...b.slice(-24)), st = VSLive.state, ctxs = st.ctx ? st.ctx.state : 'none';
  const cA = peak(wbuf.caller) > 0.06, rA = peak(wbuf.receiver) > 0.06, f = (st.stats && st.stats.fails) || 0;
  box.innerHTML = [
    ctxs !== 'running' ? dg('crit', 'Audio engine ' + ctxs + ': click anywhere on the page', 'The browser has paused audio processing. Click the page once.') : '',
    ...(st.health ? (() => { const d = describeHealth(st.health, { who: 'caller' }); return [dg(d.hear.cls, d.hear.t, d.hear.tip), dg(d.send.cls, d.send.t, d.send.tip), d.net ? dg('', 'Path: ' + d.net, 'How the two devices are connected') : '']; })() : []),
    dg(cA ? 'good' : '', cA ? 'Caller audio ✓' : 'Caller audio: silent', 'Level of the caller\u2019s voice arriving over WebRTC'),
    dg(rA ? 'good' : '', rA ? 'Your mic ✓' : 'Your mic: silent', 'Level of your microphone'),
    ...(st.stats && st.stats.lat ? (() => { const v = Object.values(st.stats.lat).map((x) => x.lat).filter(Number.isFinite); if (!v.length) return []; const m = Math.max(...v) / 1000; return [dg(m < 2.5 ? 'good' : m < 4.5 ? 'warn' : 'crit', `Speech delay ~${m.toFixed(1)} s`, 'Time from the end of a sentence until its text appears. Slow? Use Groq Whisper or Deepgram for API1 / API2 (STT_API1 / STT_API2 in .env).')]; })() : []),
    dg(sim.ingestN ? 'good' : (f ? 'crit' : 'warn'), `Speech→text: ${sim.ingestN} phrases${f ? ' · ' + f + ' errors' : ''}`, (st.stats && st.stats.lastErr) || ''),
    dg(sim.ai ? (sim.aiError ? 'warn' : 'good') : '', sim.ai ? (sim.aiError ? 'AI observer: last answer kept (' + sim.aiError + ')' : 'AI observer ✓') : sim.aiError ? 'AI observer unreachable' : 'AI observer: waiting for words', sim.aiError || ''),
  ].join('');
}
function setAIChip(st, msg) {
  const c = $('#aiChip');
  const T = { wait: ['AI: waiting', ''], ok: ['AI: live', 'good'], bad: ['AI: unavailable', 'crit'], nokey: ['AI: key missing', 'warn'] }[st];
  c.textContent = st === 'bad' && msg ? 'AI: ' + String(msg).replace(/^HTTP /, '').slice(0, 46) : T[0]; c.className = 'chip ' + T[1]; c.title = msg || 'AI is the scoring engine';
}
function resetUI(call) {
  closeOv(); stopSpeech();
  sim = call || new VSLive.LiveCall(cfg(), scn.caller);
  sim.cfg.th = Object.assign({}, P.th);
  running = false; done = false; msgEls = []; evKey = ''; logN = 0; lastAI = null;
  disp = { I: 0, M: 0, S: 0, H: 0, D: 0, Fam: 0, C: sim.sc.C, R: 0, F: 0 };
  $('#msgs').innerHTML = '<div class="msg empty">Waiting for the live call… only real spoken words appear here.</div>';
  $('#ev').className = 'ev empty'; $('#ev').textContent = 'When AI notices something worrying, the exact words appear here with the reason.';
  $('#evCount').textContent = '0 cues'; $('#log').innerHTML = ''; $('#whisper').classList.remove('on');
  $('#tlChip').textContent = 'Safe'; $('#tlChip').className = 'chip good';
  $('#bPdf').disabled = true; fusion.reset(); Object.values(stgEls).forEach((s) => s.classList.remove('on'));
  wbuf.caller.fill(0.02); wbuf.receiver.fill(0.02);
  $('#cNum').textContent = scn.caller.number;
  $('#cMeta').innerHTML = `<span>${esc(scn.blurb)}</span>`;
  CARDS.forEach((c) => { cardEls[c.k].poly.setAttribute('points', ''); });
  zones(); statusUI(); log('Waiting for a live call…', 0); tlDirty = true;
}
function statusUI() {
  const lt = $('#liveTag'), sp = $('span', lt); const st = sim && sim.ended ? 'ended' : running ? 'live' : 'ready';
  lt.className = 'livetag' + (st === 'live' ? '' : ' off'); sp.textContent = { live: 'LIVE', ended: 'ENDED', ready: waiting ? 'WAITING' : 'READY' }[st];
  $('#avatar').classList.toggle('live', st === 'live');
  const bs = $('#bStart');
  bs.disabled = st === 'live' || (waiting && st === 'ready');
  if (st === 'ended') bs.innerHTML = icon('restart') + 'New call';
  else if (st === 'live') bs.innerHTML = icon('phone') + 'In call';
  else if (waiting) bs.innerHTML = icon('phone') + 'Waiting for caller…';
  else bs.innerHTML = icon('phone') + 'Connect call';
  $('#phoneChip').textContent = st === 'live' ? 'in call' : st === 'ended' ? 'ended' : waiting ? 'ringing' : 'receiver';
}
$('#bStart').addEventListener('click', () => {
  unlockSpeech();
  if (sim.ended) { buildPhone(); resetUI(); return; }
  if (!waiting) openRoom();
});

/* Receiver opens a room; the caller opens the link on ANY device on the internet (src/live/connect.js). */
async function openRoom() {
  waiting = true; statusUI(); phone.setState('ringing'); phone.setStatus('waiting for caller…');
  setAIChip('wait');
  try {
    conn = await connectViaRoom({
      onRoom: (room, url, c) => {
        const local = /^(localhost|127\.|\[?::1)/.test(new URL(url).hostname);
        $('#conn').hidden = false; $('#roomCode').textContent = room; $('#roomLink').value = url; $('#roomQr').src = '/api/qr?text=' + encodeURIComponent(url);
        $('#cNum').textContent = 'Room ' + room; $('#cMeta').innerHTML = '<span>Share the link below. The call connects as soon as the caller opens it.</span>';
        setAIChip(c.ai ? 'wait' : 'nokey', c.ai ? '' : 'API3 key missing: run npm run setup');
        window.__sttShort = c.sttShort; $('#sttChip').textContent = 'Speech: ' + ({ server: (c.sttShort || 'AI'), webspeech: 'browser' }[c.stt] || c.stt); const nc = $('#netChip'); nc.textContent = 'Network: ' + (c.turn ? 'STUN + TURN' : 'STUN only'); nc.className = 'chip ' + (c.turn ? 'good' : 'warn');
        nc.title = c.turn ? 'Works through strict firewalls (TURN relay available)' : 'Works on most networks. Add a TURN server for strict corporate / mobile networks.';
        if (local) { toast('This link only works on THIS computer. Open the site via your network address (https://192.168.x.x:5173) or set PUBLIC_URL.'); log('⚠ The caller link points to localhost: a phone cannot open it. Open this dashboard via your network IP or deploy it.', 2); }
        fetch('/api/diag', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
          const bad = [['api1', 'API1 (your mic)'], ['api2', 'API2 (caller audio)'], ['api3', 'API3 (AI observer)']].filter(([k]) => d[k] && !d[k].ok);
          bad.forEach(([k, n]) => { log('⚠ ' + n + ' ' + esc(d[k].label) + ': ' + esc(d[k].error), 2); });
          if (d.api3 && !d.api3.ok) { setAIChip('bad', d.api3.error); toast('AI observer problem: ' + d.api3.error); } else setAIChip('ok');
          if ((d.api1 && !d.api1.ok) || (d.api2 && !d.api2.ok)) toast('Speech-to-text problem: ' + ((d.api1 && !d.api1.ok ? d.api1 : d.api2).error));
        }).catch(() => {});
        log('Room ' + room + ' open. Caller link: ' + esc(url), 0);
      },
      onStatus: (st, msg) => {
        if (st === 'error') { waiting = false; statusUI(); toast(msg || 'Connection error'); }
        else if (st === 'peer-left' && sim && !sim.ended && running) { sim.endCall('caller-hung-up'); VSLive.stopLiveCall(); handleEnd(); }
        else if (st === 'connected') netPath();
        else if (st === 'note') toast(msg);
      },
    });
  } catch (e) { waiting = false; phone.setState('idle'); statusUI(); toast(e.name === 'NotAllowedError' ? 'Microphone permission is needed.' : (e.message || 'Could not open the room')); }
}
async function netPath() {
  try {
    const st = await conn.pc.getStats(); let pair = null, id = null;
    st.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) id = r.selectedCandidatePairId; });
    st.forEach((r) => { if (r.id === id || (!id && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded')) pair = r; });
    const lc = pair && st.get(pair.localCandidateId), t = lc && lc.candidateType;
    if (t) { const nc = $('#netChip'); nc.textContent = 'Network: ' + ({ host: 'same network', srflx: 'direct (STUN)', prflx: 'direct', relay: 'relayed (TURN)' }[t] || t); nc.className = 'chip good'; }
  } catch (e) {}
}
$('#copyLink').addEventListener('click', () => copyText($('#roomLink').value, 'Link copied'));

/* Ending is ONLY ever the user's choice (or the other person hanging up). Alerts never end a call. */
function endByUser() {
  if (!sim || sim.ended) return;
  if (!running) { if (conn) { conn.close(); conn = null; } waiting = false; $('#conn').hidden = true; phone.setState('idle'); statusUI(); return; }
  sim.endCall('receiver-ended'); VSLive.stopLiveCall(false, true); handleEnd();
}

/* ---------- upload-voice test (backup demo without a second phone): ONE recording of the whole call ---------- */
let testBusy = false;
function testUI() {
  const idle = !running && !waiting && !testBusy;
  $('#bTest').disabled = !(idle && $('#fCall').files && $('#fCall').files.length);
  $('#fCall').disabled = $('#fKind').disabled = $('#fFirst').disabled = !idle;
}
$('#fCall').addEventListener('change', testUI);
$('#bTest').addEventListener('click', async () => {
  unlockSpeech();
  if (sim.ended) { buildPhone(); resetUI(); }
  const msg = $('#testMsg'); testBusy = true; testUI();
  try {
    const r = await VSLive.startFileTest({ file: $('#fCall').files[0], kind: $('#fKind').value, firstIs: $('#fFirst').value, sttLang: sttPref(), onStage: (t) => { msg.textContent = t; }, onEnded: () => { msg.textContent = 'The recording has finished. Press End on the phone when you are done.'; } });
    msg.textContent = `Playing your recording (${Math.round(r.seconds)} s, ${r.turns} turns). Watch the transcript, the fraud confidence and the voice alert.`;
  } catch (e) { msg.textContent = e.message; log(esc(e.message), 2); toast(e.message); running = false; statusUI(); }
  testBusy = false; testUI();
});
setInterval(testUI, 800);

/* ---------- log ---------- */
function log(msg, lvl) {
  const L = $('#log'); const d = document.createElement('div'); d.className = lvl ? 'l' + lvl : '';
  d.innerHTML = msg; const near = L.scrollHeight - L.scrollTop - L.clientHeight < 40; L.appendChild(d);
  while (L.children.length > 140) L.removeChild(L.firstChild);
  if (near) L.scrollTop = L.scrollHeight;
}

/* ---------- speech (the receiver hears the warning in their language) ---------- */
let speakTok = 0;
function stopSpeech() { speakTok++; try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {} }
function unlockSpeech() { try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {} }
function speak(text, lang, doneCb, vol) {
  const tok = ++speakTok; let fin = false;
  const est = Math.max(2400, text.length * (lang === 'hi' ? 70 : 58));
  const end = () => { if (fin) return; fin = true; clearTimeout(tm); if (tok === speakTok && doneCb) doneCb(); };
  const tm = setTimeout(end, est + 3000);
  if (!P.voice || !('speechSynthesis' in window)) { clearTimeout(tm); setTimeout(end, est * 0.8); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'; u.rate = 0.95; u.volume = vol == null ? 1 : vol;
    const vs = speechSynthesis.getVoices(); const pre = lang === 'hi' ? 'hi' : 'en';
    const v = vs.find((x) => x.lang && x.lang.replace('_', '-').toLowerCase().startsWith(u.lang.toLowerCase())) || vs.find((x) => x.lang && x.lang.toLowerCase().startsWith(pre));
    if (v) u.voice = v;
    u.onend = end; u.onerror = end; speechSynthesis.speak(u);
  } catch (e) { clearTimeout(tm); setTimeout(end, est * 0.8); }
}

/* ---------- transcript (real words only) + AI's evidence ---------- */
const LANGL = { hi: 'हिंदी', hn: 'Hinglish', en: 'English' };
const evTone = (c) => /otp|pin|passw|credential|remote|install|card|bank|payment|money|transfer|sensitive/i.test(c) ? 'crit' : /urgen|pressure|threat|secre|fear|authority|impersonat|arrest|legal/i.test(c) ? 'warn' : /family|friend|know|personal|familiar/i.test(c) ? 'good' : 'info';
function quotes() { return sim && sim.ai && !sim.familiar ? sim.ai.evidence : []; }
function renderMsg(t) {
  const txt = t.text, segs = []; const low = txt.toLowerCase();
  if (t.who === 'caller') for (const q of quotes()) {
    const k = q.quote.toLowerCase(), i = low.indexOf(k); if (i >= 0) segs.push({ s: i, e: i + k.length, c: evTone(q.category), why: q.why });
  }
  segs.sort((a, b) => a.s - b.s); let out = '', p = 0;
  for (const g of segs) { if (g.s < p) continue; out += esc(txt.slice(p, g.s)) + `<mark class="${g.c}" title="${esc(g.why || '')}">${esc(txt.slice(g.s, g.e))}</mark>`; p = g.e; }
  out += esc(txt.slice(p));
  const lang = txt.trim() ? LANGL[E.langOf(txt)] : '';
  return `<span class="lg">${lang}</span><b class="wl">${t.who === 'caller' ? 'Caller' : 'Receiver'}</b>${out}${t.partial ? '<span class="caret"></span>' : ''}`;
}
function renderEvidence() {
  const ai = sim.ai; const ev = ai ? ai.evidence : []; const key = ai ? JSON.stringify([ev, sim.familiar]) : '';
  if (key === evKey) return; evKey = key; msgEls.forEach((m) => { m._k = null; });
  const box = $('#ev');
  if (!ai) return;
  if (sim.familiar) {
    box.className = 'ev'; box.innerHTML = `<div class="ev-i"><span class="chip good">Known caller</span><div><q>${esc(ai.summary || 'You both clearly know each other.')}</q><small>Private talk between people who know each other is never flagged, even about money or passwords.</small></div></div>`;
    $('#evCount').textContent = 'no alert'; return;
  }
  if (!ev.length) { box.className = 'ev empty'; box.textContent = ai.summary || 'Nothing suspicious so far.'; $('#evCount').textContent = '0 cues'; return; }
  box.className = 'ev';
  box.innerHTML = ev.map((e) => `<div class="ev-i"><span class="chip ${evTone(e.category)}">${esc(e.category || 'cue')}</span><div><q>${esc(e.quote)}</q><small>${esc(e.why)}</small></div></div>`).join('');
  $('#evCount').textContent = ev.length + (ev.length === 1 ? ' cue' : ' cues');
}
function syncTranscript() {
  const sh = sim.shown.filter((t) => t.text), box = $('#msgs');
  for (let i = 0; i < sh.length; i++) {
    const t = sh[i]; let m = msgEls[i];
    if (!m) { const em = $('.empty', box); if (em) em.remove(); m = document.createElement('div'); m.className = 'msg ' + t.who; m.style.setProperty('--lane-c', t.who === 'caller' ? 'var(--info)' : 'var(--good)'); box.appendChild(m); msgEls[i] = m; }
    const key = t.text + '|' + t.partial;
    if (m._k !== key) { m._k = key; m.innerHTML = renderMsg(t); box.scrollTop = box.scrollHeight; }
  }
  $('#bPdf').disabled = !sh.length;
}
$('#bPdf').addEventListener('click', async () => {
  if (!sim) return; const b = $('#bPdf'); const html = b.innerHTML;
  await downloadTranscript({
    turns: sim.shown, report: sim.report(), caller: sim.caller, startedAt, alerts: sim.alerts, summary: sim.ai ? sim.ai.summary : '',
    onState: (s, m) => { b.disabled = s === 'busy'; b.innerHTML = s === 'busy' ? 'Preparing PDF…' : html; if (s === 'error') toast('Could not make the PDF: ' + m); if (s === 'done') toast('Transcript downloaded'); },
  });
});

/* ---------- gauge zones ---------- */
function zones() {
  const th = sim ? sim.cfg.th : P.th; const g = $('#gZones');
  const seg = [[0, th.watch, 'good'], [th.watch, th.warn, 'info'], [th.warn, th.intervene, 'warn'], [th.intervene, 100, 'crit']];
  g.innerHTML = seg.map(([a, b, c]) => `<path d="M16 160A134 134 0 0 1 284 160" fill="none" stroke="var(--${c})" stroke-width="4" pathLength="100" stroke-dasharray="${(b - a - 0.6).toFixed(2)} 100" stroke-dashoffset="${(-a).toFixed(2)}" opacity=".55"/>`).join('');
}

/* ---------- per-frame render ---------- */
const PILL = [['SAFE', 'good'], ['WATCHING', 'info'], ['WARNING', 'warn'], ['ALERT', 'crit']];
const GUARD = [['good', 'Vishing Shield · call looks safe'], ['info', 'Vishing Shield · keeping an eye'], ['warn', 'Be careful · something sounds off'], ['crit', 'Possible scam · do not share codes']];
let lastLevel = -1;
function riskCls(v, inv) { if (inv) return v >= 50 ? 'good' : 'info'; return v >= 70 ? 'crit' : v >= 45 ? 'warn' : v >= 20 ? 'info' : 'good'; }
function render(dt) {
  if (!sim) return;
  $('#timer').textContent = fmtT(sim.t); if (running && phone) phone.setTimer(sim.t);
  const k = 1 - Math.exp(-dt * 9);
  const tg = Object.assign({}, sim.sc, { F: sim.F });
  for (const key in tg) disp[key] += (tg[key] - disp[key]) * k;
  const th = sim.cfg.th, F = disp.F, lvlCol = F >= th.intervene ? 'crit' : F >= th.warn ? 'warn' : F >= th.watch ? 'info' : 'good';
  const gv = $('#gVal'); gv.setAttribute('stroke-dasharray', `${F.toFixed(2)} 100`); gv.style.opacity = F < 0.4 ? 0 : 1;
  const ang = Math.PI * (1 - F / 100), kx = 150 + 120 * Math.cos(ang), ky = 160 - 120 * Math.sin(ang);
  for (const id of ['#gKnob', '#gHalo']) { const e = $(id); e.setAttribute('cx', kx.toFixed(1)); e.setAttribute('cy', ky.toFixed(1)); }
  $('#gauge').style.setProperty('--gc', `var(--${lvlCol})`);
  $('#gNum').textContent = Math.round(F);
  const lv = sim.level; if (lv !== lastLevel) {
    lastLevel = lv; const pl = $('#pill'); pl.textContent = PILL[lv][0];
    pl.style.setProperty('--sp-bg', `var(--${PILL[lv][1]}-soft)`); pl.style.setProperty('--sp-c', `var(--${PILL[lv][1]})`);
    ladEls.forEach((d, i) => { d.classList.toggle('on', i === lv); d.classList.toggle('past', i < lv); });
    if (running && phone) phone.setGuard(sim.familiar ? 'good' : GUARD[lv][0], sim.familiar ? 'Known caller · no alert' : GUARD[lv][1]);
  }
  for (const c of CARDS) {
    const ce = cardEls[c.k], v = disp[c.k], cls = riskCls(v, c.inv);
    ce.v.textContent = Math.round(v); ce.bar.style.width = v.toFixed(1) + '%';
    const want = 'sc ' + cls + (((!c.inv && v >= 45) || (c.inv && v >= 50)) ? ' hot' : '');
    if (ce.cls !== want) { ce.cls = want; ce.el.className = want; }
    const s = c.sub(sim.sc[c.k]); if (ce.sub.textContent !== s) ce.sub.textContent = s;
  }
  $('#laneC').classList.toggle('speaking', sim.speaker === 'caller'); $('#laneR').classList.toggle('speaking', sim.speaker === 'receiver');
  $('#rState').textContent = sim.speaker === 'receiver' ? 'Speaking' : 'Listening'; $('#rState').className = 'chip' + (sim.speaker === 'receiver' ? ' good' : '');
  const d = Math.round(disp.D); const cs = $('#cSpoof'); cs.textContent = 'Synthetic voice ' + d + '%'; cs.className = 'chip' + (d >= 60 ? ' crit' : d >= 30 ? ' warn' : '');
  drawWave($('#wC'), wbuf.caller, disp.D > 50 ? 'crit' : 'info'); drawWave($('#wR'), wbuf.receiver, 'good');
  const lg = sim.lang(); const lt = 'Alert language · ' + (lg === 'hi' ? 'हिंदी' : 'English'); if ($('#langChip').textContent !== lt) $('#langChip').textContent = lt;
  syncTranscript();
  if (view === 'live') drawTL();
  updateDiag(nowTs);
}
function drawWave(c, buf, color) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight; if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const n = buf.length, bw = w / n; g.fillStyle = rgba(color, 1);
  for (let i = 0; i < n; i++) {
    const a = buf[i], bh = Math.max(2.5, a * h * 0.95); g.globalAlpha = 0.25 + 0.75 * (i / n);
    const x = i * bw + bw * 0.18, y = (h - bh) / 2, ww = bw * 0.64;
    if (g.roundRect) { g.beginPath(); g.roundRect(x, y, ww, bh, ww / 2); g.fill(); } else g.fillRect(x, y, ww, bh);
  }
  g.globalAlpha = 1;
}
function drawTL() {
  const c = $('#tl'); const F = sim.F, th = sim.cfg.th;
  drawRiskWave(c, { hist: sim.hist, alerts: sim.alerts, th, t: sim.t, hoverX: tlHover, col: rgba, ts: nowTs, running });
  const word = riskWord(F, th), tone = F >= th.intervene ? 'crit' : F >= th.watch ? 'warn' : 'good';
  const want = sim.hist.length ? word : 'Safe'; if ($('#tlChip').textContent !== want) { $('#tlChip').textContent = want; $('#tlChip').className = 'chip ' + tone; }
}
{ const tl = $('#tl');
  tl.addEventListener('pointermove', (e) => { tlHover = e.clientX - tl.getBoundingClientRect().left; });
  tl.addEventListener('pointerleave', () => { tlHover = null; }); tl.addEventListener('pointercancel', () => { tlHover = null; }); }

/* ---------- events ---------- */
const REASON = { api3: 'The AI observer judged this a scam attempt', 're-alert': 'The scam is still going on' };
const RAW = () => { const s = sim.sc, f = sim.feat || {}; return { Intent: s.I, Manipulation: s.M, Sentiment: s.S, Hesitation: s.H, Deepfake: s.D, 'Caller number': s.C, Compliance: s.R, 'Scam stages': f.stageCount || 0, Family: s.Fam }; };
function onEvents(ev) {
  for (const e of ev) {
    if (e.type === 'tick') {
      const s = e.sample, n = sim.tickN; if (sim.cost) cost += (sim.cost - cost) * 0.2;
      if (!e.immediate && n % 4 === 0) for (const c of CARDS) {
        const ce = cardEls[c.k]; const pts = sim.hist.slice(-48).map((q, i) => `${(i / 47 * 100).toFixed(1)},${(24 - clamp(q[c.k]) / 100 * 22).toFixed(1)}`);
        ce.poly.setAttribute('points', pts.join(' ')); ce.dot.classList.remove('tick'); void ce.dot.offsetWidth; ce.dot.classList.add('tick');
      }
      if (sim.fusion && (e.immediate || n % 2 === 0)) {
        fusion.update(sim.fusion, RAW(), sim.ai, s.F);
        $('#fusChip').textContent = `risk ${s.F.toFixed(0)}% · ${sim.familiar ? 'known caller' : 'unknown caller'}`;
      }
      if (sim.ai !== lastAI) { lastAI = sim.ai; renderEvidence(); }
      const f = sim.feat; if (f) STG.forEach(([kk]) => stgEls[kk].classList.toggle('on', !!f.stages[kk]));
      const words = sim.shown.reduce((a, t) => a + (t.text ? t.text.split(/\s+/).length : 0), 0);
      $('#engine').innerHTML = `<span>tick <b>#${n}</b></span><span>window <b>0.25 s</b></span><span>compute <b>${cost.toFixed(2)} ms</b></span><span>words <b>${words}</b></span><span>scoring <b>AI</b></span>`;
      if (!e.immediate && n % 8 === 0 && sim.shown.length) log(`<em>[${fmtT(s.t)}]</em> risk=<b>${s.F.toFixed(1)}</b> intent ${s.I.toFixed(0)} · pressure ${s.M.toFixed(0)} · know-each-other ${s.Fam.toFixed(0)}`);
    } else if (e.type === 'level') {
      log(`<em>[${fmtT(e.t)}]</em> ► ${E.LEVELS[e.from]} → <b>${E.LEVELS[e.to]}</b> · ${esc(REASON[e.reason] || e.reason)} (${e.F.toFixed(0)}%)`, Math.max(1, e.to));
      if (e.to === 2 && e.from < 2) { const A = E.ALERTS[sim.lang()]; phone.alert({ title: 'Be careful', text: A.whisper, level: 'warn', ms: 9000 }); }
    } else if (e.type === 'alert') onAlert(e);
    else if (e.type === 'end') handleEnd();
  }
}

/* ---------- alert: warn both sides, keep the call going ---------- */
function onAlert(e) {
  const lang = sim.lang(), A = E.ALERTS[lang];
  log(`<em>[${fmtT(e.t)}]</em> ⚠ alert · ${esc(e.why || REASON[e.reason] || e.reason)}`, 2);
  phone.alert({ title: 'Possible scam call', text: e.why || A.whisper, level: 'crit', ms: 16000 });
  $('#whisperTxt').textContent = 'Voice warning for both sides · the call is still connected. Only you can end it.'; $('#whisper').classList.add('on');
  clearTimeout(whisperT); whisperT = setTimeout(() => $('#whisper').classList.remove('on'), 14000);
  toast('Voice warning on its way to both sides. The call continues.');
  if (conn) conn.sendAlert({ lang, reason: e.why || '', t: e.t });
  if (VSLive.state.alertBusy) return;
  const spoken = VSLive.playReceiverWarning(lang).then((ok) => (ok ? null : new Promise((res) => speak(A.receiver, lang, res))));   // receiver: the same AI voice as the caller; the browser's own voice only if there is no TTS provider
  VSLive.alertCaller(lang, spoken).catch(() => {});                             // caller hears the voice warning, then the call resumes
}

/* ---------- overlay + end report ---------- */
function closeOv() { $('#ov').classList.remove('on'); $('#ov').innerHTML = ''; }
$('#ov').addEventListener('click', (e) => { if (e.target.id === 'ov') closeOv(); });
function handleEnd() {
  if (done) return; done = true; running = false; VSLive.stopLiveCall(); VSLive.stopFileTest(); if (conn) { conn.close(); conn = null; }
  clearTimeout(whisperT); $('#whisper').classList.remove('on'); stopSpeech();
  phone.setState('ended'); statusUI();
  const r = sim.report(); log(`<em>[${fmtT(sim.t)}]</em> call ended (${esc(r.endedBy)}) · ${esc(r.verdict)}`, r.peakLevel >= 2 ? 2 : 0);
  if (sim.shown.some((t) => t.text)) saveHistory(r);
  setTimeout(() => { if (sim && sim.ended) showReport(r); }, 500);
}
function reportText(r) {
  return ['Vishing Shield · call report', `Caller: ${sim.caller.number}`, `Verdict: ${r.verdict}`, `Peak risk: ${r.peakF.toFixed(0)}%`, `Alerts shown: ${r.alerts}`, `Duration: ${fmtT(r.duration)}`, sim.ai ? `AI: ${sim.ai.summary}` : ''].filter(Boolean).join('\n');
}
function showReport(r) {
  const tone = r.peakLevel >= 3 ? 'crit' : r.peakLevel === 2 ? 'warn' : r.peakLevel === 1 ? 'info' : 'good';
  const note = sim.ai && sim.ai.summary ? sim.ai.summary : 'No conversation was analysed.';
  $('#ov').innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Call report">
    <div class="hold-h"><div class="rings" style="--x:0"><b style="background:var(--${tone})">${icon(r.peakLevel >= 2 ? 'alert' : 'check')}</b></div><div><h2>${esc(r.verdict)}</h2><p>${esc(sim.caller.number)}</p></div></div>
    <div class="rep-grid">
      <div><small>Peak risk</small><b>${r.peakF.toFixed(0)}%</b></div>
      <div><small>Alerts shown</small><b>${r.alerts}</b></div>
      <div><small>First alert at</small><b>${r.alertT == null ? '—' : fmtT(r.alertT)}</b></div>
      <div><small>Duration</small><b>${fmtT(r.duration)}</b></div>
      <div><small>Ended by</small><b>${esc(String(r.endedBy).replace(/-/g, ' '))}</b></div>
      <div><small>Language</small><b>${esc(r.lang === 'hi' ? 'Hindi / Hinglish' : 'English')}</b></div>
    </div>
    <p class="rep-note">${esc(note)}</p>
    <div class="acts"><button class="btn sm" id="rPdf">${icon('download')} Download transcript</button><button class="btn sm" id="rCopy">${icon('copy')} Copy report</button><button class="btn" id="rHist">${icon('history')} History</button><button class="btn pri" id="rAgain">${icon('restart')} New call</button></div></div>`;
  $('#ov').classList.add('on');
  $('#rPdf').addEventListener('click', () => $('#bPdf').click());
  $('#rCopy').addEventListener('click', () => copyText(reportText(r)));
  $('#rHist').addEventListener('click', () => { closeOv(); showView('history'); });
  $('#rAgain').addEventListener('click', () => { closeOv(); buildPhone(); resetUI(); });
}
function copyText(t, msg) {
  const fb = () => { try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); toast(ok ? (msg || 'Copied') : 'Copy failed'); } catch (e) { toast('Copy failed'); } };
  try { navigator.clipboard.writeText(t).then(() => toast(msg || 'Copied'), fb); } catch (e) { fb(); }
}

/* ---------- history ---------- */
function getHist() { try { return JSON.parse(localStorage.getItem('vs.hist') || '[]'); } catch (e) { return []; } }
function setHist(a) { try { localStorage.setItem('vs.hist', JSON.stringify(a.slice(0, 60))); } catch (e) {} }
function saveHistory(r) {
  const a = getHist(); a.unshift({ name: 'Live call', caller: sim.caller.number, lang: r.lang === 'hi' ? 'Hindi / Hinglish' : 'English', peakF: Math.round(r.peakF), verdict: r.verdict, outcome: r.outcome, lead: r.leadHold != null ? r.leadHold : r.leadWarn, ts: Date.now() }); setHist(a);
}
function ago(ts) { const m = Math.max(1, Math.round((Date.now() - ts) / 60000)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' }); }
function countUp(el, to, dec, suf) { const t0 = performance.now(); const f = (t) => { const p = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - p, 3); el.textContent = (to * e).toFixed(dec) + (suf || ''); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
function renderHistory() {
  const mine = getHist().map((h) => Object.assign({}, h));
  const all = mine;
  const fr = all.filter((h) => h.outcome === 'Caught'), fa = all.filter((h) => h.outcome === 'False alarm'), leads = all.filter((h) => h.lead != null && h.lead > 0 && h.outcome === 'Caught').map((h) => h.lead);
  const avg = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : 0;
  $('#stats').innerHTML = [['Calls analysed', all.length, 0, ''], ['Frauds caught', fr.length, 0, ''], ['Average lead time', avg, 1, ' s'], ['False alarms', fa.length, 0, '']].map(([l, v, d, s]) => `<div class="panel stat"><small>${l}</small><b data-v="${v}" data-d="${d}" data-s="${s}">0</b></div>`).join('');
  $$('#stats b').forEach((b) => countUp(b, +b.dataset.v, +b.dataset.d, b.dataset.s));
  $('#hbars').innerHTML = all.slice(0, 16).reverse().map((h, i) => `<i title="${esc(h.name)}: ${h.peakF}%" style="height:${Math.max(4, h.peakF)}%;--c:var(--${h.peakF >= 80 ? 'crit' : h.peakF >= 55 ? 'warn' : h.peakF >= 30 ? 'info' : 'good'});--i:${i}"></i>`).join('');
  const chip = (h) => `<span class="chip ${h.peakF >= 80 ? 'crit' : h.peakF >= 55 ? 'warn' : h.peakF >= 30 ? 'info' : 'good'}">${esc(h.verdict)}</span>`;
  $('#tbl').innerHTML = `<div class="tr hd"><span>Call</span><span>Language</span><span>Peak confidence</span><span>Verdict</span><span>Lead time</span><span>When</span></div>` + all.map((h) => `<div class="tr"><span><b>${esc(h.name)}</b><br><small>${esc(h.caller)}</small></span><span>${esc(h.lang)}</span><span style="display:flex;align-items:center;gap:8px"><span class="bar" style="flex:1"><i style="width:${h.peakF}%;background:var(--${h.peakF >= 80 ? 'crit' : h.peakF >= 55 ? 'warn' : h.peakF >= 30 ? 'info' : 'good'})"></i></span><b class="num">${h.peakF}%</b></span>${chip(h)}<span class="num">${h.lead != null && h.lead > 0 ? h.lead.toFixed(1) + ' s early' : '—'}</span><small>${ago(h.ts)}</small></div>`).join('');
}
function clearHist() { setHist([]); renderHistory(); toast('Your calls were cleared'); }
$('#clearHist').addEventListener('click', clearHist); $('#clearHist2').addEventListener('click', clearHist);

/* ---------- settings ---------- */
function syncSettings() {
  $('#rWatch').value = P.th.watch; $('#rWarn').value = P.th.warn; $('#rInt').value = P.th.intervene;
  $('#tvWatch').textContent = P.th.watch; $('#tvWarn').textContent = P.th.warn; $('#tvInt').textContent = P.th.intervene;
  $$('#setLang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.l === P.lang)));
  $$('#setEngine button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.e === (() => { try { return localStorage.getItem('vs.engine') || 'auto'; } catch (x) { return 'auto'; } })())));
  $$('#setStt button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.l === sttPref())));
}
function applyCfg() { if (sim) { Object.assign(sim.cfg.th, P.th); sim.cfg.trusted = P.trusted; sim.cfg.langOverride = P.lang; zones(); } savePrefs(); syncSettings(); tlDirty = true; }
$('#rWatch').addEventListener('input', (e) => { P.th.watch = Math.min(+e.target.value, P.th.warn - 5); applyCfg(); });
$('#rWarn').addEventListener('input', (e) => { P.th.warn = Math.max(P.th.watch + 5, Math.min(+e.target.value, P.th.intervene - 5)); applyCfg(); });
$('#rInt').addEventListener('input', (e) => { P.th.intervene = Math.max(P.th.warn + 5, +e.target.value); applyCfg(); });
$('#setEngine').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { try { localStorage.setItem('vs.engine', b.dataset.e); } catch (x) {} syncSettings(); toast('Speech engine set for your next call'); } });
$('#setStt').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { try { localStorage.setItem('vs.sttLang', b.dataset.l); } catch (x) {} syncSettings(); toast('Speech language set for your next call'); } });
$('#setLang').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { P.lang = b.dataset.l; applyCfg(); } });
const tog = (id, key) => $(id).addEventListener('click', () => { P[key] = !P[key]; savePrefs(); applyTheme(); applyCfg(); if (key === 'voice' && !P.voice) stopSpeech(); });
tog('#swMotion', 'motion'); tog('#swVoice', 'voice'); tog('#swTrusted', 'trusted');
$('#resetAll').addEventListener('click', () => { P = Object.assign({}, DEF, { th: Object.assign({}, DEF.th) }); savePrefs(); applyTheme(); applyCfg(); toast('Settings reset'); });

/* ---------- main loop ---------- */
function frame(ts) {
  nowTs = ts; const dt = Math.min(0.1, (ts - (lastTs || ts)) / 1000); lastTs = ts;
  if (sim) {
    if (document.visibilityState !== 'hidden') render(dt);
  }
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
applyTheme(); syncSettings();
buildPhone();
let hv = ''; try { hv = location.hash.replace('#', ''); } catch (e) {}
if (TITLES[hv]) showView(hv, true); else showView('live', true);
resetUI();
if (speechSynthesis && speechSynthesis.getVoices) try { speechSynthesis.getVoices(); } catch (e) {}
requestAnimationFrame(frame);
window.addEventListener('resize', () => { tlDirty = true; });
})();
