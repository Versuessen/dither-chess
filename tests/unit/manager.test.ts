import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MANIFEST, type ManifestPack } from '../../src/models/manifest';
import type { Progress, StoredPack } from '../../src/models/store';

/**
 * The Model Manager's install queue (packs a website preinstalls, or a full-offline desktop
 * build ships), with a fake store standing in for OPFS.
 */

const log: string[] = [];
let active = 0;
let maxActive = 0;
let release: (() => void) | null = null;

vi.mock('../../src/storage', () => ({
  storage: () => ({ getSetting: async () => null, setSetting: async () => undefined })
}));

vi.mock('../../src/models/opfs', () => ({
  OpfsStore: class {
    readonly kind = 'opfs';
    static supported() {
      return true;
    }
    async list(): Promise<StoredPack[]> {
      return [];
    }
    async bundled(): Promise<string[]> {
      return MANIFEST.packs.map((p) => p.file);
    }
    async install(pack: ManifestPack, _urls: string[], onProgress: (p: Progress) => void): Promise<StoredPack> {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(pack.id);
      onProgress({ phase: 'download', done: pack.size / 2, total: pack.size });
      if (release === null) await new Promise<void>((r) => (release = r));
      onProgress({ phase: 'download', done: pack.size, total: pack.size });
      onProgress({ phase: 'verify', done: pack.size, total: pack.size });
      active--;
      return { id: pack.id, version: pack.version, file: pack.file, sha256: pack.sha256, size: pack.size, verifiedAt: '' };
    }
    async verify() {
      return true;
    }
  }
}));

async function fresh() {
  vi.resetModules();
  // Pack sources are resolved against the page's address, as in the browser.
  vi.stubGlobal('location', new URL('https://dither.test/'));
  log.length = 0;
  active = 0;
  maxActive = 0;
  release = null;
  const { manager } = await import('../../src/models/manager.svelte');
  const { models } = await import('../../src/models/state.svelte');
  await manager.init();
  return { manager, models };
}

/** Let every pending install run to the end. */
function releaseAll() {
  const r = release;
  release = () => undefined;
  r?.();
}

describe('model install queue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('queues the packs that come with the app, any optional ones last', async () => {
    const { manager } = await fresh();
    const optional = MANIFEST.packs.filter((p) => p.optional).map((p) => p.id);
    expect(manager.queued).toHaveLength(MANIFEST.packs.length);
    if (optional.length) expect(manager.queued.slice(-optional.length)).toEqual(optional);
    for (const p of MANIFEST.packs) expect(manager.availability(p.family).kind).toBe('queued');
  });

  it('installs them one at a time and reports progress for the first game', async () => {
    const { manager, models } = await fresh();
    const first = manager.queued[0]!;
    const fractions: number[] = [];
    const preloader = manager.install(first, (f) => fractions.push(f));
    await vi.waitFor(() => expect(log).toEqual([first]));
    const family = MANIFEST.packs.find((p) => p.id === first)!.family;
    const busy = manager.availability(family);
    expect(busy.kind).toBe('busy');
    if (busy.kind === 'busy') expect(busy.fraction).toBeCloseTo(0.5);
    releaseAll();
    await preloader;
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
    expect(manager.availability(family).kind).toBe('ready');

    await manager.installQueued();
    expect(maxActive).toBe(1);
    expect(log).toHaveLength(MANIFEST.packs.length);
    expect(manager.queued).toEqual([]);
    expect(models.installed.map((p) => p.id).sort()).toEqual(MANIFEST.packs.map((p) => p.id).sort());
  });

  it('does not stall when the player installs a queued pack by hand meanwhile', async () => {
    const { manager } = await fresh();
    const last = manager.queued.at(-1)!;
    const byHand = manager.install(last);
    const drain = manager.installQueued();
    releaseAll();
    await Promise.all([byHand, drain]);
    expect(manager.queued).toEqual([]);
    expect(new Set(log).size).toBe(log.length);
    expect(log).toHaveLength(MANIFEST.packs.length);
  });
});
