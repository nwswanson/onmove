import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

function copyExcalidrawFonts(): Plugin {
  return {
    name: 'copy-excalidraw-fonts',
    apply: 'build',
    writeBundle(options) {
      if (!options.dir) return
      cpSync(
        resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts'),
        resolve(options.dir, 'fonts'),
        { recursive: true }
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss(), copyExcalidrawFonts()]
  }
})
