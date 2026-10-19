<script lang="ts">
  import type { MoveRecord } from '../chess/game';

  interface Props {
    moves: MoveRecord[];
    /** Ply shown on the board (moves.length when live). */
    viewing: number;
    /** Full-move number of the first move. */
    firstMove?: number;
    blackFirst?: boolean;
    onselect: (ply: number) => void;
  }
  let { moves, viewing, firstMove = 1, blackFirst = false, onselect }: Props = $props();

  let list: HTMLOListElement;

  const rows = $derived.by(() => {
    const out: { no: number; white?: { san: string; ply: number }; black?: { san: string; ply: number } }[] = [];
    moves.forEach((m, i) => {
      const ply = i + 1;
      const idx = i + (blackFirst ? 1 : 0);
      const r = Math.floor(idx / 2);
      out[r] ??= { no: firstMove + r };
      if (m.color === 'w') out[r]!.white = { san: m.san, ply };
      else out[r]!.black = { san: m.san, ply };
    });
    return out;
  });

  /** Keep the live move in view, or the move being reviewed. */
  function follow() {
    if (!list) return;
    if (viewing === moves.length) list.scrollTop = list.scrollHeight;
    else list.querySelector('button.current')?.scrollIntoView({ block: 'nearest' });
  }

  $effect(() => {
    void moves.length;
    void viewing;
    follow();
  });

  // The list shrinks when the result panel appears under it; stay on the last move.
  $effect(() => {
    const ro = new ResizeObserver(follow);
    ro.observe(list);
    return () => ro.disconnect();
  });
</script>

<ol class="moves" bind:this={list} aria-label="Moves">
  {#each rows as r (r.no)}
    <li>
      <span class="no">{r.no}.</span>
      {#if r.white}
        <button class:current={viewing === r.white.ply} onclick={() => onselect(r.white!.ply)}>{r.white.san}</button>
      {:else}
        <span class="gap">…</span>
      {/if}
      {#if r.black}
        <button class:current={viewing === r.black.ply} onclick={() => onselect(r.black!.ply)}>{r.black.san}</button>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .moves {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    font-family: var(--font-ui);
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: none;
    scrollbar-width: thin;
  }
  li {
    display: grid;
    grid-template-columns: 3.4ch 1fr 1fr;
    align-items: center;
    padding: 1px 0;
  }
  .no {
    color: var(--panel-muted);
  }
  button {
    text-align: left;
    padding: 2px 6px;
    border-radius: var(--radius);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  button:hover {
    background: color-mix(in srgb, var(--panel-ink) 10%, transparent);
  }
  button.current {
    background: var(--panel-ink);
    color: var(--panel);
  }
  .gap {
    padding: 2px 6px;
    color: var(--panel-muted);
  }
</style>
