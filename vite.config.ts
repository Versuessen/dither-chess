import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serviceWorker } from './tools/vite/serviceWorker.ts';
import { modelPacks } from './tools/vite/modelPacks.ts';
import { sourceArchive, SOURCE_ARCHIVE_PATH } from './tools/vite/sourceArchive.ts';
import { testHooks } from './tools/vite/testHooks.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * onnxruntime-web only uses WASM threads when the page is cross-origin isolated
 * (SharedArrayBuffer). These headers are set here for `vite dev` / `vite preview`, in vercel.json
 * for the website, by the service worker on static hosts that cannot set headers
 * (src/sw/sw-template.js), and by Tauri's security headers. tests/unit/hosting.test.ts keeps
 * vercel.json in step with this list.
 */
export const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

/**
 * Where the web build is served from: `/` by default (the website), or a sub-path for hosts that
 * serve the app below the domain root (DITHER_BASE). Routing is hash-based, so no server rewrites
 * are needed below the base.
 */
function base(): string {
  const b = process.env.DITHER_BASE?.trim();
  if (!b) return '/';
  return `/${b.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

/**
 * Packs the website installs by itself on the first visit: DITHER_PREINSTALL=all, or a
 * comma-separated list of pack ids from models/manifest.json. Default: none (the player installs
 * packs on the Models screen).
 */
function preinstall(): string[] {
  const v = process.env.DITHER_PREINSTALL?.trim();
  if (!v || v === 'none') return [];
  const packs = (JSON.parse(readFileSync(`${root}models/manifest.json`, 'utf8')) as { packs: { id: string; file: string }[] }).packs;
  if (v === 'all') return packs.map((p) => p.file);
  const ids = v.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !packs.some((p) => p.id === id));
  if (unknown.length) throw new Error(`DITHER_PREINSTALL: unknown pack ${unknown.join(', ')}; known: ${packs.map((p) => p.id).join(', ')}`);
  return packs.filter((p) => ids.includes(p.id)).map((p) => p.file);
}

const withSource = process.env.DITHER_SOURCE_ARCHIVE === '1';
const preinstalled = preinstall();

export default defineConfig({
  base: base(),
  define: {
    __DITHER_PREINSTALL__: JSON.stringify(preinstalled),
    __DITHER_SOURCE__: JSON.stringify(withSource ? SOURCE_ARCHIVE_PATH : null)
  },
  plugins: [
    svelte(),
    modelPacks(root, preinstalled),
    ...(withSource ? [sourceArchive(root)] : []),
    ...(process.env.DITHER_TEST_HOOKS === '1' ? [testHooks()] : []),
    serviceWorker(fileURLToPath(new URL('./src/sw/sw-template.js', import.meta.url)))
  ],
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
