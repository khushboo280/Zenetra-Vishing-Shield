# Connecting a real phone call

The dashboard needs only this from your telephony layer:

```js
import { startLiveCall } from './src/live/index.js';
startLiveCall(remoteStream,   // MediaStream with the CALLER's audio
              localStream,    // MediaStream with the RECEIVER's microphone
              { pc,           // the RTCPeerConnection (needed so the warning can replace the outgoing track)
                caller: { number: '+91 98•• •• 210', kind: 'unknown', label: 'Unknown number' } });
```

Everything else (waveforms, live transcript, scores, hold, warnings) follows from that one call.

## Way 1 · Browser caller page (built and tested)
What `npm run dev` gives you. The "caller" is `caller.html` in another tab, or on a phone.
- Same laptop: two tabs, headphones on.
- Phone on the same Wi-Fi: run `HTTPS=1 npm run dev`, open `https://<laptop-ip>:5173/caller.html?room=CODE` on the phone and accept the certificate warning (phones allow the microphone only on HTTPS).
- Phone on mobile data: expose the dev server with a tunnel (`ngrok http 5173` or `cloudflared tunnel --url http://localhost:5173`) and open the tunnel URL.
This is a WebRTC call, not a telephone call, but the whole protection path is identical.

## Way 2 · Softphone / SIP app on the phone -> WebRTC gateway (best fit for a real mobile)
Phone app (Linphone, Zoiper) or a SIP trunk -> **Asterisk / FreeSWITCH / Janus** with a WebRTC endpoint -> the dashboard registers as a browser SIP client (SIP.js or JsSIP).
The library gives you an `RTCPeerConnection`, so `startLiveCall(remote, local, { pc })` works unchanged, including mute + `replaceTrack` on hold.

## Way 3 · Real PSTN number with Twilio (or Exotel / Plivo)
Caller dials your number -> webhook returns TwiML `<Dial><Client>receiver</Client></Dial>` -> the **Twilio Voice JS SDK** rings the dashboard and hands you the call's streams (check the SDK docs for `getRemoteStream()` / `getLocalStream()`).
Caveat: the SDK does not expose the sender, so for the hold step do it **server-side**: add a `/api/hold` endpoint that updates the live call through the Twilio REST API (play your warning, or move the caller to a hold queue), and call it from `engageHold`. Not built or tested in this project.

## Way 4 · Server-side audio fork (no browser audio at all)
Telephony provider streams the call audio to your server (Twilio Media Streams, Exotel streaming) -> server sends it to Deepgram -> server pushes transcript events to the dashboard over WebSocket -> the dashboard calls `LiveCall.ingest(who, text, segFinal, turnEnd)` for each message. Hold/warning is again done through the provider's API. The older Python project (`vishing-shield/backend/app/bridge/twilio_bridge.py`) contains a skeleton of this route.

## Not recommended
Putting the phone on speaker next to the laptop: both voices arrive on one microphone, so caller and receiver cannot be told apart.
