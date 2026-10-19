/**
 * Vite plugin: after the build, writes dist/sw.js with a precache list of every emitted
 * file (app, public assets, onnxruntime wasm) and a content-derived version.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

// Not precached: source maps, the worker itself, model packs (OPFS holds them) and the source archive.
const EXCLUDE = [/\.map$/, /^sw\.js$/, /^models\//, /^source\//, /\.DS_Store$/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function serviceWorker(templatePath: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'dither-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const out = config.build.outDir;
      const files = walk(out)
        .map((f) => relative(out, f).split(sep).join('/'))
        .filter((f) => !EXCLUDE.some((re) => re.test(f)))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const version = hash.digest('hex').slice(0, 16);
      const precache = ['./', ...files.filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const sw = readFileSync(templatePath, 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache, null, 0));
      writeFileSync(join(out, 'sw.js'), sw);
      config.logger.info(`sw.js: ${precache.length} files precached, version ${version}`);
    }
  };
}
