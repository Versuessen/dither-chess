/**
 * Vite plugin: with DITHER_SOURCE_ARCHIVE=1, writes <outDir>/source/dither-source.tar.gz, the
 * source of this build, and the app links to it (Settings → Source code). DITHER is AGPL-3.0 and
 * contains GPL-3.0 and AGPL-3.0 code (chessground, fastelo's and Maia-3's encodings, fastelo's
 * Rater), so everyone who uses the website is entitled to its Corresponding Source, also when the
 * repository it is built from is private.
 *
 * The archive holds the repository's files (`git ls-files` when the build runs in a Git checkout,
 * otherwise the source tree minus the paths .gitignore excludes), without the model packs, which
 * the website serves itself under models/packs/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';

export const SOURCE_ARCHIVE_PATH = 'source/dither-source.tar.gz';
const TOP = 'dither-source';

/** Never in the archive: dependencies, build output, local work, packs, version control. */
const SKIP = [
  /^\.git(\/|$)/,
  /^\.vercel(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /^dist(-[^/]*)?(\/|$)/,
  /^dist-ssr(\/|$)/,
  /^coverage(\/|$)/,
  /^test-results(\/|$)/,
  /^playwright-report[^/]*(\/|$)/,
  /^blob-report(\/|$)/,
  /^src-tauri\/target(\/|$)/,
  /^src-tauri\/gen\/schemas(\/|$)/,
  /^tools\/[^/]+\/(work|\.venv|reports\/tmp)(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.pytest_cache(\/|$)/,
  /\.egg-info(\/|$)/,
  /^packaging\/linux\/out(\/|$)/,
  /^models\/packs\//,
  /(^|\/)\.DS_Store$/,
  /\.local$/
];

function walk(root: string, dir = root): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    const rel = relative(root, p).split(sep).join('/');
    if (SKIP.some((re) => re.test(rel))) return [];
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return [];
    return st.isDirectory() ? walk(root, p) : [rel];
  });
}

/** The files that make up the source: tracked files in a Git checkout, the filtered tree otherwise. */
export function sourceFiles(root: string): string[] {
  let files: string[];
  try {
    files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean);
    if (!files.length) throw new Error('no tracked files');
  } catch {
    files = walk(root);
  }
  return files.filter((f) => !SKIP.some((re) => re.test(f)) && existsSync(join(root, f)) && lstatSync(join(root, f)).isFile()).sort();
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, mode: number, mtime: number): Buffer {
  const h = Buffer.alloc(512, 0);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    // ustar: split at the first slash that leaves a name of at most 100 bytes; the part before it
    // (the prefix) may have at most 155.
    let i = name.indexOf('/');
    while (i !== -1 && Buffer.byteLength(name.slice(i + 1)) > 100) i = name.indexOf('/', i + 1);
    if (i === -1 || Buffer.byteLength(name.slice(0, i)) > 155) throw new Error(`path too long for a tar archive: ${name}`);
    prefix = name.slice(0, i);
    base = name.slice(i + 1);
  }
  h.write(base, 0, 100, 'utf8');
  h.write(octal(mode, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtime, 12), 136, 12, 'ascii');
  h.fill(0x20, 148, 156);
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 8, 'ascii');
  return h;
}

/** A gzipped ustar archive of `files` (paths relative to `root`) under the folder `top`. */
export function tarGz(root: string, files: readonly string[], top: string, mtime = Math.floor(Date.now() / 1000)): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const data = readFileSync(join(root, f));
    const executable = (lstatSync(join(root, f)).mode & 0o111) !== 0;
    parts.push(header(`${top}/${f}`, data.length, executable ? 0o755 : 0o644, mtime), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function sourceArchive(root: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'dither-source-archive',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    writeBundle() {
      const files = sourceFiles(root);
      const out = join(config.build.outDir, SOURCE_ARCHIVE_PATH);
      mkdirSync(join(out, '..'), { recursive: true });
      const gz = tarGz(root, files, TOP);
      writeFileSync(out, gz);
      config.logger.info(`source archive: ${files.length} files, ${(gz.length / 1e6).toFixed(1)} MB at ${SOURCE_ARCHIVE_PATH}`);
    }
  };
}
