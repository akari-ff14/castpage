import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: https://<user>.github.io/ff14-akari-castpage/
export default defineConfig({
  base: '/ff14-akari-castpage/',
  plugins: [react()],
})
