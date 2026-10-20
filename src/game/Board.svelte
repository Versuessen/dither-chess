<script lang="ts" module>
  import 'chessground/assets/chessground.base.css';
  import 'chessground/assets/chessground.cburnett.css';
  import './pieces-dither.css';
  import './pieces-lichess.css';
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Chessground } from 'chessground';
  import type { Api } from 'chessground/api';
  import type { Key, Color as CgColor, Dests } from 'chessground/types';
  import type { PieceSet } from '../app/settings.svelte';
  import type { BoardPalette } from '../app/colours';

  interface Props {
    fen: string;
    orientation: CgColor;
    turnColor: CgColor;
    /** Side the human can move, or undefined when the board is read-only. */
    movableColor?: CgColor;
    dests: Dests;
    lastMove?: [Key, Key];
    /** The side whose king is in check (false: none). */
    check: CgColor | false;
    coordinates: boolean;
    showDests: boolean;
    palette: BoardPalette;
    pieceSet: PieceSet;
    animate: boolean;
    /** No moves or premoves (review, game over). Marking squares and drawing arrows still work. */
    viewOnly?: boolean;
    label: string;
    /** Queued premoves, highlighted in the premove colour; right-click cancels them (oncancelqueue). */
    queued?: [Key, Key][];
    oncancelqueue?: () => void;
    /** The destinations offered are premoves (dots in the premove colour). */
    premoving?: boolean;
    /** Arrows set by the app (the engine's best move in a review), drawn under the player's own. */
    hints?: { from: Key; to: Key }[];
    /** Squares the app marks (a puzzle hint), in the marked-square colour. */
    marked?: Key[];
    /** A mark on a square's corner (the class of the move shown in a review). */
    badge?: { square: Key; glyph: string; kind: string; label: string };
    onmove: (orig: Key, dest: Key) => void;
  }
  let props: Props = $props();

  let el: HTMLDivElement;
  let arrowsEl: SVGSVGElement;
  let api: Api | null = null;

  // chessground only binds its input events if `viewOnly` is false when it is created, so the
  // read-only state is expressed through `movable`/`premovable` instead of `viewOnly`.
  const movableColor = () => (props.viewOnly ? undefined : props.movableColor);

  // Right-click annotations, as on chess.com: a click marks a square red, a drag draws an arrow
  // (knight moves bend round the corner), a left click clears them all.
  let marks = $state<Key[]>([]);
  let arrows = $state<{ from: Key; to: Key }[]>([]);
  let dragFrom: Key | null = null;

  function squareAt(clientX: number, clientY: number): Key | null {
    const r = (el.querySelector('cg-container') ?? el).getBoundingClientRect();
    const fx = Math.floor(((clientX - r.left) / r.width) * 8);
    const fy = Math.floor(((clientY - r.top) / r.height) * 8);
    if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
    const white = props.orientation === 'white';
    const file = white ? fx : 7 - fx;
    const rank = white ? 7 - fy : fy;
    return `${'abcdefgh'[file]}${rank + 1}` as Key;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button === 2 && props.queued?.length && props.oncancelqueue) {
      // As on the big sites, a right-click first cancels the queued premoves.
      props.oncancelqueue();
      dragFrom = null;
      e.preventDefault();
    } else if (e.button === 2) {
      dragFrom = squareAt(e.clientX, e.clientY);
      e.preventDefault();
    } else if (e.button === 0 && (marks.length || arrows.length)) {
      marks = [];
      arrows = [];
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (e.button !== 2 || !dragFrom) return;
    const to = squareAt(e.clientX, e.clientY);
    const from = dragFrom;
    dragFrom = null;
    if (!to) return;
    if (to === from) {
      marks = marks.includes(to) ? marks.filter((k) => k !== to) : [...marks, to];
    } else {
      const i = arrows.findIndex((a) => a.from === from && a.to === to);
      arrows = i >= 0 ? arrows.filter((_, j) => j !== i) : [...arrows, { from, to }];
    }
  }

  /** Square centre in board units (0..8), with the board's orientation. */
  function centre(k: Key): [number, number] {
    const file = k.charCodeAt(0) - 97;
    const rank = Number(k[1]) - 1;
    const white = props.orientation === 'white';
    return [(white ? file : 7 - file) + 0.5, (white ? 7 - rank : rank) + 0.5];
  }

  /** Arrow path points: straight, or for a knight's jump the long leg first, then the short one. */
  function arrowPoints(from: Key, to: Key): [number, number][] {
    const a = centre(from);
    const b = centre(to);
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    if ((dx === 1 && dy === 2) || (dx === 2 && dy === 1)) {
      const corner: [number, number] = dy === 2 ? [a[0], b[1]] : [b[0], a[1]];
      return [a, corner, b];
    }
    return [a, b];
  }

  /** Shorten the last leg so the head ends inside the target square, and start off the piece. */
  function arrowGeometry(from: Key, to: Key) {
    const pts = arrowPoints(from, to).map((p) => [...p] as [number, number]);
    const head = 0.42;
    const first = pts[0]!;
    const second = pts[1]!;
    const d0 = Math.hypot(second[0] - first[0], second[1] - first[1]);
    first[0] += ((second[0] - first[0]) / d0) * 0.18;
    first[1] += ((second[1] - first[1]) / d0) * 0.18;
    const end = pts[pts.length - 1]!;
    const prev = pts[pts.length - 2]!;
    const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
    const ux = (end[0] - prev[0]) / len;
    const uy = (end[1] - prev[1]) / len;
    const tip: [number, number] = [end[0] + ux * 0.12, end[1] + uy * 0.12];
    const base: [number, number] = [tip[0] - ux * head, tip[1] - uy * head];
    pts[pts.length - 1] = base;
    const w = 0.24;
    const headPts = [tip, [base[0] - uy * w, base[1] + ux * w], [base[0] + uy * w, base[1] - ux * w]];
    return { line: pts.map((p) => p.join(',')).join(' '), head: headPts.map((p) => p.join(',')).join(' ') };
  }

  const highlights = $derived(
    new Map<Key, string>([
      ...(props.queued ?? []).flatMap(([a, b]) => [[a, 'current-premove'] as const, [b, 'current-premove'] as const]),
      ...marks.map((k) => [k, 'marked'] as const),
      ...(props.marked ?? []).map((k) => [k, 'marked'] as const)
    ])
  );

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
      highlight: { lastMove: true, check: true, custom: highlights },
      movable: {
        free: false,
        color: movableColor(),
        dests: props.dests,
        showDests: props.showDests,
        events: { after: (orig, dest) => props.onmove(orig, dest) }
      },
      // Premoves are queued by the game screen (chess/premove.ts), several at a time.
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      // Annotations are drawn by this component (marks as squares, bent knight arrows).
      drawable: { enabled: false, visible: false }
    });
    // The arrow layer lives inside chessground's own container, so it shares its exact box.
    el.querySelector('cg-container')?.appendChild(arrowsEl);
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
      highlight: { lastMove: true, check: true, custom: highlights }
    };
    if (!api) return;
    if (!config.movable.color) api.selectSquare(null);
    api.set(config);
  });

  /** Put the pieces back to `fen` (after a cancelled promotion). */
  export function reset(): void {
    api?.set({ fen: props.fen, lastMove: props.lastMove });
  }

  const style = $derived(
    [
      `--sq-light:${props.palette.light}`,
      `--sq-dark:${props.palette.dark}`,
      `--hl-move:${props.palette.move}`,
      `--hl-premove:${props.palette.premove}`,
      `--hl-mark:${props.palette.mark}`,
      `--hl-arrow:${props.palette.arrow}`
    ].join(';')
  );
