import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The browser only calls our own /api/*; Vite proxies it to the Express server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
