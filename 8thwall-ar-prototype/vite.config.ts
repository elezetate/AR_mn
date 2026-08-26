import {defineConfig} from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 8080,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