</script>

<div
  class="board"
  class:premoving={props.premoving}
  role="application"
  aria-label={props.label}
  {style}
  onpointerdowncapture={onPointerDown}
  onpointerup={onPointerUp}
>
  <div bind:this={el} class="cg pieces-{props.pieceSet}"></div>
  <svg bind:this={arrowsEl} class="arrows" viewBox="0 0 8 8" aria-hidden="true">
    {#each props.hints ?? [] as a (a.from + a.to)}
      {@const g = arrowGeometry(a.from, a.to)}
      <polyline class="hint" points={g.line} />
      <polygon class="hint" points={g.head} />
    {/each}
    {#each arrows as a (a.from + a.to)}
      {@const g = arrowGeometry(a.from, a.to)}
      <polyline points={g.line} />
      <polygon points={g.head} />
    {/each}
  </svg>
  {#if props.badge}
    {@const [cx, cy] = centre(props.badge.square)}
    <span
      class="badge note-{props.badge.kind}"
      style="left:{((cx + 0.5) / 8) * 100}%;top:{((cy - 0.5) / 8) * 100}%"
      role="img"
      aria-label={props.badge.label}
      title={props.badge.label}>{props.badge.glyph}</span
    >
  {/if}
</div>

<style>
  .board {
    /* The engine's suggestion in a review: green, apart from the player's own arrow colour. */
    --hl-best: var(--review-best);
    container-type: inline-size;
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    user-select: none;
    touch-action: none;
  }
  .cg {
    position: absolute;
    inset: 0;
  }
  /* The squares are painted on chessground's own board element, so they share the exact box the
     pieces are positioned in (a separate grid rounded differently and pieces sat off-centre).
     A 2x2-square tile: dark top-right and bottom-left, as a8/h1 are light from either side. */
  .cg :global(cg-board) {
    background-color: var(--sq-light);
    background-image: conic-gradient(var(--sq-dark) 0 25%, transparent 0 50%, var(--sq-dark) 0 75%, transparent 0);
    background-size: 25% 25%;
  }
  .cg :global(cg-board square.last-move) {
    background: color-mix(in srgb, var(--hl-move) 55%, transparent);
  }
  .cg :global(cg-board square.selected) {
    background: color-mix(in srgb, var(--hl-move) 72%, transparent);
  }
  .cg :global(cg-board square.check) {
    background: radial-gradient(circle, color-mix(in srgb, var(--flag) 85%, transparent) 0 35%, transparent 72%);
  }
  .cg :global(cg-board square.marked) {
    background: color-mix(in srgb, var(--hl-mark) 78%, transparent);
  }
  .cg :global(cg-board square.current-premove) {
    background: color-mix(in srgb, var(--hl-premove) 62%, transparent);
  }
  .cg :global(cg-board square.move-dest::after),
  .cg :global(cg-board square.premove-dest::after) {
    content: '';
    position: absolute;
    inset: 37%;
    border-radius: 50%;
    background: color-mix(in srgb, #111 30%, transparent);
  }
  .cg :global(cg-board square.premove-dest::after),
  .premoving .cg :global(cg-board square.move-dest::after) {
    background: color-mix(in srgb, var(--hl-premove) 55%, transparent);
  }
  .premoving .cg :global(cg-board square.move-dest.oc::after) {
    background: transparent;
    border-color: color-mix(in srgb, var(--hl-premove) 55%, transparent);
  }
  .cg :global(cg-board square.move-dest.oc::after),
  .cg :global(cg-board square.premove-dest.oc::after) {
    inset: 3%;
    background: transparent;
    border: 0.32em solid color-mix(in srgb, #111 30%, transparent);
  }
  .cg :global(cg-board square.premove-dest.oc::after) {
    border-color: color-mix(in srgb, var(--hl-premove) 55%, transparent);
  }
  .cg :global(cg-board square.move-dest:hover) {
    background: color-mix(in srgb, var(--hl-move) 35%, transparent);
  }
  .arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 3;
    opacity: 0.82;
  }
  .arrows polyline {
    fill: none;
    stroke: var(--hl-arrow);
    stroke-width: 0.2;
    stroke-linejoin: round;
  }
  .arrows polygon {
    fill: var(--hl-arrow);
  }
  .arrows polyline.hint {
    stroke: var(--hl-best);
  }
  .arrows polygon.hint {
    fill: var(--hl-best);
  }
  /* The class of the move shown, on the corner of its square, as on the big sites. */
  .badge {
    position: absolute;
    z-index: 4;
    width: 5.4%;
    aspect-ratio: 1;
    /* Inside the square's top-right corner, so edge squares never clip it. */
    transform: translate(-104%, 4%);
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--badge, var(--panel-muted));
    color: var(--panel);
    box-shadow: 0 0 0 0.25cqw var(--panel), 0 0.3cqw 0.8cqw rgb(0 0 0 / 0.35);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 2.4cqw;
    line-height: 1;
    letter-spacing: -0.06em;
    pointer-events: none;
  }
  .badge.note-brilliant {
    --badge: var(--review-brilliant);
  }
  .badge.note-excellent {
    --badge: var(--review-excellent);
  }
  .badge.note-best {
    --badge: var(--review-best);
  }
  .badge.note-good {
    --badge: var(--review-good);
  }
  .badge.note-book {
    --badge: var(--review-book);
  }
  .badge.note-inaccuracy {
    --badge: var(--review-inaccuracy);
  }
  .badge.note-mistake {
    --badge: var(--review-mistake);
  }
  .badge.note-blunder {
    --badge: var(--review-blunder);
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
