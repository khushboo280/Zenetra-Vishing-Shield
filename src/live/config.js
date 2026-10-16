// Live-call configuration. Change values here (or call configure() from your own code).
const env = (import.meta.env || {});
const origin = env.VITE_BACKEND || (typeof location !== 'undefined' ? location.origin : '');

export const api = (p) => origin + p;
export const wsUrl = (p) => origin.replace(/^http/, 'ws') + p;
export const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

export const CONFIG = {
  spoofScorer: null,              // optional async (Float32Array pcm16k, caller) => 0..100 synthetic-voice probability
  spoofEveryMs: 2500,
  vadThreshold: 0.012,            // RMS above this = speaking
  vadHangMs: 300,
  playRemote: true,               // play the caller's audio on the receiver's speakers
  hangupOnEnd: true,              // pc.close() when the receiver presses "End call"
};

export function configure(o = {}) {
  for (const k of ['spoofScorer', 'spoofEveryMs', 'vadThreshold', 'vadHangMs', 'playRemote', 'hangupOnEnd']) if (k in o) CONFIG[k] = o[k];
  return CONFIG;
}
