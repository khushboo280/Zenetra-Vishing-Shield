// "Live Fusion": the score explained as nine living tiles. Each tile shows how much one signal pushes the risk up (red)
// or down (green), pulses when it changes, lights up under the cursor, and opens to show its recent history on click.
const TERMS = [
  { k: 'Intent', label: 'Asking for secrets', raw: 'I', ico: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M12 15v2"/>', tip: 'How strongly the caller is trying to get an OTP, PIN, password, an app installed or money.' },
  { k: 'Manipulation', label: 'Pressure tactics', raw: 'M', ico: '<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/>', tip: 'Urgency, fear, fake authority and "tell no one" pressure.' },
  { k: 'Sentiment', label: 'Emotional pressure', raw: 'S', ico: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15c1-1.4 2.2-2 3.5-2s2.5.6 3.5 2M9 9.5h.01M15 9.5h.01"/>', tip: 'Fear or distress on your side, or aggression from the caller.' },
  { k: 'Hesitation', label: 'Hesitation', raw: 'H', ico: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>', tip: 'Pauses, "um/uh" fillers and script-reading in the caller’s speech.' },
  { k: 'Deepfake', label: 'Synthetic voice', raw: 'D', ico: '<path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4"/>', tip: 'Chance the caller’s voice is artificial. Needs a voice-authenticity model to move.' },
  { k: 'Caller number', label: 'Caller number', raw: 'C', ico: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', tip: 'Unknown and international numbers carry more risk than saved contacts.' },
  { k: 'Compliance', label: 'Going along', raw: 'R', ico: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', tip: 'Whether you are reading out digits, installing something or agreeing to pay.' },
  { k: 'Scam stages', label: 'Scam playbook', raw: 'St', ico: '<path d="M4 6h4v4H4zM10 10h4v4h-4zM16 14h4v4h-4z"/>', tip: 'How many scam steps are present: authority, pressure, secrecy, demand.' },
  { k: 'Family', label: 'Knows you', raw: 'Fam', ico: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 20c0-2.2 1.3-4 3.2-4.6"/>', tip: 'Evidence the two of you genuinely know each other. This lowers the risk.' },
];
const svg = (p) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const sign = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);

export function initFusion(host) {
  host.innerHTML = `
    <div class="fx-read" id="fxRead"><span class="chip" id="fxRel">Waiting for the call</span><p id="fxSum">AI’s plain-language read of the conversation will appear here.</p></div>
    <div class="fx-eq">
      <div class="fx-bar" id="fxBar" aria-label="Contribution of each signal"></div>
      <div class="fx-res"><small>starting point</small><b id="fxBase">−6.00</b><i>+</i><small>signals</small><b id="fxSig">0.00</b><i>=</i><small>risk score</small><b id="fxLogit">−6.00</b><i>→</i><b class="fx-pct" id="fxPct">0%</b></div>
    </div>
    <div class="fx-grid" id="fxGrid">${TERMS.map((t, i) => `
      <button class="ft" data-i="${i}" aria-expanded="false" aria-label="${t.label}">
        <span class="ft-glow"></span>
        <span class="ft-top"><i class="ft-ico">${svg(t.ico)}</i><b>${t.label}</b><em class="ft-dir"></em></span>
        <span class="ft-val"><b>0.00</b><small>0/100</small></span>
        <span class="ft-meter"><i></i></span>
        <span class="ft-tip">${t.tip}</span>
        <svg class="ft-spark" viewBox="0 0 100 26" preserveAspectRatio="none"><polyline points=""/></svg>
      </button>`).join('')}</div>`;
  const tiles = [...host.querySelectorAll('.ft')].map((el, i) => ({ el, val: el.querySelector('.ft-val b'), sub: el.querySelector('.ft-val small'), bar: el.querySelector('.ft-meter i'), dir: el.querySelector('.ft-dir'), spark: el.querySelector('.ft-spark polyline'), last: 0, hist: [], i }));
  const bar = host.querySelector('#fxBar');
  bar.innerHTML = TERMS.map((t, i) => `<i data-i="${i}" title="${t.label}"></i>`).join('');
  const segs = [...bar.children];

  host.addEventListener('pointermove', (e) => {                                  // cursor-follow glow
    const t = e.target.closest('.ft'); if (!t) return; const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });
  host.addEventListener('click', (e) => { const t = e.target.closest('.ft'); if (t) { const o = t.classList.toggle('open'); t.setAttribute('aria-expanded', String(o)); } });
  const hot = (i, on) => { tiles[i].el.classList.toggle('link', on); segs[i].classList.toggle('hot', on); };
  bar.addEventListener('pointerover', (e) => { const s = e.target.closest('i'); if (s) hot(+s.dataset.i, true); });
  bar.addEventListener('pointerout', (e) => { const s = e.target.closest('i'); if (s) hot(+s.dataset.i, false); });
  tiles.forEach((t) => { t.el.addEventListener('pointerenter', () => hot(t.i, true)); t.el.addEventListener('pointerleave', () => hot(t.i, false)); });

  const pct = host.querySelector('#fxPct');
  return {
    /** fu = VSEngine.fuse() result · raw = {Intent: 0..100, …} · ai = AI analysis | null · F = fraud confidence */
    update(fu, raw, ai, F) {
      const total = TERMS.reduce((a, t) => a + Math.abs(fu.terms[t.k] || 0), 0) || 1;
      TERMS.forEach((t, i) => {
        const v = fu.terms[t.k] || 0, tl = tiles[i], p = Math.min(50, Math.abs(v) / 4 * 50);
        tl.val.textContent = sign(v); tl.sub.textContent = (raw[t.k] != null ? Math.round(raw[t.k]) : 0) + (t.k === 'Scam stages' ? '/4 steps' : '/100');
        tl.bar.style.left = (v >= 0 ? 50 : 50 - p) + '%'; tl.bar.style.width = p + '%';
        const tone = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
        if (tl.el.dataset.tone !== tone) { tl.el.dataset.tone = tone; tl.dir.textContent = tone === 'up' ? 'raises risk' : tone === 'down' ? 'lowers risk' : 'neutral'; }
        if (Math.abs(v - tl.last) > 0.03) { tl.el.classList.remove('bump'); void tl.el.offsetWidth; tl.el.classList.add('bump'); }   // pulse on change
        tl.last = v; tl.hist.push(v); if (tl.hist.length > 60) tl.hist.shift();
        if (tl.el.classList.contains('open')) tl.spark.setAttribute('points', tl.hist.map((q, n) => `${(n / Math.max(1, tl.hist.length - 1) * 100).toFixed(1)},${(13 - Math.max(-4, Math.min(4, q)) / 4 * 11).toFixed(1)}`).join(' '));
        segs[i].style.flexGrow = Math.max(0.02, Math.abs(v) / total); segs[i].dataset.sign = v >= 0 ? 'up' : 'down';
      });
      const sig = fu.logit - (-6); host.querySelector('#fxSig').textContent = sign(sig); host.querySelector('#fxLogit').textContent = fu.logit.toFixed(2);
      pct.textContent = Math.round(F) + '%'; pct.classList.remove('pulse2'); void pct.offsetWidth; pct.classList.add('pulse2');
      const rel = host.querySelector('#fxRel'), sum = host.querySelector('#fxSum');
      if (ai) {
        const R = { family: 'Family', friend: 'Friend', colleague: 'Colleague', business: 'Business', stranger: 'Stranger', unclear: 'Unclear' }[ai.relationship] || 'Unclear';
        const known = ai.mutual && ai.familiarity >= 65 && !ai.claimUnverified;
        rel.textContent = known ? `${R} · you know each other` : `${R} · familiarity ${Math.round(ai.familiarity)}%`; rel.className = 'chip ' + (known ? 'good' : ai.claimUnverified ? 'warn' : '');
        sum.textContent = ai.summary || '—';
      }
    },
    reset() { tiles.forEach((t) => { t.hist = []; t.last = 0; t.spark.setAttribute('points', ''); }); host.querySelector('#fxRel').textContent = 'Waiting for the call'; host.querySelector('#fxRel').className = 'chip'; host.querySelector('#fxSum').textContent = 'AI’s plain-language read of the conversation will appear here.'; },
  };
}
