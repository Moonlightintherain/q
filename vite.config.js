import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'server/public',  // собирать сразу в public у сервера
    emptyOutDir: true
  }
})