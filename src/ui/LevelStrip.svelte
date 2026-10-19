<script lang="ts">
  import { ALL_LEVELS } from '../models/catalog';

  /** One cell per selectable level (600-1900 by 50); filled where the model can play. */
  interface Props {
    covered: readonly number[];
    label: string;
  }
  let { covered, label }: Props = $props();
  const set = $derived(new Set(covered));
  const first = $derived(covered.length ? Math.min(...covered) : null);
  const last = $derived(covered.length ? Math.max(...covered) : null);
</script>

<div class="strip" role="img" aria-label={first === null ? `${label}: no levels yet` : `${label}: ${first} to ${last}`}>
  {#each ALL_LEVELS as l (l)}
    <span class="cell" class:on={set.has(l)} class:hundred={l % 100 === 0} title={String(l)}></span>
  {/each}
</div>
<div class="scale" aria-hidden="true">
  <span>600</span><span>1250</span><span>1900</span>
</div>

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(27, 1fr);
    gap: 2px;
    height: 14px;
  }
  .cell {
    border: var(--hairline) solid var(--panel-muted);
    border-radius: 1px;
    opacity: 0.45;
  }
  .cell.on {
    background: var(--panel-ink);
    border-color: var(--panel-ink);
    opacity: 1;
  }
  .scale {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 11px;
    color: var(--panel-muted);
  }
</style>
