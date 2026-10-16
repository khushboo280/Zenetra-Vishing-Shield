// The dashboard (ui/app.js) plugs its DOM-side callbacks in here; the live modules never touch the DOM.
export const B = {
  wbuf: null,                     // { caller: number[], receiver: number[] } painted by drawWave()
  getCfg: () => ({}),
  onEvents() {},                  // tick / level / end events
  syncTranscript() {},            // repaint #msgs
  onStart() {},                   // a LiveCall began
  notify() {},                    // (message, level 0|1|2)
  onAIStatus() {},
  onSTTStatus() {},               // (ok, message, engine) speech-to-text healthy?                // (ok, message) AI reachable?
};
export function bind(h) { Object.assign(B, h); }
