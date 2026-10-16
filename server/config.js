import 'dotenv/config';
const n = (v, d) => (v === undefined || v === '' ? d : Number(v));
export const PORT = n(process.env.PORT, 8787);
export const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());   // set to your site URL in production
export const LLM_MIN_GAP_MS = n(process.env.LLM_MIN_GAP_MS, 700);                              // per-connection rate limit for API3

// Provider keys / models are read by server/providers/* straight from the environment (see .env.example).
// WebRTC ICE: STUN is public; TURN comes from your own relay
export const ICE = {
  stun: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478').split(',').map((s) => s.trim()).filter(Boolean),
  turnUrls: (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
  turnUser: process.env.TURN_USERNAME || '',
  turnCred: process.env.TURN_CREDENTIAL || '',
  turnSecret: process.env.TURN_SECRET || '',            // coturn `use-auth-secret`: short-lived credentials are derived per request
  ttl: n(process.env.TURN_TTL, 3600),
};
