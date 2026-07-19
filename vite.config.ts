import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precache the app + the Manifold WASM so the tool works fully offline.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Crush Mold Builder',
        short_name: 'CrushMold',
        description:
          'Turn a part STL into a watertight, resin-printable crush mold — fully local in your browser.',
        theme_color: '#181b21',
        background_color: '#101216',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  // manifold-3d ships a prebuilt ESM + .wasm; let Vite handle it as an asset
  // rather than trying to pre-bundle the emscripten glue.
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  worker: {
    format: 'es',
  },
});
