<script lang="ts">
  import { formatClock } from '../chess/clock';

  interface Props {
    ms: number;
    active: boolean;
    label: string;
    /** Under this many ms the clock turns to the flag colour. */
    low?: number;
  }
  let { ms, active, label, low = 20_000 }: Props = $props();
  const text = $derived(formatClock(ms));
  const isLow = $derived(Number.isFinite(ms) && ms < low);
</script>

<div class="clock" class:active class:low={isLow} role="timer" aria-label="{label}: {text}">
  <span class="time" aria-hidden="true">{text}</span>
</div>

<style>
  .clock {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 4px 10px;
    border-radius: var(--radius);
    border: var(--hairline) solid transparent;
    color: var(--panel-muted);
  }
  .clock.active {
    color: var(--panel-ink);
    border-color: var(--panel-ink);
  }
  .clock.low {
    color: var(--flag);
  }
  .clock.low.active {
    border-color: var(--flag);
  }
  .time {
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: 100%;
    font-size: var(--clock-size);
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
</style>
