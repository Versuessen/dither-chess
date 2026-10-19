/**
 * Make sure models/packs holds exactly the packs models/manifest.json pins: each file's size and
 * SHA-256 is checked, and a missing or wrong one is downloaded from the manifest's remote sources
 * (the website, then the repository at tag models-v<version>). The packs are committed, so in a
 * full checkout this only verifies them; the GitHub Pages build and the CI test and installer jobs
 * run it so all of them ship exactly the pinned packs. `pnpm models:all` rebuilds packs from the
 * pinned upstream weights instead.
 *
 *   node tools/packs/fetch.ts [pack-id ...]
 *
 * DITHER_PACK_SOURCES (comma-separated base URLs) overrides the manifest's remote sources.
 * Behind an HTTPS proxy, run with NODE_USE_ENV_PROXY=1 (Node's fetch ignores HTTPS_PROXY otherwise).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

interface Pack {
  id: string;
  file: string;
  size: number;
  sha256: string;
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'models/manifest.json'), 'utf8')) as { sources: string[]; packs: Pack[] };
const dest = join(root, 'models/packs');

const sources = (process.env.DITHER_PACK_SOURCES?.split(',') ?? manifest.sources)
  .map((s) => s.trim())
  .filter((s) => /^https?:\/\//.test(s))
  .map((s) => (s.endsWith('/') ? s : `${s}/`));

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function valid(path: string, pack: Pack): Promise<boolean> {
  return existsSync(path) && statSync(path).size === pack.size && (await sha256(path)) === pack.sha256;
}

async function download(url: string, part: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(part));
}

async function fetchPack(pack: Pack): Promise<void> {
  const path = join(dest, pack.file);
  if (await valid(path, pack)) {
    console.log(`${pack.file}: present, sha256 ok`);
    return;
  }
  const part = `${path}.part`;
  const errors: string[] = [];
  for (const base of sources) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await download(base + pack.file, part);
        if (!(await valid(part, pack))) throw new Error('size or SHA-256 does not match the manifest');
        renameSync(part, path);
        console.log(`${pack.file}: ${(pack.size / 1e6).toFixed(1)} MB from ${base}, sha256 ok`);
        return;
      } catch (err) {
        rmSync(part, { force: true });
        errors.push(`${base} (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
        if (String(err).includes('SHA-256')) break;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw new Error(`${pack.file} could not be fetched:\n  ${errors.join('\n  ')}`);
}

const only = process.argv.slice(2);
const wanted = only.length ? manifest.packs.filter((p) => only.includes(p.id)) : manifest.packs;
if (only.length && wanted.length !== only.length) {
  const known = manifest.packs.map((p) => p.id).join(', ');
  throw new Error(`unknown pack id in ${only.join(', ')}; the manifest has ${known}`);
}
if (!sources.length) throw new Error('models/manifest.json lists no remote source (and DITHER_PACK_SOURCES is not set)');
mkdirSync(dest, { recursive: true });
for (const pack of wanted) await fetchPack(pack);
