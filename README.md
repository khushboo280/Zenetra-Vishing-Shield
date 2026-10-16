# Vishing Shield (CC6-AI04)

Real-time guard for vishing / deepfake-voice calls. Two phones (or browsers) talk over **WebRTC through the internet**. Three swappable APIs do the AI work:

| Slot | Job | Default | Other choices |
|---|---|---|---|
| **API1** | speech-to-text of the **receiver's own microphone** | `sarvam` | `openai`, `whisper`, `groq`, `deepgram`, `elevenlabs` |
| **API2** | speech-to-text of the **caller's audio** (the remote WebRTC stream) | `sarvam` | same list |
| **API3** | AI observer: reads the merged transcript, calculates **every score** and **decides alerts** | `gemini` | `openai`, `grok`, `groq`, `llama` |

Alerts **never end the call**; only a person pressing **End call** does.

```
Caller phone ◀── WebRTC audio (both ways) ──▶ Receiver dashboard
                                               ├─ mic ───────▶ server ─▶ API1 ─┐
                                               └─ caller audio ▶ server ─▶ API2 ─┴▶ ONE transcript [{who:'caller'|'receiver', text}]
                                                                          transcript ─▶ API3 ─▶ scores + alert level (0-3) ─▶ UI
```

## Run (VS Code terminal)
```
npm install
npm run setup     # choose a provider for API1 / API2 / API3, then paste only the keys you need; writes .env and tests them
npm start         # builds and serves everything (HTTPS, so phones may use the microphone)
```
1. Open the printed address on the receiver device, press **Start**. A room code, link and QR appear.
2. Open the link on the caller device (any network), allow the microphone, press **Join**.
3. Talk. The transcript, scores, Live Fusion and risk wave update live. **Download transcript** gives a PDF.

## Swap a provider
Change one word in `.env` and restart: `STT_API1=groq`, `STT_API2=deepgram`, `LLM_API3=grok` (or re-run `npm run setup`). Nothing else changes.
To add a vendor: add one file in `server/providers/stt/` or `server/providers/llm/` that exports `{ id, label, needs, enabled(), transcribe(pcm) }` (or `analyze(turns, caller)`), and register it in `server/providers/index.js`. OpenAI-compatible vendors (Groq, Grok, OpenAI, many others) need only a one-line `makeOpenAiCompatStt/Llm({...})` entry.

**Llama:** `LLM_API3=llama` works with any OpenAI-compatible Llama host. Set `LLAMA_API_KEY`, and if you are not using Meta's own API also `LLAMA_BASE_URL` and `LLAMA_MODEL` (Together, OpenRouter, Fireworks, or a local Ollama at `http://localhost:11434/v1`). `LLM_API3=groq` also runs Llama (`llama-3.3-70b-versatile`) on Groq, with the same key as Groq Whisper.

