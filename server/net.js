// LAN addresses + a self-signed HTTPS certificate (phones only allow the microphone on HTTPS).
import os from 'node:os';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { join } from 'node:path';
import selfsigned from 'selfsigned';

export function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  // prefer typical home / office ranges first
  return out.sort((a, b) => (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(b) ? 1 : 0) - (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a) ? 1 : 0));
}
export async function makeServer(app, root) {
  if (process.env.HTTPS === '0') return { server: http.createServer(app), secure: false };
  const dir = join(root, '.certs'), kf = join(dir, 'key.pem'), cf = join(dir, 'cert.pem'), ips = lanIPs(), stamp = join(dir, 'ips.txt');
  let reuse = false; try { reuse = fs.existsSync(kf) && fs.existsSync(cf) && fs.readFileSync(stamp, 'utf8') === ips.join(',') && Date.now() - fs.statSync(cf).mtimeMs < 300 * 864e5; } catch (e) {}
  if (!reuse) {
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'vishing-shield.local' }], {
      days: 365, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))] }],
    });
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(kf, pems.private); fs.writeFileSync(cf, pems.cert); fs.writeFileSync(stamp, ips.join(','));
  }
  return { server: https.createServer({ key: fs.readFileSync(kf), cert: fs.readFileSync(cf) }, app), secure: true };
}
