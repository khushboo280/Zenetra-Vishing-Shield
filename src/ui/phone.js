// A realistic smartphone "in-call" screen, used by BOTH the receiver dashboard and the caller page.
// Mute / Speaker / Keypad / End call are real controls: the host page wires them to the WebRTC call.
const I = {
  mute: '<path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  keypad: '<circle cx="6" cy="5" r="1.4"/><circle cx="12" cy="5" r="1.4"/><circle cx="18" cy="5" r="1.4"/><circle cx="6" cy="11" r="1.4"/><circle cx="12" cy="11" r="1.4"/><circle cx="18" cy="11" r="1.4"/><circle cx="6" cy="17" r="1.4"/><circle cx="12" cy="17" r="1.4"/><circle cx="18" cy="17" r="1.4"/><circle cx="12" cy="22" r="1.4"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  add: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 8v6M15 11h6"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="M15 10.5l6-3v9l-6-3"/>',
  contacts: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><circle cx="12" cy="10" r="2.6"/><path d="M7.5 17c.8-2 2.4-3 4.5-3s3.7 1 4.5 3"/>',
  end: '<path d="M3 14.5c5-4.3 13-4.3 18 0l-1.7 2.6-3.5-1.4v-2.6c-2.7-.8-5.3-.8-8 0v2.6l-3.5 1.4L3 14.5z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
const svg = (k, w = 26) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], '*': [941, 1209], 0: [941, 1336], '#': [941, 1477] };
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const initials = (n) => (String(n).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();

export function createPhone(host, o = {}) {
  const role = o.role || 'receiver';
  host.innerHTML = `
  <div class="phone" data-role="${role}">
    <div class="phone-btn pb-a"></div><div class="phone-btn pb-b"></div><div class="phone-btn pb-c"></div>
    <div class="phone-screen">
      <div class="p-island"></div>
      <div class="p-status"><b class="p-clock">9:41</b><span class="p-sys">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2.5" width="3" height="9.5" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1" opacity=".35"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 4.2a9 9 0 0 1 13 0M3.8 6.7a5.6 5.6 0 0 1 8.4 0M6.2 9.2a2.2 2.2 0 0 1 3.6 0"/></svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none"><rect x=".6" y=".6" width="21.8" height="10.8" rx="3.2" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"/><rect x="23.4" y="4" width="1.8" height="4" rx=".9" fill="currentColor" opacity=".5"/></svg>
      </span></div>
      <div class="p-alert" role="alert" aria-live="assertive"><i>${svg('shield', 20)}</i><div><b></b><span></span></div></div>
      <div class="p-main">
        <div class="p-id">
          <div class="p-avatar"><span class="p-ini">?</span><i class="p-ring"></i><i class="p-ring r2"></i></div>
          <h3 class="p-name">${o.name || 'Unknown'}</h3>
          <div class="p-num">${o.number || ''}</div>
          <div class="p-state" aria-live="polite">${role === 'caller' ? 'calling…' : 'waiting…'}</div>
        </div>
        <div class="p-guard" hidden><i class="gd"></i><span class="gt">Vishing Shield is listening</span></div>
        <div class="p-grid">
          <button class="pbtn" data-a="mute" aria-pressed="false"><i>${svg('mute')}</i><span>mute</span></button>
          <button class="pbtn" data-a="keypad"><i>${svg('keypad')}</i><span>keypad</span></button>
          <button class="pbtn on" data-a="speaker" aria-pressed="true"><i>${svg('speaker')}</i><span>speaker</span></button>
          <button class="pbtn" disabled title="Not part of this prototype"><i>${svg('add')}</i><span>add call</span></button>
          <button class="pbtn" disabled title="Not part of this prototype"><i>${svg('video')}</i><span>video</span></button>
          <button class="pbtn" disabled title="Not part of this prototype"><i>${svg('contacts')}</i><span>contacts</span></button>
        </div>
        <div class="p-pad" hidden>
          <div class="p-digits" aria-live="polite">&nbsp;</div>
          <div class="p-keys">${KEYS.map(([d, l]) => `<button class="pkey" data-d="${d}"><b>${d}</b><small>${l}</small></button>`).join('')}</div>
        </div>
        <div class="p-foot">
          <button class="p-hide" hidden>${svg('back', 18)}<span>Hide</span></button>
          <button class="p-end" aria-label="End call"><i>${svg('end', 30)}</i></button>
        </div>
      </div>
      <div class="p-home"></div>
    </div>
  </div>`;
  const q = (s) => host.querySelector(s);
  const el = q('.phone'), grid = q('.p-grid'), pad = q('.p-pad'), digits = q('.p-digits'), hide = q('.p-hide');
  let muted = false, speaker = true, typed = '', ac = null, alertT = null, ended = false;

  const tick = () => { const d = new Date(); q('.p-clock').textContent = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`; };
  tick(); const clock = setInterval(tick, 20000);
  q('.p-ini').textContent = initials(o.name || 'Unknown');

  function tone(d) {                                                       // local key-press sound (DTMF pair); not sent to the other side
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const [a, b] = DTMF[d], t = ac.currentTime;
      const g = ac.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14); g.connect(ac.destination);
      [a, b].forEach((f) => { const os = ac.createOscillator(); os.frequency.value = f; os.connect(g); os.start(t); os.stop(t + 0.15); });
    } catch (e) {}
  }
  const showPad = (on) => { pad.hidden = !on; grid.hidden = on; hide.hidden = !on; el.classList.toggle('padding', on); };

  const api = {
    el,
    setName(n) { q('.p-name').textContent = n; q('.p-ini').textContent = initials(n); },
    setNumber(n) { q('.p-num').textContent = n; },
    setStatus(t) { q('.p-state').textContent = t; },
    setTimer(s) { q('.p-state').textContent = mmss(s); },
    setState(st) { el.dataset.state = st; ended = st === 'ended'; if (ended) { q('.p-state').textContent = 'call ended'; showPad(false); } },
    setMuted(m) { muted = !!m; const b = q('[data-a=mute]'); b.classList.toggle('on', muted); b.setAttribute('aria-pressed', String(muted)); b.querySelector('span').textContent = muted ? 'unmute' : 'mute'; },
    setGuard(level, text) { const g = q('.p-guard'); g.hidden = false; g.dataset.level = level; g.querySelector('.gt').textContent = text; },
    alert({ title, text, level = 'crit', ms = 14000 }) {
      const a = q('.p-alert'); a.dataset.level = level; a.querySelector('b').textContent = title; a.querySelector('span').textContent = text; a.classList.add('on');
      clearTimeout(alertT); if (ms) alertT = setTimeout(() => api.clearAlert(), ms);
    },
    clearAlert() { clearTimeout(alertT); q('.p-alert').classList.remove('on'); },
    destroy() { clearInterval(clock); clearTimeout(alertT); host.innerHTML = ''; },
  };

  host.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || ended) return;
    if (b.classList.contains('p-end')) { o.onEnd && o.onEnd(); return; }
    if (b.classList.contains('p-hide')) { showPad(false); return; }
    if (b.classList.contains('pkey')) { typed = (typed + b.dataset.d).slice(-18); digits.textContent = typed; tone(b.dataset.d); o.onDigit && o.onDigit(b.dataset.d); return; }
    const a = b.dataset.a;
    if (a === 'mute') { api.setMuted(!muted); o.onMute && o.onMute(muted); }
    else if (a === 'speaker') { speaker = !speaker; b.classList.toggle('on', speaker); b.setAttribute('aria-pressed', String(speaker)); o.onSpeaker && o.onSpeaker(speaker); }
    else if (a === 'keypad') showPad(true);
  });
  return api;
}
