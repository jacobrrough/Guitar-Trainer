import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// BASE_PATH lets the same build be hosted at a sub-path (e.g. GitHub Pages: /Guitar-Trainer/).
const base = process.env.BASE_PATH ?? '/'
// Shown in Settings, so it is plain which version a phone is running.
const buildId = `${new Date().toISOString().slice(0, 10)} · ${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)}`

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new service worker waits, so a deploy never reloads the page in the middle of a
      // song or a latency calibration ('autoUpdate' would reload as soon as an update is found).
      // src/app/appUpdate.ts decides when to switch: at launch, or when the learner taps "Update".
      registerType: 'prompt',
      // Everything under public/ (icons, Basic Pitch model) is already matched by globPatterns below.
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Guitar Trainer',
        short_name: 'Guitar Trainer',
        description: 'Free, open-source guitar trainer. Play along to your songs with adjustable difficulty, tune up and keep time.',
        id: '.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0f17',
        theme_color: '#0b0f17',
        categories: ['music', 'education'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // alphaTab (~1.3 MB) and the TensorFlow.js worker (~1.9 MB) exceed Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // mp3: the recorded guitar sample pack (public/samples), needed offline.
        globPatterns: ['**/*.{js,css,html,svg,png,json,bin,webmanifest,mp3}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // First install: take control of the open page so the app works offline without a second launch.
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The scoring simulations render and analyse whole performances: seconds each on a slow machine.
    testTimeout: 30_000,
  },
})
