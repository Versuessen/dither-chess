<script lang="ts">
  import { onMount } from 'svelte';
  import type { Key } from 'chessground/types';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Board from '../game/Board.svelte';
  import MoveList from '../game/MoveList.svelte';
  import { storage } from '../storage';
  import type { StoredAnalysis, StoredGame } from '../storage/types';
  import { settings } from '../app/settings.svelte';
  import { boardPalette } from '../app/colours';
  import { ui } from '../app/ui.svelte';
  import { href } from '../app/router.svelte';
  import { Engine, ENGINE_NAME } from '../analysis/engine';
  import { analyseGame, lineSan, positions, sanIn } from '../analysis/analyse';
  import { JUDGEMENT_GLYPH, formatEval, review, winPercent, type Judgement } from '../analysis/review';
  import { loadOpenings, nameOpening, type OpeningTable } from '../chess/openings';
  import { describeTermination } from '../chess/rules';
  import { formatTimeControl } from '../chess/timeControl';

  interface Props {
    gameId: string;
  }
  let { gameId }: Props = $props();

  let game = $state<StoredGame | null>(null);
  let missing = $state(false);
  let analysis = $state<StoredAnalysis | null>(null);
  let progress = $state<{ done: number; total: number } | null>(null);
  let failure = $state<string | null>(null);
  let ply = $state(0);
  let orientation = $state<'white' | 'black'>('white');
  let openings = $state<OpeningTable | null>(null);
  let graphWidth = $state(320);
  let stopper: AbortController | null = null;
  let engine: Engine | null = null;

  onMount(() => {
    loadOpenings().then((t) => (openings = t), () => undefined);
    void (async () => {
      const g = (await storage().getGame(gameId)) ?? null;
      if (!g || !g.outcome) {
        missing = true;
        return;
      }
      game = g;
      orientation = g.humanColor === 'w' ? 'white' : 'black';
      ply = g.moves.length;
      if (g.analysis && g.analysis.evals.length === g.moves.length + 1) analysis = g.analysis;
      else await run(g);
    })();
    return () => {
      stopper?.abort();
      engine?.dispose();
    };
  });

  async function run(g: StoredGame) {
    failure = null;
    stopper = new AbortController();
    progress = { done: 0, total: g.moves.length + 1 };
    try {
      engine ??= await Engine.create();
      const a = await analyseGame(g, engine, (done, total) => (progress = { done, total }), stopper.signal);
      analysis = a;
      // Re-read first: the move-quality estimate may have been saved meanwhile.
      const fresh = (await storage().getGame(g.id)) ?? ($state.snapshot(g) as StoredGame);
      game = { ...fresh, analysis: a };
      await storage().putGame({ ...fresh, analysis: a });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) failure = err instanceof Error ? err.message : String(err);
    } finally {
      progress = null;
    }
  }

  const fens = $derived(game ? positions(game) : []);
  const result = $derived.by(() => {
    if (!game || !analysis) return null;
    const g = game;
    return review(g.moves, analysis.evals, (i, uci) => sanIn(fens[i]!, uci));
  });
  const youSide = $derived(game?.humanColor ?? 'w');
  const botSide = $derived(youSide === 'w' ? 'b' : 'w');
  const LABEL: Record<Judgement, string> = { best: 'Best move', good: 'Good move', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder' };
  const notes = $derived.by(() => {
    const out: Record<number, { glyph: string; kind: string; label: string }> = {};
    for (const m of result?.moves ?? []) if (m.judgement !== 'good') out[m.ply] = { glyph: JUDGEMENT_GLYPH[m.judgement], kind: m.judgement, label: LABEL[m.judgement] };
    return out;
  });

  const shown = $derived(analysis?.evals[ply] ?? null);
  const current = $derived(ply > 0 ? (result?.moves[ply - 1] ?? null) : null);
  const lastMove = $derived.by((): [Key, Key] | undefined => {
    const m = game?.moves[ply - 1];
    return m ? [m.uci.slice(0, 2) as Key, m.uci.slice(2, 4) as Key] : undefined;
  });
  // The engine's move in the shown position, as an arrow.
  const hints = $derived(shown?.best ? [{ from: shown.best.slice(0, 2) as Key, to: shown.best.slice(2, 4) as Key }] : []);
  const whiteShare = $derived(shown ? winPercent(shown) : 50);
  const opening = $derived(openings && game ? nameOpening(openings, fens) : null);

  // Evaluation graph: White's winning chances after every move.
  const graph = $derived.by(() => {
    if (!analysis) return null;
    const W = Math.max(200, Math.round(graphWidth));
    const H = 96;
    const n = analysis.evals.length;
    const x = (i: number) => (n === 1 ? W / 2 : (i * W) / (n - 1));
    const y = (w: number) => H - (w / 100) * H;
    const pts = analysis.evals.map((e, i) => `${x(i).toFixed(1)},${y(winPercent(e)).toFixed(1)}`);
    const area = `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
    const dots = (result?.moves ?? [])
      .filter((m) => m.judgement === 'mistake' || m.judgement === 'blunder' || m.judgement === 'inaccuracy')
      .map((m) => ({ ply: m.ply, kind: m.judgement, x: x(m.ply), y: y(winPercent(analysis!.evals[m.ply]!)) }));
    return { W, H, area, line: `M${pts.join(' L')}`, dots, cursor: x(ply), mid: H / 2 };
  });

  function pickFromGraph(e: MouseEvent) {
    if (!analysis || !graph) return;
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (analysis.evals.length - 1));
    ply = Math.max(0, Math.min(analysis.evals.length - 1, i));
  }

  function onKeydown(e: KeyboardEvent) {
    if (!game) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const n = game.moves.length;
    if (e.key === 'ArrowLeft') ply = Math.max(0, ply - 1);
    else if (e.key === 'ArrowRight') ply = Math.min(n, ply + 1);
    else if (e.key === 'Home') ply = 0;
    else if (e.key === 'End') ply = n;
    else if (e.key === 'f' || e.key === 'F') orientation = orientation === 'white' ? 'black' : 'white';
    else return;
    e.preventDefault();
  }

  const pct = (v: number) => `${Math.round(v)}%`;
</script>

<svelte:window onkeydown={onKeydown} />

<ScreenFrame title="Game review" current="history" wide>
  {#if missing}
    <p class="note">This game is not on this device. <a href={href({ name: 'history' })}>Back to History</a>.</p>
  {:else if game}
    <div class="review" data-state={progress ? 'running' : analysis ? 'done' : failure ? 'failed' : 'idle'}>
      <div class="board-col">
        <div class="bar" role="img" aria-label="Evaluation {shown ? formatEval(shown) : 'unknown'}">
          <span class="black-part" style="height:{100 - whiteShare}%"></span>
          <span class="bar-label" class:top={whiteShare < 50}>{shown ? formatEval(shown) : ''}</span>
        </div>
        <div class="board-wrap">
          <Board
            fen={fens[ply] ?? game.startFen}
            {orientation}
            turnColor={fens[ply]?.split(' ')[1] === 'b' ? 'black' : 'white'}
            dests={new Map()}
            {lastMove}
            check={false}
            coordinates={settings.value.coordinates}
            showDests={false}
            premoves={false}
            palette={boardPalette(settings.value.colours)}
            pieceSet={settings.value.pieceSet}
            animate={!ui.reducedMotion}
            viewOnly
            {hints}
            label="Review board, move {ply} of {game.moves.length}"
            onmove={() => undefined}
          />
        </div>
      </div>

      <aside class="side">
        <div class="meta">
          <span class="name">{game.botName}</span>
          <span class="note">
            {new Date(game.startedAt).toLocaleDateString()} · {formatTimeControl(game.timeControl)} · {game.outcome ? describeTermination(game.outcome) : ''}
            {#if opening}<br />{opening.eco} {opening.name}{/if}
          </span>
        </div>

        {#if progress}
          <div class="progress" role="status">
            <span class="label">Analysing with {ENGINE_NAME} · {progress.done}/{progress.total}</span>
            <span class="track"><span style="width:{(progress.done / progress.total) * 100}%"></span></span>
            <button type="button" onclick={() => stopper?.abort()}>Stop</button>
          </div>
        {:else if failure}
          <p class="note" role="alert">The analysis stopped: {failure}</p>
          <button type="button" class="action" onclick={() => game && run(game)}>Try again</button>
        {:else if !analysis}
          <button type="button" class="action" onclick={() => game && run(game)}>Analyse</button>
        {/if}

        {#if result}
          <table class="sides" data-testid="review-summary">
            <thead>
              <tr><th scope="col"></th><th scope="col">You</th><th scope="col">Bot</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">Accuracy</th><td>{pct(result.sides[youSide].accuracy)}</td><td>{pct(result.sides[botSide].accuracy)}</td></tr>
              <tr><th scope="row">Avg. centipawn loss</th><td>{result.sides[youSide].acpl}</td><td>{result.sides[botSide].acpl}</td></tr>
              <tr><th scope="row"><span class="glyph note-inaccuracy">?!</span> Inaccuracies</th><td>{result.sides[youSide].inaccuracies}</td><td>{result.sides[botSide].inaccuracies}</td></tr>
              <tr><th scope="row"><span class="glyph note-mistake">?</span> Mistakes</th><td>{result.sides[youSide].mistakes}</td><td>{result.sides[botSide].mistakes}</td></tr>
              <tr><th scope="row"><span class="glyph note-blunder">??</span> Blunders</th><td>{result.sides[youSide].blunders}</td><td>{result.sides[botSide].blunders}</td></tr>
              <tr><th scope="row"><span class="glyph note-best">★</span> Best moves</th><td>{result.sides[youSide].best}</td><td>{result.sides[botSide].best}</td></tr>
            </tbody>
          </table>
        {/if}

        {#if graph}
          <figure class="graph" bind:clientWidth={graphWidth}>
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <svg width={graph.W} height={graph.H} viewBox="0 0 {graph.W} {graph.H}" role="img" aria-label="White's winning chances over the game; arrow keys step through the moves" onclick={pickFromGraph}>
              <rect x="0" y="0" width={graph.W} height={graph.H} class="g-black" />
              <path d={graph.area} class="g-white" />
              <line x1="0" x2={graph.W} y1={graph.mid} y2={graph.mid} class="g-mid" />
              <line x1={graph.cursor} x2={graph.cursor} y1="0" y2={graph.H} class="g-cursor" />
              {#each graph.dots as d (d.ply)}
                <circle cx={d.x} cy={d.y} r="3.2" class="g-dot note-{d.kind}" />
              {/each}
            </svg>
          </figure>
        {/if}

        <div class="explain" aria-live="polite">
          {#if current && result}
            <p>
              <strong>{Math.ceil(current.ply / 2)}{current.color === 'w' ? '.' : '…'} {current.san}</strong>
              {#if current.judgement !== 'good'}<span class="note-{current.judgement}">{JUDGEMENT_GLYPH[current.judgement]} {LABEL[current.judgement]}</span>{/if}
              <span class="who">({current.color === youSide ? 'you' : 'bot'})</span>
            </p>
            {#if current.judgement !== 'best' && current.bestSan}
              <p class="note">
                Best was <strong>{current.bestSan}</strong> ({formatEval(analysis!.evals[current.ply - 1]!)}){#if analysis!.evals[current.ply - 1]!.pv.length > 1}: {lineSan(fens[current.ply - 1]!, analysis!.evals[current.ply - 1]!.pv)}{/if}.
                Win chance {pct(current.winBefore)} → {pct(current.winAfter)}.
              </p>
            {/if}
          {:else if shown?.best && analysis}
            <p class="note">Start position. Engine line: {lineSan(fens[ply]!, shown.pv)}</p>
          {/if}
        </div>

        <div class="moves">
          <MoveList
            moves={game.moves}
            viewing={ply}
            firstMove={Number(game.startFen.split(' ')[5]) || 1}
            blackFirst={game.moves[0]?.color === 'b'}
            {notes}
            onselect={(p) => (ply = p)}
          />
        </div>

        <div class="controls">
          <button type="button" onclick={() => (ply = 0)} aria-label="First move">|◀</button>
          <button type="button" onclick={() => (ply = Math.max(0, ply - 1))} aria-label="Previous move">◀</button>
          <button type="button" onclick={() => (ply = Math.min(game!.moves.length, ply + 1))} aria-label="Next move">▶</button>
          <button type="button" onclick={() => (ply = game!.moves.length)} aria-label="Last move">▶|</button>
          <button type="button" onclick={() => (orientation = orientation === 'white' ? 'black' : 'white')}>Flip</button>
        </div>
        {#if analysis}
          <p class="note small">{analysis.engine}, depth {analysis.depth}. Accuracy and judgements follow Lichess's method. The engine only reviews; it never plays you.</p>
        {/if}
      </aside>
    </div>
  {/if}
</ScreenFrame>

<style>
  .review {
    --board: max(260px, min(calc(100dvh - var(--gutter) * 3.2 - 140px), 62vw, 680px));
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(260px, 360px);
    gap: 26px;
    align-items: start;
  }
  .board-col {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .board-wrap {
    width: var(--board);
  }
  .bar {
    position: relative;
    width: 14px;
    height: var(--board);
    background: var(--eval-white);
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .black-part {
    position: absolute;
    inset: 0 0 auto 0;
    background: var(--eval-black);
    transition: height 240ms var(--ease-out);
  }
  .bar-label {
    position: absolute;
    left: 50%;
    bottom: 4px;
    transform: translateX(-50%) rotate(180deg);
    writing-mode: vertical-rl;
    font-size: 9px;
    letter-spacing: 0.04em;
    color: var(--eval-black);
  }
  .bar-label.top {
    bottom: auto;
    top: 4px;
    color: var(--eval-white);
  }
  .side {
    display: grid;
    gap: 14px;
    align-content: start;
    min-height: 0;
  }
  .meta {
    display: grid;
    gap: 4px;
  }
  .name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    text-transform: uppercase;
  }
  .note {
    margin: 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.03em;
  }
  .note a {
    color: var(--panel-ink);
    text-decoration: underline;
  }
  .small {
    font-size: 11px;
  }
  .progress {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    align-items: center;
  }
  .track {
    grid-column: 1;
    height: 6px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .track span {
    display: block;
    height: 100%;
    background: var(--panel-ink);
    transition: width 200ms linear;
  }
  .progress button,
  .action,
  .controls button {
    padding: 6px 10px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    font-size: 12px;
  }
  .action {
    justify-self: start;
  }
  .sides {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .sides th,
  .sides td {
    padding: 4px 6px 4px 0;
    text-align: left;
    font-weight: 400;
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 35%, transparent);
  }
  .sides thead th {
    color: var(--panel-muted);
  }
  .sides td {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
  }
  .glyph {
    display: inline-block;
    min-width: 2ch;
    font-weight: 700;
  }
  .note-inaccuracy {
    color: var(--review-inaccuracy);
  }
  .note-mistake {
    color: var(--review-mistake);
  }
  .note-blunder {
    color: var(--review-blunder);
  }
  .note-best {
    color: var(--review-best);
  }
  .graph {
    margin: 0;
  }
  .graph svg {
    display: block;
    cursor: pointer;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
  }
  .g-black {
    fill: var(--eval-black);
  }
  .g-white {
    fill: var(--eval-white);
  }
  .g-mid {
    stroke: var(--eval-mid);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .g-cursor {
    stroke: var(--flag);
    stroke-width: 1.5;
  }
  .g-dot.note-inaccuracy {
    fill: var(--review-inaccuracy);
  }
  .g-dot.note-mistake {
    fill: var(--review-mistake);
  }
  .g-dot.note-blunder {
    fill: var(--review-blunder);
  }
  .g-dot {
    stroke: var(--eval-white);
    stroke-width: 1;
  }
  .explain p {
    margin: 0 0 4px;
    font-size: 13px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .who {
    color: var(--panel-muted);
  }
  .moves {
    max-height: 30vh;
    display: flex;
    flex-direction: column;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    padding: 6px 0;
    min-height: 0;
  }
  .moves :global(ol) {
    flex: 1;
    min-height: 0;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (max-width: 900px) {
    .review {
      grid-template-columns: 1fr;
    }
    .review {
      --board: min(calc(100vw - 2 * var(--gutter) - 80px), 72dvh);
    }
  }
</style>
