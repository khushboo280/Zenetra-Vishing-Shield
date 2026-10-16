import express from 'express';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PORT, CORS_ORIGIN } from './config.js';
import { describe, sttReady, llmReady, llm, ttsProvider, callerSource, checkAll, ProviderError } from './providers/index.js';
import { attachSignaling } from './signaling.js';
import { iceServers, hasTurn } from './ice.js';
import { lanIPs, makeServer } from './net.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const { server, secure } = await makeServer(app, root);
attachSignaling(server);
const scheme = secure ? 'https' : 'http', lan = lanIPs();
// the address OTHER devices must use: PUBLIC_URL if set, else this computer's LAN address
const publicUrl = (process.env.PUBLIC_URL || (lan[0] ? `${scheme}://${lan[0]}:${PORT}` : '')).replace(/\/$/, '');

app.use((req, res, next) => {                               // the frontend may be hosted elsewhere
  if (CORS_ORIGIN.includes('*')) res.set('Access-Control-Allow-Origin', '*'); else if (CORS_ORIGIN.includes(req.headers.origin)) res.set('Access-Control-Allow-Origin', req.headers.origin);
  next();
});

// Upload-voice test mode: raw 16 kHz mono Int16 PCM of ONE recorded call -> turns with speakers (see providers/conversation.js)
app.post('/api/transcribe-file', express.raw({ type: '*/*', limit: '120mb' }), async (req, res) => {
  try {
    const b = req.body; if (!Buffer.isBuffer(b) || b.length < 3200) throw new ProviderError('No audio received.');
    const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2)));
    const { analyzeRecording } = await import('./providers/conversation.js');
    res.json({ ok: true, ...(await analyzeRecording(pcm, { firstIs: String(req.query.firstIs || 'auto') })) });
  } catch (e) { res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ ok: false, error: String((e && e.message) || e).slice(0, 400) }); }
});
app.get('/api/health', (_q, res) => res.json({ ok: true }));
// Everything the browser needs to start a call: ICE servers (STUN + TURN), which STT and scoring engines are available
app.get('/api/config', (_q, res) => { const d = describe(); res.set('Cache-Control', 'no-store').json({
  iceServers: iceServers(), turn: hasTurn(), stt: sttReady() ? 'server' : 'webspeech', sttEngine: `${d.api1.label} (you) + ${d.api2.label} (caller)`, sttShort: d.api1.label === d.api2.label ? d.api1.label : `${d.api1.label}/${d.api2.label}`,
  providers: d, callerSource: callerSource(), ai: llmReady(), tts: !!ttsProvider(), ttsEngine: ttsProvider() ? ttsProvider().label : '', publicUrl,
}); });
app.get('/api/qr', async (req, res) => {                     // QR code of the caller link, so a phone only has to scan
  const text = String(req.query.text || '').slice(0, 300); if (!/^https?:\/\//.test(text)) return res.status(400).send('url required');
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(await QRCode.toString(text, { type: 'svg', margin: 1, width: 220, color: { dark: '#111827', light: '#ffffff' } }));
});
app.get('/api/diag', async (_q, res) => res.set('Cache-Control', 'no-store').json(await checkAll()));   // are the API1 / API2 / API3 keys usable right now?
// Spoken alert in Hindi / English (first provider that can talk: see ttsProvider). The browser falls back to the bundled voice / its own speech if this fails.
app.get('/api/tts', async (req, res) => {
  const lang = req.query.lang === 'hi' ? 'hi' : 'en';
  const text = String(req.query.text || '').slice(0, 600);
  if (!text) return res.status(400).send('text required');
  const p = ttsProvider(); if (!p) return res.status(501).send('no text-to-speech provider (set SARVAM_API_KEY, ELEVENLABS_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY)');
  try { res.set('Content-Type', p.ttsType || 'audio/wav').set('Cache-Control', 'public, max-age=86400').send(await p.tts(text, lang)); }
  catch (e) { res.status(e instanceof ProviderError ? 502 : 500).send(e.message); }
});

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) { app.use(express.static(dist)); app.get('/', (_q, r) => r.sendFile(join(dist, 'index.html'))); }

server.listen(PORT, '0.0.0.0', async () => {
  const bar = '─'.repeat(62);
  console.log(`\n${bar}\n  Vishing Shield is running\n${bar}`);
  console.log(`  On this computer : ${scheme}://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`  On phone / other : ${scheme}://${ip}:${PORT}   (same Wi-Fi)`));
  if (process.env.PUBLIC_URL) console.log(`  Public URL       : ${publicUrl}`);
  { const d = describe(); const t = ttsProvider(); console.log(`  Spoken alerts    : ${t ? t.label + ' voice' : 'NONE: the receiver gets browser speech, the caller gets no voice. Add a Sarvam / ElevenLabs / OpenAI / Gemini key'}`); console.log(`  API1 receiver mic: ${d.api1.label}\n  API2 caller audio: ${d.api2.label}${callerSource() === 'device' ? ' (caller device)' : ''}\n  API3 observer    : ${d.api3.label}`); }
  console.log(`  TURN relay       : ${hasTurn() ? 'yes' : 'no (STUN only: fine on most networks)'}`);
  if (secure) console.log('  HTTPS            : self-signed. Each device shows a warning once: Advanced -> Proceed.');
  const ck = await checkAll();
  for (const [k, v] of Object.entries(ck)) console.log(`  ${k.toUpperCase()} ${v.label.padEnd(10)} : ` + (v.ok ? 'key works ✔' : `NOT WORKING ✖  ${v.error}`));
  console.log(bar + '\n');
});
