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
import { defaultPack } from '../models/manifest';
import { finishUnfinished, onGameFinished } from '../game/finalize';
import { rating } from '../rating/rating.svelte';

export function startBoot(): void {
  // After every finished game: the rating ledger (awaited, so the result panel can show the new rating).
  onGameFinished((g) => rating.record(g));

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
      // Warm the model: installed, or queued to install by itself (the website installs it).
      const id = defaultPack('maia3')?.id;
      const have = !!id && (manager.installedIds().some((x) => x.id === id) || manager.queued.includes(id));
      if (id && have) {
        if (manager.queued.includes(id)) await manager.install(id, (f) => boot.partial('inference', f));
        await manager.ensureVerified(id);
        await loadPack(id);
      }
    }),
    3
  );

  // Desktop smoke test: report progress while starting, so a stalled start says where it stalled.
  const stopProgress = platform() === 'tauri' ? reportProgress() : () => undefined;

  // Everything else is installed and verified quietly after the preloader.
  void ready
    .then(() => boot.ready())
    .then(() => {
      void reportBoot().finally(stopProgress);
      void manager.installQueued();
      return manager.verifyInstalled();
    });
  void models;
}

/**
 * Desktop smoke test: every 2 s until the boot report, where start-up stands (tasks, model packs,
 * install queue). The shell keeps the last one and writes it if start-up times out
 * (src-tauri/src/smoke.rs); outside a smoke test nothing listens. Returns the stop function.
 */
function reportProgress(): () => void {
  const send = async () => {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('dither-boot-progress', { ...boot.snapshot(), packs: manager.status, queued: manager.queued, at: new Date().toISOString() });
  };
  const timer = setInterval(() => void send().catch(() => undefined), 2000);
  return () => clearInterval(timer);
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
  // With DITHER_SMOKE_PACKS=<url of a pack directory>, also install the model through the Rust
  // store (download, SHA-256, move into place), load it and run one forward pass.
  let model: Record<string, unknown> | null = null;
  const packs = await invoke<string | null>('smoke_packs').catch(() => null);
  if (packs) {
    const id = defaultPack('maia3')?.id ?? 'maia3-23m';
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
