import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Use predictable filenames for easy loading in VS Code webview
        entryFileNames: `assets/index.js`,
        chunkFileNames: `assets/index.js`,
        assetFileNames: `assets/index.css`
      }
    }
  }
})