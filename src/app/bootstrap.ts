/**
 * Start-up work behind the preloader: storage, settings, the model packs and the inference
 * worker. Packs are verified once per session; the most recently used one is verified and
 * loaded before the preloader ends so the first game starts at once. On a website that installs
 * its models by itself, that pack is downloaded first (the preloader shows its progress) and the
 * others follow in the background.
 */
import { boot } from './boot.svelte';
import { isCrossOriginIsolated, platform } from './platform';
import { settings } from './settings.svelte';
import { openStorage, storage } from '../storage';
import { manager } from '../models/manager.svelte';
import { models } from '../models/state.svelte';
import { inference } from '../inference/client';
import { loadPack } from '../inference/opponents';
import { packById } from '../models/manifest';
import { finishUnfinished, onGameFinished } from '../game/finalize';
import { quality } from '../rating/quality.svelte';
import { rating } from '../rating/rating.svelte';
import { loadPrefs } from '../chess/setup';

export function startBoot(): void {
  // After every finished game: the rating ledger (awaited, so the result panel can show the new
  // rating), then the move-quality estimate in the background.
  onGameFinished((g) => rating.record(g));
  onGameFinished((g) => {
    void quality.run(storage(), g);
  });

  const ready = boot.track(
    'storage',
    (async () => {
      await openStorage();
      await settings.load();
      await rating.load(storage());
      await manager.init();
      await finishUnfinished(storage());
    })().finally(() => {
      boot.dataReady = true;
    }),
    2
  );

  boot.track(
    'inference',
    ready.then(async () => {
      await inference.init();
      // Warm the model of the family played last: installed, or queued to install by itself.
      const family = loadPrefs().family;
      // Same preference as models.packFor: calibrated levels first, then the high-quality pack.
      const rank = (id: string) => ((packById(id)?.calibration.levels.length ?? 0) > 0 ? 2 : 0) + (packById(id)?.optional ? 1 : 0);
      const queued = manager.queued.flatMap((id) => {
        const p = packById(id);
        return p ? [{ id, family: p.family }] : [];
      });
      const candidates = [...manager.installedIds(), ...queued].sort((a, b) => rank(b.id) - rank(a.id));
      const id = candidates.find((x) => x.family === family)?.id ?? candidates[0]?.id;
      if (id) {
        if (manager.queued.includes(id)) await manager.install(id, (f) => boot.partial('inference', f));
        await manager.ensureVerified(id);
        await loadPack(id);
      }
    }),
    3
  );

  // Everything else is installed and verified quietly after the preloader.
  void ready
    .then(() => boot.ready())
    .then(() => {
      void reportBoot();
      void manager.installQueued();
      return manager.verifyInstalled();
    });
  void models;
}

/**
 * Desktop smoke test (DITHER_SMOKE=<file>, see src-tauri/src/lib.rs): tell the shell what came
 * up, so an installed build can be checked without a person looking at it.
 */
async function reportBoot(): Promise<void> {
  if (platform() !== 'tauri') return;
  const { emit } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  const init = await inference.init().catch(() => null);
  // With DITHER_SMOKE_PACKS=<url of a pack directory>, also install fastelo through the Rust
  // store (download, SHA-256, move into place), load it and run one forward pass.
  let model: Record<string, unknown> | null = null;
  const packs = await invoke<string | null>('smoke_packs').catch(() => null);
  if (packs) {
    const id = 'fastelo-7m';
    try {
      await manager.setSources([packs]);
      await manager.install(id);
      const status = manager.status[id];
      if (status?.kind !== 'installed') throw new Error(`install: ${JSON.stringify(status)}`);
      await loadPack(id);
      const r = await inference.evaluate(id, ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'], 1500, 1500);
      model = { id, installed: true, legalMoves: r.uci.length, inferenceMs: Math.round(r.inferenceMs) };
    } catch (err) {
      model = { id, error: err instanceof Error ? err.message : String(err) };
    }
  }
  await emit('dither-booted', {
    model,
    storage: storage().kind,
    crossOriginIsolated: isCrossOriginIsolated(),
    secureContext: globalThis.isSecureContext === true,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    origin: location.origin,
    inference: init,
    modelStore: manager.storeKind,
    errors: boot.errors
  });
}
