<script lang="ts" module>
  import 'chessground/assets/chessground.base.css';
  import 'chessground/assets/chessground.cburnett.css';
  import './pieces-dither.css';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Chessground } from 'chessground';
  import type { Api } from 'chessground/api';
  import type { Key, Color as CgColor, Dests } from 'chessground/types';
  import type { BoardColours, PieceSet } from '../app/settings.svelte';

  interface Props {
    fen: string;
    orientation: CgColor;
    turnColor: CgColor;
    /** Side the human can move, or undefined when the board is read-only. */
    movableColor?: CgColor;
    dests: Dests;
    lastMove?: [Key, Key];
    check: boolean;
    coordinates: boolean;
    showDests: boolean;
    premoves: boolean;
    colours: BoardColours;
    pieceSet: PieceSet;
    animate: boolean;
    /** No moves or premoves (review, game over). Drawing arrows still works. */
    viewOnly?: boolean;
    label: string;
    onmove: (orig: Key, dest: Key) => void;
  }
  let props: Props = $props();

  let el: HTMLDivElement;
  let api: Api | null = null;

  // chessground only binds its input events if `viewOnly` is false when it is created, so the
  // read-only state is expressed through `movable`/`premovable` instead of `viewOnly`.
  const movableColor = () => (props.viewOnly ? undefined : props.movableColor);
  const premoves = () => props.premoves && !props.viewOnly;

  onMount(() => {
    api = Chessground(el, {
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turnColor,
      coordinates: props.coordinates,
      lastMove: props.lastMove,
      check: props.check,
      viewOnly: false,
      autoCastle: true,
      disableContextMenu: true,
      blockTouchScroll: true,
      animation: { enabled: props.animate, duration: 160 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        color: movableColor(),
        dests: props.dests,
        showDests: props.showDests,
        events: { after: (orig, dest) => props.onmove(orig, dest) }
      },
      premovable: { enabled: premoves(), showDests: props.showDests, castle: true },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      drawable: { enabled: true, visible: true }
    });
    return () => {
      api?.destroy();
      api = null;
    };
  });

  $effect(() => {
    const config = {
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turnColor,
      lastMove: props.lastMove,
      check: props.check,
      coordinates: props.coordinates,
      animation: { enabled: props.animate, duration: 160 },
      movable: { color: movableColor(), dests: props.dests, showDests: props.showDests },
      premovable: { enabled: premoves(), showDests: props.showDests }
    };
    if (!api) return;
    if (!config.premovable.enabled) api.cancelPremove();
    if (!config.movable.color) api.selectSquare(null);
    api.set(config);
  });

  /** Play a queued premove, if any. Returns whether one was played. */
  export function playPremove(): boolean {
    return api?.playPremove() ?? false;
  }

  export function cancelPremove(): void {
    api?.cancelPremove();
  }

  /** Put the pieces back to `fen` (after a cancelled promotion). */
  export function reset(): void {
    api?.set({ fen: props.fen, lastMove: props.lastMove });
  }

  const squares = Array.from({ length: 64 }, (_, i) => ((i >> 3) + (i & 7)) % 2 === 1);
</script>

<div class="board colours-{props.colours}" role="application" aria-label={props.label}>
  <div class="squares" aria-hidden="true">
    {#each squares as dark, i (i)}
      <span class:dark></span>
    {/each}
  </div>
  <div bind:this={el} class="cg pieces-{props.pieceSet}"></div>
</div>

<style>
  .board {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    user-select: none;
    touch-action: none;
  }
  .squares {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
  }
  .squares span {
    background: var(--sq-light);
  }
  .squares span.dark {
    background: var(--sq-dark);
  }
  .colours-classic {
    --sq-light: var(--sq-classic-light);
    --sq-dark: var(--sq-classic-dark);
  }
  .colours-duotone {
    --sq-light: var(--sq-duo-light);
    --sq-dark: var(--sq-duo-dark);
  }
  .cg {
    position: absolute;
    inset: 0;
  }
  .cg :global(cg-board) {
    background: transparent;
  }
  .cg :global(cg-board square.last-move) {
    background: color-mix(in srgb, #111 20%, transparent);
  }
  .cg :global(cg-board square.selected) {
    background: color-mix(in srgb, #111 30%, transparent);
  }
  .cg :global(cg-board square.check) {
    background: color-mix(in srgb, var(--flag) 62%, transparent);
  }
  .cg :global(cg-board square.move-dest::after),
  .cg :global(cg-board square.premove-dest::after) {
    content: '';
    position: absolute;
    inset: 37%;
    border-radius: 50%;
    background: color-mix(in srgb, #111 38%, transparent);
  }
  .cg :global(cg-board square.premove-dest::after) {
    background: color-mix(in srgb, #111 22%, transparent);
  }
  .cg :global(cg-board square.move-dest.oc::after),
  .cg :global(cg-board square.premove-dest.oc::after) {
    inset: 3%;
    background: transparent;
    border: 0.32em solid color-mix(in srgb, #111 38%, transparent);
  }
  .cg :global(cg-board square.move-dest:hover) {
    background: color-mix(in srgb, #111 18%, transparent);
  }
  .cg :global(cg-board square.current-premove) {
    background: color-mix(in srgb, #111 34%, transparent);
  }
  .cg :global(coords) {
    font-family: var(--font-ui);
    font-size: 10px;
    letter-spacing: 0;
    text-transform: lowercase;
    opacity: 1;
  }
  .cg :global(coords.files) {
    bottom: 1px;
    left: 0;
  }
  .cg :global(coords.files coord) {
    text-align: right;
    padding-right: 4px;
  }
  .cg :global(coords.ranks) {
    top: 0;
    left: 3px;
  }
  .cg :global(coords.ranks coord) {
    transform: translateY(3px);
  }
  /* Coordinates take the colour of the opposite square. Each list runs 1→8 / a→h in the DOM
     whatever the orientation; ranks sit on the a-file (White) or h-file (Black), files on the
     first rank (White) or eighth (Black). */
  .board :global(coords coord) {
    color: var(--sq-light);
  }
  .board :global(coords.ranks:not(.black) coord:nth-child(even)),
  .board :global(coords.files:not(.black) coord:nth-child(even)),
  .board :global(coords.ranks.black coord:nth-child(odd)),
  .board :global(coords.files.black coord:nth-child(odd)) {
    color: var(--sq-dark);
  }
</style>
