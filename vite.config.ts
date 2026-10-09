/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import paket from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Neue Versionen werden nicht ungefragt aktiviert – die App zeigt einen Hinweis (UpdateHinweis.tsx).
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'Truhenblick',
        short_name: 'Truhenblick',
        description: 'Zeigt auf einen Blick, was wo in der Gefriertruhe liegt.',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0a67a8',
        // Startbildschirm: Logo auf seiner eigenen Farbe – passt im hellen wie im dunklen Modus.
        background_color: '#0a67a8',
        categories: ['food', 'utilities', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Artikel einlagern',
            short_name: 'Einlagern',
            url: '/#/neu',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Bald verbrauchen',
            short_name: 'Bald fällig',
            url: '/#/bald',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        // Das Sync-Backend liegt unter /api und darf nie aus dem Cache beantwortet werden.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(paket.version),
  },
  test: {
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts'],
  },
});
