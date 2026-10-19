<script lang="ts">
  import { onMount } from 'svelte';

  /** Lichess-style picker over the promotion file: queen nearest the promotion square. */
  interface Props {
    file: number;
    /** Board orientation is white. */
    whiteBottom: boolean;
    /** Colour of the promoting side. */
    color: 'white' | 'black';
    pieceSet: string;
    onpick: (piece: 'q' | 'r' | 'b' | 'n') => void;
    oncancel: () => void;
  }
  let { file, whiteBottom, color, pieceSet, onpick, oncancel }: Props = $props();
  const pieces = [
    ['q', 'queen'],
    ['n', 'knight'],
    ['r', 'rook'],
    ['b', 'bishop']
  ] as const;
  // The promotion square is at the top of the board when the promoting side is at the bottom.
  const fromTop = $derived((color === 'white') === whiteBottom);
  const col = $derived(whiteBottom ? file : 7 - file);
  let first: HTMLButtonElement | undefined = $state();
  onMount(() => first?.focus());

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      oncancel();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="veil" onclick={oncancel}></div>
<div
  class="picker"
  role="dialog"
  aria-label="Promote to"
  tabindex="-1"
  onkeydown={key}
  style:left="{col * 12.5}%"
  style:top={fromTop ? '0' : '50%'}
  style:flex-direction={fromTop ? 'column' : 'column-reverse'}
>
  {#each pieces as [code, name], i (code)}
    {#if i === 0}
      <button bind:this={first} class="cg-wrap pieces-{pieceSet}" onclick={() => onpick(code)} aria-label={name}>
        <piece class="{name} {color}"></piece>
      </button>
    {:else}
      <button class="cg-wrap pieces-{pieceSet}" onclick={() => onpick(code)} aria-label={name}>
        <piece class="{name} {color}"></piece>
      </button>
    {/if}
  {/each}
</div>

<style>
  .veil {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: var(--scrim);
  }
  .picker {
    position: absolute;
    z-index: 21;
    width: 12.5%;
    height: 50%;
    display: flex;
    background: var(--panel);
    border-radius: var(--radius);
    outline: var(--hairline) solid var(--panel-ink);
  }
  button {
    position: relative;
    flex: 1;
    display: block;
    border-radius: var(--radius);
  }
  button:hover,
  button:focus-visible {
    background: color-mix(in srgb, var(--panel-ink) 16%, transparent);
    outline: none;
  }
  button :global(piece) {
    position: absolute;
    inset: 6%;
    width: 88%;
    height: 88%;
    background-size: cover;
  }
</style>
