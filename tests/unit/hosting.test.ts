import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { isolationHeaders } from '../../vite.config';
import { sourceFiles, tarGz } from '../../tools/vite/sourceArchive';

/** The website's hosting (vercel.json) and the source archive it serves. */

interface VercelConfig {
  buildCommand: string;
  outputDirectory: string;
  installCommand?: string;
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as VercelConfig;

describe('vercel.json', () => {
  it('sends the cross-origin isolation headers the dev and preview servers send, on every path', () => {
    const all = vercel.headers.find((h) => h.source === '/(.*)');
    const sent = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    for (const [k, v] of Object.entries(isolationHeaders)) expect(sent[k], k).toBe(v);
  });

  it('builds the website with every model preinstalled and the source archive, into dist', () => {
    expect(vercel.buildCommand).toMatch(/\bDITHER_PREINSTALL=all\b/);
    expect(vercel.buildCommand).toMatch(/\bDITHER_SOURCE_ARCHIVE=1\b/);
    expect(vercel.buildCommand).toMatch(/\bpnpm build$/);
    expect(vercel.outputDirectory).toBe('dist');
  });

  it("leaves the install to Vercel's lockfile detection (an install override would run pnpm 6)", () => {
    expect(vercel.installCommand).toBeUndefined();
  });

  it('never lets the service worker be cached, and caches only content-addressed files for long', () => {
    const cache = (source: string) => vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === 'Cache-Control')?.value;
    expect(cache('/sw.js')).toMatch(/max-age=0/);
    expect(cache('/assets/(.*)')).toMatch(/immutable/);
    expect(cache('/models/packs/(.*)')).toMatch(/immutable/);
    expect(vercel.headers.filter((h) => h.headers.some((x) => x.key === 'Cache-Control' && /immutable/.test(x.value))).map((h) => h.source)).toEqual([
      '/assets/(.*)',
      '/models/packs/(.*)'
    ]);
  });
});

/** Entries of a ustar archive: name (prefix joined), size, mode and content. */
function untar(gz: Buffer) {
  const buf = gunzipSync(gz);
  const out: { name: string; mode: number; data: Buffer }[] = [];
  let o = 0;
  const str = (a: number, n: number) => buf.toString('utf8', o + a, o + a + n).replace(/\0.*$/s, '');
  while (o + 512 <= buf.length && buf[o] !== 0) {
    const sum = [...buf.subarray(o, o + 512)].reduce((s, b, i) => s + (i >= 148 && i < 156 ? 32 : b), 0);
    expect(parseInt(str(148, 8), 8)).toBe(sum);
    expect(str(257, 6)).toBe('ustar');
    const prefix = str(345, 155);
    const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const size = parseInt(str(124, 12), 8);
    out.push({ name, mode: parseInt(str(100, 8), 8), data: buf.subarray(o + 512, o + 512 + size) });
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

describe('source archive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dither-src-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a valid gzipped ustar archive, long paths and executable bits included', () => {
    const long = `${'deep/'.repeat(30)}file-with-a-long-name.txt`;
    const files = { 'a.txt': 'hello\n', 'run.sh': '#!/bin/sh\necho hi\n', [long]: 'x'.repeat(1300), 'empty.txt': '' };
    for (const [f, c] of Object.entries(files)) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), c, { mode: f.endsWith('.sh') ? 0o755 : 0o644 });
    }
    const gz = tarGz(dir, Object.keys(files), 'top', 1_700_000_000);
    const entries = untar(gz);
    expect(entries.map((e) => e.name)).toEqual(Object.keys(files).map((f) => `top/${f}`));
    for (const e of entries) expect(e.data.toString()).toBe(files[e.name.slice(4)]);
    expect(entries.find((e) => e.name === 'top/run.sh')!.mode).toBe(0o755);
    expect(entries.find((e) => e.name === 'top/a.txt')!.mode).toBe(0o644);
    let tarList: string | null = null;
    try {
      writeFileSync(join(dir, 'out.tar.gz'), gz);
      tarList = execFileSync('tar', ['-tzf', join(dir, 'out.tar.gz')], { encoding: 'utf8' });
    } catch {
      tarList = null; // no tar on this machine: the parser above has checked the format
    }
    if (tarList !== null) expect(tarList.trim().split('\n')).toEqual(Object.keys(files).map((f) => `top/${f}`));
  });

  it('holds the repository source without packs, dependencies or build output', () => {
    const files = sourceFiles(new URL('../..', import.meta.url).pathname);
    for (const must of ['LICENSE', 'NOTICE', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'src/App.svelte', 'models/manifest.json', 'tools/models/pyproject.toml']) {
      expect(files, must).toContain(must);
    }
    expect(files.filter((f) => /^(node_modules|dist|models\/packs|\.git)\//.test(f) || f.includes('/node_modules/'))).toEqual([]);
  });
});
