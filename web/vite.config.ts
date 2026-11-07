/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages (/repo-name/) and Firebase alike.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: { manualChunks: { maps: ['leaflet', 'react-leaflet'], charts: ['recharts'] } },
    },
  },
  server: { port: 5173, strictPort: true },
  test: { environment: 'node' },
});
