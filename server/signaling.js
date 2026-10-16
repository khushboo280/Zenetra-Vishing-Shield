// Socket.IO signalling + the room's side channel. The server never touches the call audio: it relays offer / answer / ICE,
// transcript/alert notices, and forwards audio chunks to API1/API2 (speech-to-text) and transcripts to API3 (the LLM observer).
import { retryHint } from './providers/llm/gemini.js';
import { Server } from 'socket.io';
import { CORS_ORIGIN, LLM_MIN_GAP_MS } from './config.js';
import { transcribe, llm, sttFor, ProviderError } from './providers/index.js';

const ROOM = /^[A-Z0-9]{4,8}$/;
const msg = (e) => (e instanceof ProviderError ? e.message : 'failed: ' + (e && e.message));

export function attachSignaling(httpServer) {
  const io = new Server(httpServer, { cors: { origin: CORS_ORIGIN.includes('*') ? true : CORS_ORIGIN, methods: ['GET', 'POST'] }, maxHttpBufferSize: 1e6, pingInterval: 10000, pingTimeout: 20000 });
  const peers = (room) => io.sockets.adapter.rooms.get(room) || new Set();
  const other = (socket) => [...peers(socket.data.room)].map((id) => io.sockets.sockets.get(id)).find((s) => s && s.id !== socket.id);

  io.on('connection', (socket) => {
    socket.on('join', ({ room, role, caller } = {}, ack = () => {}) => {
      room = String(room || '').toUpperCase();
      if (!ROOM.test(room) || !['dashboard', 'caller'].includes(role)) return ack({ ok: false, error: 'Invalid room or role' });
      const mate = [...peers(room)].map((id) => io.sockets.sockets.get(id)).find((s) => s && s.data.role === role && s.id !== socket.id);
      if (mate) return ack({ ok: false, error: `A ${role} is already in room ${room}` });
      socket.data = { room, role }; socket.join(room);
      const o = other(socket);
      if (o) o.emit('peer-joined', { role, caller });
      ack({ ok: true, peerPresent: !!o, peerRole: o ? o.data.role : null });
    });

    // WebRTC negotiation + side channel: relayed untouched to the other peer (only from sockets that joined a room)
    const relay = (ev) => socket.on(ev, (m) => { if (!socket.data.room) return; const o = other(socket); if (o) o.emit(ev, m); });
    relay('signal'); relay('transcript'); relay('alert'); relay('hangup'); relay('stt-fallback');
    // optional CALLER_STT_SOURCE=device: caller's own browser produced text; forwarded to the receiver
    socket.on('stt', (m = {}) => { const o = socket.data.room && other(socket); if (o && socket.data.role === 'caller') o.emit('stt', { who: 'caller', text: String(m.text || '').slice(0, 800), segFinal: !!m.segFinal, turnEnd: !!m.turnEnd }); });

    // API3: the LLM observer. One request at a time per connection.
    let last = 0, busy = false;
    socket.on('analyze', async ({ turns, caller } = {}, ack = () => {}) => {
      if (socket.data.role !== 'dashboard') return ack({ ok: false, error: 'only the receiver dashboard can request analysis' });
      const p = llm(); if (!p.enabled()) return ack({ ok: false, error: `${p.label} key (${p.needs.join(', ')}) is not set on the server` });
      if (busy) return ack({ ok: false, error: 'busy' });
      busy = true;
      try {
        const wait = last + LLM_MIN_GAP_MS - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        last = Date.now();
        ack({ ok: true, result: await p.analyze(Array.isArray(turns) ? turns : [], caller || {}), provider: p.id });
      } catch (e) { ack({ ok: false, error: msg(e), retryMs: e && e.status === 429 ? (retryHint(e) || 15000) : 0 }); } finally { busy = false; }
    });

    // API1 (who=receiver) / API2 (who=caller): one finished utterance of 16 kHz mono Int16 PCM. The page says which stream it is;
    // a caller-role socket can only ever submit 'caller' audio.
    let inflight = 0;
    socket.on('transcribe', async ({ who, pcm, ctx } = {}, ack = () => {}) => {
      who = socket.data.role === 'caller' ? 'caller' : who === 'caller' ? 'caller' : 'receiver';
      const p = sttFor(who);
      if (!p.enabled()) return ack({ ok: false, who, error: `${p.label} key (${p.needs.join(', ')}) is not set on the server` });
      if (inflight >= 6) return ack({ ok: false, who, error: 'busy' });
      inflight++;
      const t0 = Date.now();
      try { const text = await transcribe(who, pcm, String(ctx || '').slice(-300)); ack({ ok: true, who, provider: p.id, text, ms: Date.now() - t0 }); }
      catch (e) { ack({ ok: false, who, error: msg(e) }); } finally { inflight--; }
    });

    socket.on('disconnect', () => {
      const { room } = socket.data || {}; if (!room) return;
      const o = [...peers(room)].map((id) => io.sockets.sockets.get(id)).find(Boolean);
      if (o) o.emit('peer-left', { role: socket.data.role });
    });
  });
  return io;
}
