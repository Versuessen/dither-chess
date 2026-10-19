<script lang="ts">
  import type { MoveRecord } from '../chess/game';

  interface Props {
    moves: MoveRecord[];
    /** Ply shown on the board (moves.length when live). */
    viewing: number;
    /** Full-move number of the first move. */
    firstMove?: number;
    blackFirst?: boolean;
    /** Review marks per ply ("?!", "?", "??") with a kind used for colour. */
    notes?: Record<number, { glyph: string; kind: string; label: string }>;
    onselect: (ply: number) => void;
  }
  let { moves, viewing, firstMove = 1, blackFirst = false, notes, onselect }: Props = $props();

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

{#snippet move(m: { san: string; ply: number })}
  {@const note = notes?.[m.ply]}
  <button
    class:current={viewing === m.ply}
    class="note-{note?.kind ?? 'none'}"
    aria-label={note?.label ? `${m.san}, ${note.label}` : undefined}
    onclick={() => onselect(m.ply)}
  >
    {m.san}{#if note?.glyph}<span class="glyph" aria-hidden="true">{note.glyph}</span>{/if}
  </button>
{/snippet}

<ol class="moves" bind:this={list} aria-label="Moves">
  {#each rows as r (r.no)}
    <li>
      <span class="no">{r.no}.</span>
      {#if r.white}
        {@render move(r.white)}
      {:else}
        <span class="gap">…</span>
      {/if}
      {#if r.black}
        {@render move(r.black)}
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
  .glyph {
    margin-left: 3px;
    font-weight: 700;
  }
  /* Review colours, as on Lichess: inaccuracy amber, mistake orange, blunder red. Each also has
     its glyph, so colour is never the only signal. */
  .note-inaccuracy .glyph {
    color: var(--review-inaccuracy);
  }
  .note-mistake .glyph {
    color: var(--review-mistake);
  }
  .note-blunder .glyph {
    color: var(--review-blunder);
  }
  .note-best .glyph {
    color: var(--review-best);
  }
  button.current .glyph {
    color: inherit;
  }
</style>
