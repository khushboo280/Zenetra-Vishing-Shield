// Risk timeline for normal people: one smooth line that turns green -> amber -> red as the danger grows.
// No axes, no jargon. Hover (or touch) any moment to read it. Alert moments are marked with a small flag.
const WORD = (v, th) => (v >= th.intervene ? 'Danger' : v >= th.watch ? 'Be careful' : 'Safe');
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function drawRiskWave(c, { hist, alerts = [], th, t, hoverX, col, ts, running }) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight; if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const L = 12, R = 14, T = 14, B = 26, pw = w - L - R, ph = h - T - B;
  const Y = (v) => T + ph * (1 - Math.max(0, Math.min(100, v)) / 100);
  const t1 = Math.max(30, t), t0 = Math.max(0, t1 - 600), X = (s) => L + pw * ((s - t0) / (t1 - t0));

  // soft zones: Safe / Be careful / Danger
  const zones = [[0, th.watch, 'good', 'Safe'], [th.watch, th.intervene, 'warn', 'Be careful'], [th.intervene, 100, 'crit', 'Danger']];
  g.font = '600 10.5px Hanken Grotesk, sans-serif'; g.textBaseline = 'middle';
  for (const [a, b, cc, label] of zones) {
    const y1 = Y(b), y0 = Y(a);
    const gr = g.createLinearGradient(0, y1, 0, y0); gr.addColorStop(0, col(cc, 0.11)); gr.addColorStop(1, col(cc, 0.03));
    g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(L, y1 + 1, pw, Math.max(0, y0 - y1 - 2), 10) : g.rect(L, y1 + 1, pw, y0 - y1 - 2); g.fill();
    g.fillStyle = col(cc, 0.9); g.textAlign = 'left'; g.fillText(label, L + 10, (y0 + y1) / 2);
  }
  const pts = hist.filter((s) => s.t >= t0);
  if (pts.length < 2) {
    g.fillStyle = col('fg3', 1); g.textAlign = 'center'; g.font = '500 13px Hanken Grotesk, sans-serif';
    g.fillText(running ? 'Listening… the line appears as you talk' : 'Connect a call to see how safe it is', L + pw / 2, T + ph / 2); return null;
  }
  // thin out + smooth (Catmull-Rom -> Bezier)
  const step = Math.max(1, Math.floor(pts.length / 220)), P = []; for (let i = 0; i < pts.length; i += step) P.push([X(pts[i].t), Y(pts[i].F), pts[i]]);
  const last = pts[pts.length - 1]; if (P[P.length - 1][2] !== last) P.push([X(last.t), Y(last.F), last]);
  const path = (close) => {
    g.beginPath(); g.moveTo(P[0][0], P[0][1]);
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)], k = 0.18;
      g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k, p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k, p2[0], p2[1]);
    }
    if (close) { g.lineTo(P[P.length - 1][0], Y(0)); g.lineTo(P[0][0], Y(0)); g.closePath(); }
  };
  const stroke = g.createLinearGradient(0, Y(0), 0, Y(100)), f = (v) => Math.max(0, Math.min(1, v / 100));
  stroke.addColorStop(0, col('good', 1)); stroke.addColorStop(f(th.watch), col('good', 1)); stroke.addColorStop(f((th.watch + th.intervene) / 2), col('warn', 1)); stroke.addColorStop(f(th.intervene), col('crit', 1)); stroke.addColorStop(1, col('crit', 1));
  const fill = g.createLinearGradient(0, Y(0), 0, Y(100));
  fill.addColorStop(0, col('good', 0.02)); fill.addColorStop(f(th.watch), col('good', 0.16)); fill.addColorStop(f((th.watch + th.intervene) / 2), col('warn', 0.22)); fill.addColorStop(1, col('crit', 0.34));
  path(true); g.fillStyle = fill; g.fill();
  path(false); g.strokeStyle = stroke; g.lineWidth = 3.4; g.lineJoin = g.lineCap = 'round'; g.shadowColor = col('accent', 0.25); g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;

  // alert flags
  for (const a of alerts) {
    if (a.t < t0) continue; const x = X(a.t);
    g.strokeStyle = col('crit', 0.5); g.setLineDash([3, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, T + 4); g.lineTo(x, Y(0)); g.stroke(); g.setLineDash([]);
    g.fillStyle = col('crit', 1); g.beginPath(); g.arc(x, T + 6, 8, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '800 11px Hanken Grotesk, sans-serif'; g.textAlign = 'center'; g.fillText('!', x, T + 6.5);
  }
  // time hints
  g.fillStyle = col('fg3', 1); g.font = '500 10.5px Hanken Grotesk, sans-serif'; g.textBaseline = 'alphabetic';
  g.textAlign = 'left'; g.fillText(t0 === 0 ? 'Call started' : mmss(t0), L, h - 8); g.textAlign = 'right'; g.fillText('Now', w - R, h - 8);

  // "now" dot
  const lx = X(last.t), ly = Y(last.F), tone = last.F >= th.intervene ? 'crit' : last.F >= th.watch ? 'warn' : 'good', pr = 4.5 + 1.6 * Math.sin(ts / 220);
  g.fillStyle = col(tone, 0.25); g.beginPath(); g.arc(lx, ly, pr + 6, 0, 7); g.fill();
  g.fillStyle = col('surface', 1); g.beginPath(); g.arc(lx, ly, pr + 1.8, 0, 7); g.fill();
  g.fillStyle = col(tone, 1); g.beginPath(); g.arc(lx, ly, pr, 0, 7); g.fill();

  // hover read-out
  let hit = null;
  if (hoverX != null) {
    let best = P[0], bd = 1e9; for (const p of P) { const d = Math.abs(p[0] - hoverX); if (d < bd) { bd = d; best = p; } }
    const s = best[2], x = best[0], y = best[1], tone2 = s.F >= th.intervene ? 'crit' : s.F >= th.watch ? 'warn' : 'good';
    g.strokeStyle = col('fg3', 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, Y(0)); g.stroke();
    g.fillStyle = col(tone2, 1); g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill(); g.strokeStyle = col('surface', 1); g.lineWidth = 2; g.stroke();
    const label = `${mmss(s.t)} · ${WORD(s.F, th)} · ${Math.round(s.F)}%`; g.font = '700 11.5px Hanken Grotesk, sans-serif';
    const tw = g.measureText(label).width + 20, bx = Math.min(w - R - tw, Math.max(L, x - tw / 2)), by = Math.max(T, y - 38);
    g.fillStyle = col('fg', 0.94); g.beginPath(); g.roundRect ? g.roundRect(bx, by, tw, 24, 12) : g.rect(bx, by, tw, 24); g.fill();
    g.fillStyle = col('surface', 1); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, bx + tw / 2, by + 12.5);
    hit = s;
  }
  return hit;
}
export const riskWord = WORD;
