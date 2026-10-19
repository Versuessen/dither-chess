<script lang="ts">
  import { LOOKS } from '../bots/personas';
  import { onMount } from 'svelte';
  import { DitherRenderer, readInks } from './renderer';
  import { ART, ART_BASE } from './art';
  import { ui } from '../app/ui.svelte';

  /** A framed, still dither image of one subject (the profile panel's portrait). */
  interface Props {
    subject: string;
    label: string;
    /** Pawn-to-queen promotion while the pointer is on PLAY. */
    promotion?: boolean;
  }
  let { subject, label, promotion = false }: Props = $props();

  let canvas: HTMLCanvasElement;
  let renderer: DitherRenderer | null = $state(null);
  let failed = $state(false);

  onMount(() => {
    try {
      renderer = new DitherRenderer(canvas, {
        manifest: ART,
        artBase: ART_BASE,
        reducedMotion: ui.reducedMotion,
        still: true,
        inks: readInks(),
        looks: LOOKS
      });
      renderer.setMode('live');
    } catch {
      failed = true;
    }
    return () => {
      const gl = canvas.getContext('webgl2');
      renderer?.destroy();
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      renderer = null;
    };
  });

  $effect(() => {
    void renderer?.setSubject(subject, true);
  });
  $effect(() => {
    renderer?.setPromotion(promotion);
  });
  $effect(() => {
    renderer?.setReducedMotion(ui.reducedMotion);
  });
  $effect(() => {
    void ui.theme;
    const r = renderer;
    if (r) requestAnimationFrame(() => r.setInks(readInks()));
  });
</script>

<figure class="tile" class:failed role="img" aria-label={label}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</figure>

<style>
  .tile {
    margin: 0;
    aspect-ratio: 4 / 5;
    border: var(--hairline) solid var(--panel-muted);
    border-radius: var(--radius);
    padding: 6px;
    background: var(--panel);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 1px;
    background: var(--dither-shadow);
  }
</style>
