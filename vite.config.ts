import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: https://akari-ff14.github.io/castpage/
export default defineConfig({
  base: '/castpage/',
  plugins: [react()],
})
