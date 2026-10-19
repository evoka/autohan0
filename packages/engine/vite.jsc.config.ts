import { defineConfig } from 'vite';

// One self-contained script (engine + word data) for JavaScriptCore.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/host-jsc.ts',
      name: 'autohan0Engine',
      formats: ['iife'],
      fileName: () => 'autohan0-engine.js',
    },
    outDir: '../../apps/macos/Resources',
    emptyOutDir: false,
    target: 'es2020',
    minify: true,
    reportCompressedSize: false,
  },
});
