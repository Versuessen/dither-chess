/**
 * Start-up work behind the preloader: storage, settings, the model packs and the inference
 * worker. Packs are verified once per session; the most recently used one is verified and
 * loaded before the preloader ends so the first game starts at once.
 */
import { boot } from './boot.svelte';
import { settings } from './settings.svelte';
import { openStorage, storage } from '../storage';
import { manager } from '../models/manager.svelte';
import { models } from '../models/state.svelte';
import { inference } from '../inference/client';
import { loadPack } from '../inference/opponents';
import { packById } from '../models/manifest';
import { finishUnfinished, onGameFinished } from '../game/finalize';
import { quality } from '../rating/quality.svelte';
import { loadPrefs } from '../chess/setup';

export function startBoot(): void {
  // After every finished game, in the background: the move-quality estimate.
  onGameFinished((g) => {
    void quality.run(storage(), g);
  });

  const ready = boot.track(
    'storage',
    (async () => {
      await openStorage();
      await settings.load();
      await manager.init();
      await finishUnfinished(storage());
    })(),
    2
  );

  boot.track(
    'inference',
    ready.then(async () => {
      await inference.init();
      // Warm the model the player used last, if it is installed.
      const family = loadPrefs().family;
      // Same preference as models.packFor: calibrated levels first, then the high-quality pack.
      const rank = (id: string) => ((packById(id)?.calibration.levels.length ?? 0) > 0 ? 2 : 0) + (packById(id)?.optional ? 1 : 0);
      const installed = [...manager.installedIds()].sort((a, b) => rank(b.id) - rank(a.id));
      const id = installed.find((x) => x.family === family)?.id ?? installed[0]?.id;
      if (id) {
        await manager.ensureVerified(id);
        await loadPack(id);
      }
    }),
    3
  );

  // Everything else is verified quietly after the preloader.
  void ready.then(() => boot.ready()).then(() => manager.verifyInstalled());
  void models;
}
