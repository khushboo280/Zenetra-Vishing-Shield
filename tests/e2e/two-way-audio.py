# End-to-end proof that BOTH sides receive audio: a real receiver page and a real caller page in Chromium (fake microphones),
# talking through the real server. Checks inbound RTP audio stats and that each side's <audio> element is actually playing.
# Run:  HTTPS=0 PORT=8799 node server/index.js &   then   python3 tests/e2e/two-way-audio.py
import sys, time, os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8799')
HOOK = "(()=>{const P=window.RTCPeerConnection;window.__pcs=[];window.RTCPeerConnection=function(...a){const p=new P(...a);window.__pcs.push(p);return p};window.RTCPeerConnection.prototype=P.prototype;})()"
STATS = """async()=>{const out={};for(const pc of window.__pcs){const r=await pc.getStats();r.forEach(s=>{if(s.type==='inbound-rtp'&&s.kind==='audio'){out.bytes=s.bytesReceived;out.packets=s.packetsReceived;out.energy=s.totalAudioEnergy||0;out.samples=s.totalSamplesReceived||0}});}
 out.audios=[...document.querySelectorAll('audio')].map(a=>({paused:a.paused,muted:a.muted,hasStream:!!a.srcObject,live:a.srcObject?a.srcObject.getAudioTracks().filter(t=>t.readyState==='live').length:0}));out.unlock=!!document.getElementById('audioUnlock');return out}"""
# BREAK=1 simulates a broken Web Audio bus on the receiver (encoder source silent): the watchdog must switch to the raw microphone
BREAK = os.environ.get('BREAK') == '1'
BREAK_JS = "(()=>{const c=AudioNode.prototype.connect;AudioNode.prototype.connect=function(t,...a){if(t&&t.constructor&&t.constructor.name==='MediaStreamAudioDestinationNode')return t;return c.call(this,t,...a)}})()"
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
    rc = b.new_context(permissions=['microphone']); cc = b.new_context(permissions=['microphone'])
    r = rc.new_page(); c = cc.new_page()
    for pg in (r, c): pg.add_init_script(HOOK)
    if BREAK: r.add_init_script(BREAK_JS)
    errs = []; r.on('pageerror', lambda e: errs.append('R ' + str(e))); c.on('pageerror', lambda e: errs.append('C ' + str(e)))
    r.goto(BASE + '/'); r.click('#bStart'); r.wait_for_function("/^[A-Z2-9]{4}$/.test(document.querySelector('#roomCode').textContent.trim())", timeout=15000)
    room = r.inner_text('#roomCode').strip(); print('room', room)
    c.goto(BASE + '/caller.html?room=' + room); c.click('#join')
    time.sleep(14 if BREAK else 9)
    rs, cs = r.evaluate(STATS), c.evaluate(STATS)
    print('chips receiver:', r.inner_text('#diag')[:200].replace(chr(10), ' | ')); print('chips caller:', c.inner_text('.caller-state').replace(chr(10), ' | '))
    print('receiver hears caller:', rs); print('caller hears receiver:', cs); print('page errors:', errs)
    ok = True
    for name, s in (('receiver', rs), ('caller', cs)):
        good = s.get('bytes', 0) > 2000 and s.get('energy', 0) > 0 and any((not a['paused']) and a['hasStream'] and a['live'] for a in s['audios'])
        print(name, 'OK' if good else 'FAIL'); ok &= good
    b.close(); sys.exit(0 if ok and not errs else 1)
