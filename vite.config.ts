import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// BASE_PATH lets the same build be hosted at a sub-path (e.g. GitHub Pages: /Guitar-Trainer/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
