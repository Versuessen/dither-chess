<script lang="ts">
  interface Props {
    /** 0..1: scroll position, or load progress when `filling`. */
    progress: number;
    /** Thumb length as a fraction of the track (scroll mode). */
    size?: number;
    /** Load-progress mode: the bar fills from the top. */
    filling?: boolean;
    label?: string;
  }
  let { progress, size = 0.3, filling = false, label }: Props = $props();

  const p = $derived(Math.min(1, Math.max(0, progress)));
  const thumb = $derived(filling ? p : Math.min(1, Math.max(0.08, size)));
  const offset = $derived(filling ? 0 : p * (1 - thumb));
</script>

<div
  class="rail"
  role={filling ? 'progressbar' : 'presentation'}
  aria-label={filling ? (label ?? 'Loading') : undefined}
  aria-valuemin={filling ? 0 : undefined}
  aria-valuemax={filling ? 100 : undefined}
  aria-valuenow={filling ? Math.round(p * 100) : undefined}
>
  <div class="thumb" style:height="{thumb * 100}%" style:top="{offset * 100}%"></div>
</div>

<style>
  .rail {
    position: fixed;
    right: calc(var(--gutter) * 0.5);
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: min(46vh, 420px);
    border-radius: 3px;
    background: color-mix(in srgb, currentColor 22%, transparent);
    z-index: 3;
    pointer-events: none;
  }
  .thumb {
    position: absolute;
    left: 0;
    width: 100%;
    border-radius: 3px;
    background: currentColor;
    transition:
      top 120ms linear,
      height 160ms linear;
  }
</style>
