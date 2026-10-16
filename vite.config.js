import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const API = process.env.API_URL || 'https://localhost:8787';

export default defineConfig(async () => {
  const plugins = [];
  // Phones only allow the microphone on HTTPS pages. `HTTPS=1 npm run dev` serves a self-signed certificate.
  if (process.env.HTTPS === '1') plugins.push((await import('@vitejs/plugin-basic-ssl')).default());
  return {
    plugins,
    server: {
      port: 5173,
      host: true,                                   // reachable from your phone on the same Wi-Fi
      proxy: { '/api': { target: API, secure: false }, '/socket.io': { target: API, ws: true, secure: false } },
    },
    build: { rollupOptions: { input: { main: resolve(here, 'index.html'), caller: resolve(here, 'caller.html') } } },
  };
});
