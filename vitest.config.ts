import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src')
    }
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    server: {
      deps: {
        // Excalidraw imports its palette from JSON. Keep the package in Vite's
        // transform pipeline so Node never evaluates that JSON as bare ESM.
        inline: ['@excalidraw/excalidraw', 'open-color']
      }
    },
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}']
    }
  }
})