## How the rules work
* **API3 alone decides alerts.** It returns `alert_level` 0 none · 1 watch · 2 warning · 3 intervene (spoken warning to the caller). There are no keyword lists, time steps or score thresholds that raise an alert; the client only shows API3's decision.
* **Familiarity override.** If API3 sees that both people genuinely know each other, the level is 0 whatever they discuss (also enforced in `normalizeAnalysis`). A caller who only *claims* to be family is not exempt.
* **Only real words.** Transcript text comes only from API1/API2 (or, if their keys fail, that speaker's browser speech recognition). There is no simulated or mock data anywhere in the product.
* **Order.** Turns from the two streams are merged by when they were *spoken*, not when the provider answered.
* `CALLER_STT_SOURCE=device` makes the caller's own browser send its microphone to API2 instead of the receiver transcribing the remote stream.

## Speed and accuracy
* **Delay** (speech -> text): sentences are cut after ~0.4 s of silence (long ones at their first pause after 3.5 s), up to 2 requests per stream run in parallel, and the dashboard shows `Speech delay ~x s`. The rest is your provider's own speed: **Groq Whisper** and **Deepgram** answer in about 0.3-0.8 s, Sarvam / ElevenLabs / OpenAI take about 1-3 s. Gemini's "thinking" is switched off for scoring (it added 3-8 s).
* **Random sentences / languages** came from the recogniser inventing text on noise, silence or echo, and from a vocabulary prompt that Whisper-type models repeat. Now: no prompt, silence and noise are never sent, Whisper segments with low confidence are dropped, text in other scripts / looping phrases / stock phrases ("thanks for watching") is dropped, the receiver mic ignores frames while the caller is audible (speaker echo), and `STT_LANGUAGE=hi|en` pins the language for every vendor.

## Alerts (voice, decided by API3)
API3 returns `alert_now` when a **voice** warning should be played to **both** people right now. The first alert is always spoken: the receiver hears it on their speaker and the caller hears it in the call. Later alerts happen only when API3 sees something new. API3 is told how many alerts were already played and how long ago. Familiar people never get an alert. The voice comes from ElevenLabs, OpenAI or Gemini (`TTS_API`), prepared as soon as the call's language is known; until then the bundled voice / browser speech is used.

## Audio health (what to look at when you cannot hear)
Both pages show live chips from the browser's RTP statistics: **Hearing … ✓ / quiet / No audio from …**, **Your voice is going out ✓ / Your mic sends silence**, and **Path** (same network, direct STUN, or relayed TURN). `No audio` with a connected link means the network blocks the direct path: set `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` in `.env` (a free hosted TURN account works), or use the same Wi-Fi. If your microphone is loud but nothing leaves the audio engine, the app switches to the raw microphone by itself.

## Audio (two-way) design
* ICE candidates that arrive before the remote description are queued and applied after it (`src/live/rtc.js`); signalling messages are processed strictly in order.
* The remote stream is attached to a real `<audio>` element on both sides. If the browser blocks autoplay, a **Tap to hear** button appears (and any tap unlocks it).
* The receiver's outgoing mic goes through a Web Audio bus (mute, alert mixing). If the browser keeps that context suspended, the raw microphone track is sent instead so the caller never hears silence.
* ICE restart on `failed`, and after 3 s of `disconnected`.
* Use headphones when two devices are in one room, otherwise the speaker leaks into the other microphone.

## Files
| File | Purpose |
|---|---|
| `server/providers/index.js` | the only place that maps API1 / API2 / API3 to vendors |
| `server/providers/stt/*`, `llm/*` | one file per vendor (Sarvam, Deepgram, OpenAI-compatible STT; Gemini, OpenAI-compatible LLM) |
| `server/prompts.js` | observer prompt + response schema (familiarity first) |
| `server/signaling.js` | Socket.IO: offer / answer / ICE, `transcribe` → API1/API2, `analyze` → API3 |
| `src/live/rtc.js` | ICE queue, audio playback with tap-to-hear, AudioContext watchdog |
| `src/live/session.js`, `chunkStt.js` | audio graph, VAD, chunking, merge of the two streams |
| `src/live/liveCall.js` | scores smoothing + alert level (from API3) |

## Test
`npm test` runs unit tests against local fake servers for every provider (no real network).
End-to-end audio proof (needs Playwright + Chromium):
```
HTTPS=0 PORT=8799 node server/index.js &
python3 tests/e2e/two-way-audio.py
```

## Troubleshooting
* Startup prints `API1 / API2 / API3 … key works ✔` or the exact reason (invalid key, no credit, quota). `GET /api/diag` returns the same live.
* **429 / quota** on Gemini free keys (~10 requests/minute): the server rotates through several models; for long calls enable billing or pick another `LLM_API3`.
* **Transcript missing** on one side → hover the Speech chip; that side falls back to browser speech recognition (Chrome / Edge desktop) after repeated provider errors.
* Strict mobile / office networks need a TURN server (`TURN_*` in `.env`). See `docs/DEPLOY.md`.

## v22 – patience and voice-only alerts
- API3 first listens. A lone opening line ("I am calling from the bank") never triggers anything. No warning level above 1 and no voice alert is allowed until at least 12 s and 4 turns (2+ from the caller) were heard (`minAlertSeconds` / `minAlertTurns` in `src/live/liveCall.js`). After that API3 alone decides when the voice alert goes out.
- No beep, no tone: the alert is always a spoken voice for both people, made by a TTS key (Sarvam, ElevenLabs, OpenAI or Gemini; `TTS_API` forces one). Without a TTS key the receiver gets browser speech and the caller hears nothing.
- Familiar people still get no alert.

## v25/v26 – call audio
- v25 added a playback "voice leveller" and Opus/sender tweaks; on real devices it made the call worse, so v26 turns them OFF again: call audio plays straight from the WebRTC element, exactly as in v24.
- Same room, same Wi-Fi: the speaker of one phone is picked up by the mic of the other, the browser's echo canceller then cuts words (= "breaks"). Use headphones on at least one side, or keep the devices in different rooms.

## v27
- **Self-healing connection:** if the link says "connected" but audio packets stop in either direction for 5 s, the receiver builds a new network path (ICE restart); after 3 tries it forces the relay. The caller can request this too. A free public TURN relay is added as a last-resort path (set your own `TURN_URLS`, or `TURN_FALLBACK=off`). The audio element is also re-started silently if the browser pauses it.
- **Upload voice (test mode):** panel under "Your phone". Upload ONE recording of a whole call (caller + receiver together). The server separates the two voices (ElevenLabs Scribe or Deepgram when their key is set; otherwise the recording is cut at its pauses and transcribed by API2), API3 decides who is the caller and who the receiver, and the words are fed to the call in step with the audio playing. API3 then scores the fraud confidence and chooses the moment of the voice alert exactly as in a live call. "Who is who" can be forced if API3 gets it wrong. Needs an API3 key plus an STT key. No fake data.
- **Alert timing:** manipulation (authority, urgency, fear) only raises the silent on-screen level. The VOICE alert is allowed only when the caller actually asks for confidential information (`asks_sensitive` / demand), on top of the 12 s / 4 turns floor.

## v28
Upload voice is now a single recording (no separate caller / receiver files).

## v29
Family bond and receiver compliance are now real measurements from API3 on every call (familiar or not). Familiar callers: family bond rises with the evidence, compliance shows how readily the receiver goes along, risk scores and alerts stay at zero. API3 is told the scale (0-100); a model answering 0-1 is understood too.

## v30
Fixed a stray closing tag (from v28) that broke the three-column Live call layout. Layout is identical to v21; the only addition is the Upload voice panel under Your phone.

## v31
Upload voice panel made compact (two selects side by side) so the Live call page has exactly the same height and layout as v27.
