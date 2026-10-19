/**
 * Vite plugin: copies the model packs listed in models/manifest.json into <outDir>/models/packs,
 * so a static web host serves them from the same origin (the browser's download mirror; GitHub
 * release assets carry no CORS headers). Packs are never precached by the service worker.
 *
 * DITHER_WEB_PACKS=0 skips the copy (desktop builds fetch packs in Rust or bundle them as
 * resources). Packs missing from models/packs are reported; `pnpm models:pack` builds them.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

interface ManifestLike {
  packs: { id: string; file: string; size: number }[];
}

export function modelPacks(root: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'dither-model-packs',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    writeBundle() {
      if (process.env.DITHER_WEB_PACKS === '0') return;
      const manifest = JSON.parse(readFileSync(join(root, 'models/manifest.json'), 'utf8')) as ManifestLike;
      const dest = join(config.build.outDir, 'models/packs');
      mkdirSync(dest, { recursive: true });
      const missing: string[] = [];
      let copied = 0;
      for (const p of manifest.packs) {
        const src = join(root, 'models/packs', p.file);
        if (!existsSync(src) || statSync(src).size !== p.size) {
          missing.push(p.id);
          continue;
        }
        copyFileSync(src, join(dest, p.file));
        copied++;
      }
      config.logger.info(`model packs: ${copied} copied to models/packs${missing.length ? `; not built: ${missing.join(', ')}` : ''}`);
    }
  };
}
