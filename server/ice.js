// Builds the RTCPeerConnection `iceServers` list. TURN credentials never live in the frontend code.
import { createHmac } from 'node:crypto';
import { ICE } from './config.js';

export function iceServers() {
  const list = [{ urls: ICE.stun }];
  if (ICE.turnUrls.length) {
    if (ICE.turnSecret) {                                     // coturn REST-style ephemeral credentials
      const username = String(Math.floor(Date.now() / 1000) + ICE.ttl);
      const credential = createHmac('sha1', ICE.turnSecret).update(username).digest('base64');
      list.push({ urls: ICE.turnUrls, username, credential });
    } else if (ICE.turnUser) {
      list.push({ urls: ICE.turnUrls, username: ICE.turnUser, credential: ICE.turnCred });
    }
  }
  // Free public relay as a LAST-RESORT path when no TURN of your own is configured: used only if the direct path fails (client Wi-Fi isolation,
  // strict NAT, mobile data). Shared and rate-limited, so for real use set your own TURN_URLS. Disable with TURN_FALLBACK=off.
  if (!hasTurn() && (process.env.TURN_FALLBACK || 'on').toLowerCase() !== 'off') list.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });
  return list;
}
export const hasTurn = () => ICE.turnUrls.length > 0 && !!(ICE.turnSecret || ICE.turnUser);
