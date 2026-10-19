<script lang="ts">
  import { onMount } from 'svelte';
  import { DitherRenderer, readInks } from './renderer';
  import { ART, ART_BASE } from './art';
  import { PERSONAS, HOME_SUBJECT, LOOKS } from '../bots/personas';
  import { ui } from '../app/ui.svelte';
  import { boot } from '../app/boot.svelte';

  let canvas: HTMLCanvasElement;
  let renderer: DitherRenderer | null = $state(null);

  onMount(() => {
    try {
      renderer = new DitherRenderer(canvas, {
        manifest: ART,
        artBase: ART_BASE,
        reducedMotion: ui.reducedMotion,
        inks: readInks(),
        looks: LOOKS,
        // Frame counter for the end-to-end tests (reduced motion must not animate).
        onFrame: () => {
          (canvas as HTMLCanvasElement & { frames?: number }).frames =
            ((canvas as HTMLCanvasElement & { frames?: number }).frames ?? 0) + 1;
        }
      });
    } catch (err) {
      console.warn('Dither layer disabled:', err);
      ui.ditherFailed = true;
      return;
    }
    const r = renderer;
    void boot.track('first image', r.setSubject(ui.subject, true), 2);
    // Warm every persona image once the hero is up, so hover swaps are immediate.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 600));
    idle(() => void r.preload([HOME_SUBJECT, ...PERSONAS.map((p) => p.subject)]));

    const onMove = (e: PointerEvent) => {
      ui.pointer = [(e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1];
    };
    const onResize = () => r.resize();
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
      r.destroy();
      renderer = null;
    };
  });

  $effect(() => {
    void renderer?.setSubject(ui.subject);
  });
  $effect(() => {
    renderer?.setMode(ui.mode);
  });
  $effect(() => {
    renderer?.setPromotion(ui.promotion);
  });
  $effect(() => {
    renderer?.setPointer(ui.pointer[0], ui.pointer[1]);
  });
  $effect(() => {
    renderer?.setScroll(ui.scroll);
  });
  $effect(() => {
    renderer?.setLive3D(ui.home);
  });
  $effect(() => {
    renderer?.setReducedMotion(ui.reducedMotion);
  });
  $effect(() => {
    // Re-read the inks whenever the theme changes; the tokens are the single source.
    void ui.theme;
    void ui.inksVersion;
    if (renderer) {
      const r = renderer;
      requestAnimationFrame(() => r.setInks(readInks()));
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="dither"
  class:failed={ui.ditherFailed}
  data-subject={ui.subject}
  data-mode={ui.mode}
  aria-hidden="true"
></canvas>

<style>
  .dither {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    display: block;
    z-index: 0;
    background: var(--dither-shadow);
  }
</style>
