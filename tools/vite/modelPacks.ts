/**
 * Vite plugin: copies the model packs listed in models/manifest.json into <outDir>/models/packs,
 * so a static web host serves them from the same origin (the isolated page cannot rely on
 * cross-origin downloads). Packs are never precached by the service worker.
 *
 * Desktop builds skip the copy (the Tauri CLI sets TAURI_ENV_PLATFORM for its build command):
 * packs are downloaded in Rust, or bundled as resources by the full-offline variant. Setting
 * DITHER_WEB_PACKS=0 skips it too. Packs missing from models/packs are reported (`pnpm
 * models:fetch` gets them); a missing pack the build preinstalls (DITHER_PREINSTALL) fails the build,
 * since the website would otherwise promise a model it cannot install.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

interface ManifestLike {
  packs: { id: string; file: string; size: number }[];
}

export function modelPacks(root: string, preinstalled: readonly string[] = []): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'dither-model-packs',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    writeBundle() {
      if (process.env.TAURI_ENV_PLATFORM) return;
      if (process.env.DITHER_WEB_PACKS === '0') {
        if (preinstalled.length) throw new Error('DITHER_PREINSTALL needs the packs in the build; unset DITHER_WEB_PACKS=0');
        return;
      }
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
      const required = manifest.packs.filter((p) => preinstalled.includes(p.file) && missing.includes(p.id));
      if (required.length) {
        throw new Error(`model packs ${required.map((p) => p.id).join(', ')} are preinstalled by this build but missing from models/packs (pnpm models:fetch)`);
      }
      config.logger.info(
        `model packs: ${copied} copied to models/packs${missing.length ? `; not built: ${missing.join(', ')}` : ''}` +
          (preinstalled.length ? `; the website installs ${preinstalled.length} by itself` : '')
      );
    }
  };
}
