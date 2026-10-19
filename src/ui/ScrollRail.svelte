<script lang="ts">
  interface Props {
    /** 0..1: scroll position, or load progress when `filling`. */
    progress: number;
    /** Thumb length as a fraction of the track (scroll mode). */
    size?: number;
    /** Load-progress mode: the bar fills from the top. */
    filling?: boolean;
    label?: string;
    /** Scroll mode: id of the scrolled element, and a callback to scroll it to a position 0..1. */
    controls?: string;
    onseek?: (fraction: number) => void;
  }
  let { progress, size = 0.3, filling = false, label, controls, onseek }: Props = $props();

  const p = $derived(Math.min(1, Math.max(0, progress)));
  const thumb = $derived(filling ? p : Math.min(1, Math.max(0.08, size)));
  const offset = $derived(filling ? 0 : p * (1 - thumb));
  const interactive = $derived(!filling && !!onseek && thumb < 1);

  let track = $state<HTMLDivElement>();
  let grab: number | null = null;

  /** Scroll position for a pointer at clientY, keeping the grabbed point of the thumb under it. */
  function seekTo(clientY: number) {
    if (!track) return;
    const r = track.getBoundingClientRect();
    const span = r.height * (1 - thumb);
    if (span <= 0) return;
    const top = clientY - r.top - (grab ?? (r.height * thumb) / 2);
    onseek?.(Math.min(1, Math.max(0, top / span)));
  }

  function down(e: PointerEvent) {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    if (!track) return;
    const r = track.getBoundingClientRect();
    const thumbTop = r.top + offset * r.height;
    const onThumb = e.clientY >= thumbTop && e.clientY <= thumbTop + thumb * r.height;
    // Dragging the thumb keeps the grab point; clicking the track centres the thumb there.
    grab = onThumb ? e.clientY - thumbTop : null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekTo(e.clientY);
  }

  function move(e: PointerEvent) {
    if (!interactive || !(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    seekTo(e.clientY);
  }

  function up(e: PointerEvent) {
    grab = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
</script>

{#if filling}
  <div class="rail" role="progressbar" aria-label={label ?? 'Loading'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
    <div class="track" bind:this={track}>
      <div class="thumb" style:height="{thumb * 100}%" style:top="0%"></div>
    </div>
  </div>
{:else}
  <!-- Pointer users can drag the thumb or click the track; keyboard users scroll the list itself. -->
  <div
    class="rail"
    class:interactive
    role="scrollbar"
    aria-label={label ?? 'Scroll'}
    aria-controls={controls}
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(p * 100)}
    tabindex="-1"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <div class="track" bind:this={track}>
      <div class="thumb" style:height="{thumb * 100}%" style:top="{offset * 100}%"></div>
    </div>
  </div>
{/if}

<style>
  .rail {
    position: fixed;
    right: calc(var(--gutter) * 0.5 - 10px);
    top: 50%;
    transform: translateY(-50%);
    /* A wide, invisible hit area around the 3px track. */
    padding: 0 10px;
    height: min(46vh, 420px);
    z-index: 3;
    pointer-events: none;
    touch-action: none;
    outline: none;
  }
  .rail.interactive {
    pointer-events: auto;
    cursor: grab;
  }
  .rail.interactive:active {
    cursor: grabbing;
  }
  .track {
    position: relative;
    width: 3px;
    height: 100%;
    border-radius: 3px;
    background: color-mix(in srgb, currentColor 22%, transparent);
    transition: width var(--t-fast) var(--ease-out);
  }
  .rail.interactive:hover .track,
  .rail.interactive:active .track {
    width: 5px;
    margin-left: -1px;
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
  .rail.interactive:active .thumb {
    transition: none;
  }
</style>
