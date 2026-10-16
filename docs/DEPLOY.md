# Calling across the internet

1. **Host the app on a public HTTPS URL** (Render, Railway, Fly.io, a VPS + Caddy/nginx…). `npm run build && npm start` serves UI + API + Socket.IO on one port. Set the keys for your chosen providers (`STT_API1`, `STT_API2`, `LLM_API3`, and the matching `*_API_KEY`) (and `CORS_ORIGIN=https://your-site`) as environment variables there. Phones refuse the microphone without HTTPS.
2. **STUN** (Google + Cloudflare) is on by default and connects most home/Wi-Fi/4G pairs directly.
3. **TURN** is needed for strict networks (corporate firewalls, some carrier NATs). Pick one:
   * a hosted service: set `TURN_URLS=turn:host:3478,turns:host:443?transport=tcp`, `TURN_USERNAME`, `TURN_CREDENTIAL`;
   * your own coturn (`use-auth-secret`, `static-auth-secret=XYZ`): set `TURN_URLS` and `TURN_SECRET=XYZ`; the server hands out short-lived credentials per call.
   The dashboard shows `Network: STUN only / STUN + TURN`, and after connecting whether the path is direct or relayed.
4. Share the caller link from the dashboard. It works from any phone or computer.
5. **Key hygiene:** the API keys live only in server env. If a key was ever pasted in chat or committed, revoke it in Google AI Studio and create a new one.

Speech-to-text: without `DEEPGRAM_API_KEY` each browser transcribes its own voice (Chrome/Edge/Android Chrome). With a key, the server transcribes both sides.
