/**
 * Model Manager: what is installed and verified, downloads, imports, removal. The only writer
 * of `models` (state.svelte.ts). A pack is usable only after its full SHA-256 matched the
 * manifest in this session (at install, import, or the background check at start-up).
 */
import { platform } from '../app/platform';
import { storage } from '../storage';
import { MANIFEST, packById, packForChecksum, resolveSource, type ManifestPack } from './manifest';
import { models } from './state.svelte';
import { OpfsStore } from './opfs';
import { Dpk } from './dpk';
import type { ModelFamily } from './catalog';
import type { ModelStore, Progress, StoredPack } from './store';

export type PackStatus =
  | { kind: 'absent' }
  | { kind: 'downloading' | 'verifying' | 'importing'; done: number; total: number }
  | { kind: 'installed'; verified: boolean }
  | { kind: 'error'; message: string };

/** What stands between a model family and a game. */
export type Availability =
  | { kind: 'ready' }
  | { kind: 'busy'; phase: 'downloading' | 'verifying' | 'importing'; fraction: number }
  | { kind: 'queued' }
  | { kind: 'absent' };

const SOURCES_KEY = 'model-sources';

class ModelManager {
  status = $state<Record<string, PackStatus>>({});
  sources = $state<string[]>([...MANIFEST.sources]);
  storeKind = $state<'opfs' | 'tauri' | 'none'>('none');
  /**
   * Packs that install by themselves, in order: those the website preinstalls (DITHER_PREINSTALL)
   * or the desktop full-offline build ships. Boot installs the first game's pack behind the
   * preloader and the rest right after (installQueued).
   */
  queued = $state<string[]>([]);
  private draining: Promise<void> | null = null;
  private store: ModelStore | null = null;
  private stored = new Map<string, StoredPack>();
  private verified = new Set<string>();
  private aborts = new Map<string, AbortController>();
  private installing = new Map<string, Promise<void>>();

  async init(): Promise<void> {
    if (platform() === 'tauri') {
      const { TauriStore } = await import('./tauriStore');
      this.store = new TauriStore();
      this.storeKind = 'tauri';
    } else if (OpfsStore.supported()) {
      this.store = new OpfsStore(__DITHER_PREINSTALL__);
      this.storeKind = 'opfs';
    } else {
      this.storeKind = 'none';
    }
    const custom = await storage().getSetting<string[]>(SOURCES_KEY);
    if (custom?.length) this.sources = custom;
    for (const p of MANIFEST.packs) this.status[p.id] = { kind: 'absent' };
    if (!this.store) return;
    for (const s of await this.store.list()) {
      const pack = packById(s.id);
      // A stored pack that is not the manifest's current version stays on disk but is not offered.
      if (!pack || pack.sha256 !== s.sha256) continue;
      this.stored.set(s.id, s);
      this.status[s.id] = { kind: 'installed', verified: false };
    }
    this.publish();
    // Calibrated packs before the optional high-quality one, otherwise in manifest order.
    const bundled = new Set((await this.store.bundled?.()) ?? []);
    this.queued = MANIFEST.packs
      .filter((p) => bundled.has(p.file) && !this.stored.has(p.id))
      .sort((a, b) => Number(!!a.optional) - Number(!!b.optional))
      .map((p) => p.id);
  }

