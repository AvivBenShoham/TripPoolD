import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves a project site under /<repo>/, so the deploy workflow sets
  // BASE_PATH=/TripPoolD/. Local dev and Firebase Hosting both serve from the root.
  base: process.env.BASE_PATH ?? '/',
  // strictPort so a stale server on 5173 fails loudly instead of the dev server quietly
  // moving to another port while tests keep hitting the old one.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // The 50m atlas is only needed when the location picker resolves a pin.
          // Keeping it out of the entry chunk is the whole point of the lazy import.
          if (id.includes('countries-50m')) return 'atlas-50m';
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          return undefined;
        },
      },
    },
  },
});
