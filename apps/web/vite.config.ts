import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5178, strictPort: true },
  preview: { port: 5179, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