  /** Install every queued pack, one after another (failures stay visible on the Models screen). */
  installQueued(): Promise<void> {
    this.draining ??= (async () => {
      while (this.queued.length) await this.install(this.queued[0]!);
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  availability(family: ModelFamily): Availability {
    if (models.packFor(family)) return { kind: 'ready' };
    const ids = MANIFEST.packs.filter((p) => p.family === family).map((p) => p.id);
    for (const id of ids) {
      const s = this.status[id];
      if (s && (s.kind === 'downloading' || s.kind === 'verifying' || s.kind === 'importing')) {
        return { kind: 'busy', phase: s.kind, fraction: s.total ? s.done / s.total : 0 };
      }
    }
    return ids.some((id) => this.queued.includes(id)) ? { kind: 'queued' } : { kind: 'absent' };
  }

  /** Verify every installed pack once per session, in the background. */
  async verifyInstalled(): Promise<void> {
    for (const id of [...this.stored.keys()]) await this.ensureVerified(id).catch(() => undefined);
  }

  async ensureVerified(id: string): Promise<StoredPack> {
    const s = this.stored.get(id);
    const pack = packById(id);
    if (!s || !pack || !this.store) throw new Error('This model pack is not installed.');
    if (this.verified.has(id)) return s;
    this.status[id] = { kind: 'verifying', done: 0, total: pack.size };
    const ok = await this.store.verify(pack, (p) => this.progress(id, p));
    if (!ok) {
      this.status[id] = { kind: 'error', message: 'The stored pack no longer matches its checksum. Remove it and install again.' };
      this.publish();
      throw new Error(`${pack.title} failed verification`);
    }
    this.verified.add(id);
    this.status[id] = { kind: 'installed', verified: true };
    this.publish();
    return s;
  }

  /** Installed packs (verified or not yet), with their family. */
  installedIds(): { id: string; family: ManifestPack['family'] }[] {
    return [...this.stored.keys()].flatMap((id) => {
      const p = packById(id);
      return p ? [{ id, family: p.family }] : [];
    });
  }

  isUsable(id: string): boolean {
    return this.verified.has(id);
  }

  /**
   * Download (or copy a bundled pack), verify and record. A second call while one runs joins it
   * (its `onProgress` is then not called). Never rejects: a failure is recorded in `status`.
   * `onProgress` gets the overall fraction done, download and check together.
   */
  install(id: string, onProgress?: (fraction: number) => void): Promise<void> {
    if (this.queued.includes(id)) this.queued = this.queued.filter((x) => x !== id);
    let p = this.installing.get(id);
    if (!p) {
      p = this.runInstall(id, onProgress).finally(() => this.installing.delete(id));
      this.installing.set(id, p);
    }
    return p;
  }

  private async runInstall(id: string, onProgress?: (fraction: number) => void): Promise<void> {
    const pack = packById(id);
    if (!pack || !this.store) return;
    const ctrl = new AbortController();
    this.aborts.set(id, ctrl);
    this.status[id] = { kind: 'downloading', done: 0, total: pack.size };
    try {
      const urls = this.sources.map((s) => resolveSource(s, pack.file));
      const stored = await this.store.install(
        pack,
        urls,
        (p) => {
          this.progress(id, p);
          const f = p.total ? p.done / p.total : 0;
          onProgress?.(p.phase === 'verify' ? 0.85 + 0.15 * f : 0.85 * f);
        },
        ctrl.signal
      );
      this.stored.set(id, stored);
      this.verified.add(id);
      this.status[id] = { kind: 'installed', verified: true };
    } catch (err) {
      this.status[id] = ctrl.signal.aborted
        ? { kind: 'absent' }
        : { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    } finally {
      this.aborts.delete(id);
      this.publish();
    }
  }

  cancel(id: string): void {
    this.aborts.get(id)?.abort();
  }

  /** Install from a pack file the user picked (machines without internet). */
  async importFile(file: File): Promise<ManifestPack> {
    if (!this.store) throw new Error('This browser cannot store model packs.');
    const pack = MANIFEST.packs.find((p) => p.file === file.name) ?? MANIFEST.packs.find((p) => p.size === file.size);
    if (!pack) throw new Error(`${file.name} is not one of the known model packs.`);
    this.status[pack.id] = { kind: 'importing', done: 0, total: file.size };
    try {
      const stored = await this.store.importFile(file, pack, (p) => this.progress(pack.id, p));
      if (!packForChecksum(stored.sha256)) throw new Error('The imported pack is not in the model list.');
      this.stored.set(pack.id, stored);
      this.verified.add(pack.id);
      this.status[pack.id] = { kind: 'installed', verified: true };
      return pack;
    } catch (err) {
      this.status[pack.id] = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
      throw err;
    } finally {
      this.publish();
    }
  }

  async remove(id: string): Promise<void> {
    if (!this.store) return;
    await this.store.remove(id);
    this.stored.delete(id);
    this.verified.delete(id);
    this.status[id] = { kind: 'absent' };
    this.publish();
  }

  async setSources(list: string[]): Promise<void> {
    const clean = list.map((s) => s.trim()).filter(Boolean);
    this.sources = clean.length ? clean : [...MANIFEST.sources];
    await storage().setSetting(SOURCES_KEY, clean.length ? clean : null);
  }

  async openPack(id: string) {
    const s = await this.ensureVerified(id);
    return Dpk.open(await this.store!.open(s));
  }

  private progress(id: string, p: Progress): void {
    const kind = p.phase === 'download' ? 'downloading' : p.phase === 'verify' ? 'verifying' : 'importing';
    this.status[id] = { kind, done: p.done, total: p.total };
  }

  /** Mirror installed + verified packs into the reactive model state. */
  private publish(): void {
    models.installed = [...this.stored.values()]
      .map((s) => packById(s.id))
      .filter((p): p is ManifestPack => !!p && this.verified.has(p.id))
      .map((p) => ({ id: p.id, family: p.family, version: p.version, sha256: p.sha256, levels: p.calibration.levels }));
  }
}

export const manager = new ModelManager();
