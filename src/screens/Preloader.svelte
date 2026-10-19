<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '../app/ui.svelte';
  import { boot } from '../app/boot.svelte';
  import LogoMark from '../ui/LogoMark.svelte';
  import ScrollRail from '../ui/ScrollRail.svelte';

  /**
   * 1. black with live grain while the bar fills,
   * 2. the logo alone on black,
   * 3. the dither image grows in line by line and the overlay lets go.
   * With everything cached this takes about 1.2 s; with reduced motion it is a plain fade.
   */
  interface Props {
    ondone: () => void;
  }
  let { ondone }: Props = $props();

  let stage = $state<'grain' | 'logo' | 'reveal'>('grain');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  onMount(() => {
    let cancelled = false;
    ui.mode = 'black';
    (async () => {
      const minGrain = wait(ui.reducedMotion ? 0 : 260);
      await Promise.all([boot.ready(), minGrain]);
      if (cancelled) return;
      ui.loading = 1;
      if (!ui.reducedMotion) {
        stage = 'logo';
        await wait(380);
        if (cancelled) return;
      }
      stage = 'reveal';
      ui.mode = 'live';
      await wait(ui.reducedMotion ? 200 : 480);
      if (cancelled) return;
      ui.loading = null;
      ondone();
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (stage === 'grain') ui.loading = boot.progress;
  });
</script>

<div class="pre" class:reveal={stage === 'reveal'} class:reduced={ui.reducedMotion} aria-busy={stage !== 'reveal'}>
  <div class="logo" class:shown={stage !== 'grain'}>
    <LogoMark width="min(34vw, 500px)" label="Dither is loading" tag="CHESS" />
  </div>
  <div class="rail" class:gone={stage !== 'grain'}>
    <ScrollRail progress={ui.loading ?? 1} filling label="Loading models" />
  </div>
</div>

<style>
  .pre {
    position: fixed;
    inset: 0;
    z-index: 50;
    color: #fff;
    transition: background-color 420ms var(--ease-out);
    background: transparent;
  }
  .pre:not(.reveal) {
    /* The black and its grain are drawn by the dither layer underneath; this only blocks input. */
    background: transparent;
  }
  .logo {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    opacity: 0;
    transition: opacity 260ms linear;
  }
  .logo.shown {
    opacity: 1;
  }
  .reveal .logo {
    opacity: 0;
    transition-duration: 480ms;
    transition-delay: 160ms;
  }
  .reveal {
    pointer-events: none;
  }
  .rail {
    transition: opacity 200ms linear;
  }
  .rail.gone {
    opacity: 0;
  }
  @media (max-width: 760px) {
    .logo {
      top: 15vh;
    }
    .logo :global(svg) {
      width: 62vw !important;
    }
  }
</style>
