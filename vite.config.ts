import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// LTA DataMall sends no CORS headers, so a browser can't call it directly.
// It is only used for train-disruption alerts (bus arrivals come from
// arrivelah2.busrouter.sg, OneMap allows CORS). In dev/preview Vite forwards
// /datamall/* for us; a static deployment needs its own forwarder (see README).
const proxy = {
  '/datamall': {
    target: 'https://datamall2.mytransport.sg',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/datamall/, ''),
  },
};

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  test: { environment: 'node' },
});
