import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { serviceWorker } from './tools/vite/serviceWorker.ts';

/**
 * onnxruntime-web only uses WASM threads when the page is cross-origin isolated
 * (SharedArrayBuffer). These two headers are set here for `vite dev` / `vite preview`,
 * by the service worker for static hosting (src/sw/sw-template.js) and by Tauri's security headers.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

export default defineConfig({
  plugins: [svelte(), serviceWorker(fileURLToPath(new URL('./src/sw/sw-template.js', import.meta.url)))],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    headers: isolationHeaders
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: isolationHeaders
  },
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true
  }
});
