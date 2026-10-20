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
  import { rating } from '../rating/rating.svelte';
  import { Engine, ENGINE_NAME } from '../analysis/engine';
  import { analyseGame, lineSan, moveFacts, positions } from '../analysis/analyse';
  import {
    JUDGEMENTS,
    JUDGEMENT_GLYPH,
    JUDGEMENT_LABEL,
    betterSide,
    formatEval,
    review,
    winPercent,
    type Judgement
  } from '../analysis/review';
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
  let timelineWidth = $state(480);
  let hover = $state<number | null>(null);
  let message = $state<string | null>(null);
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
    return review(game.moves, analysis.evals, moveFacts(game, fens, openings));
  });
  const youSide = $derived(game?.humanColor ?? 'w');
  const botSide = $derived(youSide === 'w' ? 'b' : 'w');
  // Every class but the plain ones carries its glyph in the move list.
  const notes = $derived.by(() => {
    const out: Record<number, { glyph: string; kind: string; label: string }> = {};
    for (const m of result?.moves ?? []) {
      if (m.judgement !== 'good' && m.judgement !== 'neutral') out[m.ply] = { glyph: JUDGEMENT_GLYPH[m.judgement], kind: m.judgement, label: JUDGEMENT_LABEL[m.judgement] };
    }
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
  // The shown move's class, on the corner of the square it went to.
  const badge = $derived(
    current
      ? { square: current.uci.slice(2, 4) as Key, glyph: JUDGEMENT_GLYPH[current.judgement], kind: current.judgement, label: JUDGEMENT_LABEL[current.judgement] }
      : undefined
  );
  const whiteShare = $derived(shown ? winPercent(shown) : 50);
  const opening = $derived(openings && game ? nameOpening(openings, fens) : null);

  /** The moves worth stopping at: brilliancies and errors. */
  const KEY: ReadonlySet<Judgement> = new Set(['brilliant', 'inaccuracy', 'mistake', 'blunder']);
  const keyPlies = $derived((result?.moves ?? []).filter((m) => KEY.has(m.judgement)).map((m) => m.ply));
  const prevKey = $derived([...keyPlies].reverse().find((p) => p < ply) ?? null);
  const nextKey = $derived(keyPlies.find((p) => p > ply) ?? null);

  // Timeline: White's winning chances after every move, with the key moves marked.
  const TL_H = 64;
  const timeline = $derived.by(() => {
    if (!game) return null;
    const W = Math.max(160, Math.round(timelineWidth));
    const n = game.moves.length;
    const x = (i: number) => (n === 0 ? W / 2 : (i * W) / n);
    const y = (w: number) => TL_H - (w / 100) * TL_H;
    const evals = analysis?.evals ?? [];
    const pts = evals.map((e, i) => `${x(i).toFixed(1)},${y(winPercent(e)).toFixed(1)}`);
    const marks = (result?.moves ?? []).filter((m) => KEY.has(m.judgement)).map((m) => ({ ply: m.ply, kind: m.judgement, x: x(m.ply), y: y(winPercent(evals[m.ply]!)) }));
    return { W, n, x, area: pts.length ? `M0,${TL_H} L${pts.join(' L')} L${W},${TL_H} Z` : '', marks };
  });

  function plyAt(e: PointerEvent): number {
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const n = game?.moves.length ?? 0;
    return Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n)));
  }
  let scrubbing = false;
  function onTimelineDown(e: PointerEvent) {
    scrubbing = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    ply = plyAt(e);
  }
  function onTimelineMove(e: PointerEvent) {
    const p = plyAt(e);
    hover = p;
    if (scrubbing) ply = p;
  }
  function onTimelineUp() {
    scrubbing = false;
  }

  const moveName = (p: number) => {
    const m = game?.moves[p - 1];
    if (!m) return 'Start';
    const firstMove = Number(game!.startFen.split(' ')[5]) || 1;
    const offset = game!.moves[0]?.color === 'b' ? 1 : 0;
    const n = firstMove + Math.floor((p - 1 + offset) / 2);
    return `${n}${m.color === 'w' ? '.' : '…'} ${m.san}`;
  };
  const hoverLabel = $derived.by(() => {
    if (hover === null || !game) return null;
    const j = result?.moves[hover - 1]?.judgement;
    return `${moveName(hover)}${j && j !== 'good' && j !== 'neutral' ? ` ${JUDGEMENT_GLYPH[j]}` : ''}`;
  });

  function onKeydown(e: KeyboardEvent) {
    if (!game) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const n = game.moves.length;
    if (e.key === 'ArrowLeft') ply = Math.max(0, ply - 1);
    else if (e.key === 'ArrowRight') ply = Math.min(n, ply + 1);
    else if (e.key === 'ArrowUp' && prevKey !== null) ply = prevKey;
    else if (e.key === 'ArrowDown' && nextKey !== null) ply = nextKey;
    else if (e.key === 'Home') ply = 0;
    else if (e.key === 'End') ply = n;
    else if (e.key === 'f' || e.key === 'F') orientation = orientation === 'white' ? 'black' : 'white';
    else return;
    e.preventDefault();
  }

  const pct = (v: number) => `${Math.round(v)}%`;

  // The rows of the summary, best first; the side that did better on a row is marked.
  const rows = $derived.by(() => {
    if (!result) return [];
    const s = result.sides;
    const mark = (stat: Judgement | 'accuracy') => betterSide(s, stat);
    return [
      { key: 'accuracy', label: 'Accuracy', glyph: '', you: pct(s[youSide].accuracy), bot: pct(s[botSide].accuracy), better: mark('accuracy') },
      ...JUDGEMENTS.map((j) => ({ key: j, label: JUDGEMENT_LABEL[j], glyph: JUDGEMENT_GLYPH[j], you: String(s[youSide].counts[j]), bot: String(s[botSide].counts[j]), better: mark(j) }))
    ];
  });

  function save(name: string, text: string, type: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const ratingState = $derived.by((): 'rated' | 'removed' | 'casual' => {
    if (!game || !rating.isInLedger(game.id)) return 'casual';
    return rating.excluded.has(game.id) ? 'removed' : 'rated';
  });
  async function toggleRating() {
    if (!game) return;
    const out = ratingState === 'rated';
    await rating.setExcluded(game.id, out);
    message = out ? 'Taken out of your rating.' : 'Counts for your rating again.';
  }
  async function copy() {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.pgn);
      message = 'PGN copied.';
    } catch {
      message = 'Copying is not allowed here; use PGN.';
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<ScreenFrame title="Game review" current="history" wide>
  {#if missing}
    <p class="note">This game is not on this device. <a href={href({ name: 'history' })}>Back to History</a>.</p>
  {:else if game}
    <div class="review" data-state={progress ? 'running' : analysis ? 'done' : failure ? 'failed' : 'idle'}>
      <div class="board-col">
        <div class="board-row">
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
              check={current && /[+#]/.test(current.san) ? (current.color === 'w' ? 'black' : 'white') : false}
              coordinates={settings.value.coordinates}
              showDests={false}
              palette={boardPalette(settings.value.colours)}
              pieceSet={settings.value.pieceSet}
              animate={!ui.reducedMotion}
              viewOnly
              {hints}
              {badge}
              label="Review board, move {ply} of {game.moves.length}"
              onmove={() => undefined}
            />
          </div>
        </div>

        {#if timeline}
          <div class="timeline" bind:clientWidth={timelineWidth}>
            <svg
              width={timeline.W}
              height={TL_H}
              viewBox="0 0 {timeline.W} {TL_H}"
              preserveAspectRatio="none"
              role="slider"
              tabindex="0"
              aria-label="Timeline"
              aria-valuemin={0}
              aria-valuemax={timeline.n}
              aria-valuenow={ply}
              aria-valuetext={moveName(ply)}
              onpointerdown={onTimelineDown}
              onpointermove={onTimelineMove}
              onpointerup={onTimelineUp}
              onpointercancel={onTimelineUp}
              onpointerleave={() => (hover = null)}
            >
              <rect x="0" y="0" width={timeline.W} height={TL_H} class="g-black" />
              {#if timeline.area}<path d={timeline.area} class="g-white" />{/if}
              <line x1="0" x2={timeline.W} y1={TL_H / 2} y2={TL_H / 2} class="g-mid" />
              {#if hover !== null}
                <line x1={timeline.x(hover)} x2={timeline.x(hover)} y1="0" y2={TL_H} class="g-hover" />
              {/if}
              {#each timeline.marks as m (m.ply)}
                <circle cx={m.x} cy={m.y} r="4" class="g-dot note-{m.kind}" />
              {/each}
              <line x1={timeline.x(ply)} x2={timeline.x(ply)} y1="0" y2={TL_H} class="g-cursor" />
            </svg>
            <div class="tl-labels">
              <span>{moveName(ply)}</span>
              {#if hoverLabel !== null && hover !== ply}<span class="tl-hover">{hoverLabel}</span>{/if}
            </div>
          </div>
        {/if}
      </div>

      <aside class="side">
        <div class="meta">
          <div class="meta-top">
            <span class="name">{game.botName}</span>
            <span class="actions">
              <button type="button" onclick={() => save(`dither-${game!.startedAt.slice(0, 10)}-${game!.id.slice(0, 6)}.pgn`, game!.pgn, 'application/x-chess-pgn')}>PGN</button>
              {#if settings.value.devMode}<button type="button" onclick={copy}>Copy PGN</button>{/if}
              {#if ratingState !== 'casual'}
                <button type="button" onclick={toggleRating}>{ratingState === 'rated' ? 'Remove from rating' : 'Count for rating again'}</button>
              {/if}
            </span>
          </div>
          <span class="line">{new Date(game.startedAt).toLocaleDateString()} · {formatTimeControl(game.timeControl)} · {game.outcome ? describeTermination(game.outcome) : ''}</span>
          <span class="line" title={opening ? `${opening.eco} ${opening.name}` : undefined}>{opening ? `${opening.eco} ${opening.name}` : ' '}</span>
          {#if message}<span class="line ok" role="status">{message}</span>{/if}
        </div>

        <div class="summary">
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
                {#each rows as r (r.key)}
                  <tr class:first={r.key === 'accuracy'}>
                    <th scope="row"><span class="glyph note-{r.key}" aria-hidden="true">{r.glyph}</span>{r.label}</th>
                    <td><span class:better={r.better === youSide}>{r.you}</span></td>
                    <td><span class:better={r.better === botSide}>{r.bot}</span></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>

        <div class="explain" aria-live="polite">
          {#if current && result}
            {@const before = analysis!.evals[current.ply - 1]!}
            <p>
              <strong>{moveName(current.ply)}</strong>
              <span class="note-{current.judgement}"><span class="glyph" aria-hidden="true">{JUDGEMENT_GLYPH[current.judgement]}</span>{JUDGEMENT_LABEL[current.judgement]}</span>
              <span class="who">· {current.color === youSide ? 'you' : 'bot'}</span>
            </p>
            {#if current.judgement === 'book'}
              <p class="note">Opening theory{opening && current.ply <= opening.ply ? `: ${opening.name}` : ''}.</p>
            {:else if current.best === current.uci}
              <p class="note">The engine's choice. Win chance {pct(current.winBefore)} → {pct(current.winAfter)}.</p>
            {:else if current.bestSan}
              <p class="note">Best was <strong>{current.bestSan}</strong> ({formatEval(before)}). Win chance {pct(current.winBefore)} → {pct(current.winAfter)}.</p>
            {:else}
              <p class="note">Win chance {pct(current.winBefore)} → {pct(current.winAfter)}.</p>
            {/if}
            <p class="note">{#if current.best !== current.uci && before.pv.length > 1}Line: {lineSan(fens[current.ply - 1]!, before.pv)}{/if}</p>
          {:else if shown?.best && analysis}
            <p><strong>Start</strong></p>
            <p class="note">Engine line: {lineSan(fens[ply]!, shown.pv)}</p>
            <p class="note"></p>
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
          <button type="button" disabled={prevKey === null} onclick={() => prevKey !== null && (ply = prevKey)} title="Previous key move (↑)">◀ Key</button>
          <button type="button" disabled={nextKey === null} onclick={() => nextKey !== null && (ply = nextKey)} title="Next key move (↓)">Key ▶</button>
          <button type="button" onclick={() => (orientation = orientation === 'white' ? 'black' : 'white')}>Flip</button>
        </div>
        {#if analysis && settings.value.devMode}
          <p class="note small">{analysis.engine}, depth {analysis.depth}</p>
        {/if}
      </aside>
    </div>
  {/if}
</ScreenFrame>

<style>
  .review {
    /* The page fits the window: the board takes the height left after the frame and timeline. */
    --h: max(520px, calc(100dvh - var(--gutter) * 4.2 - 92px));
    --timeline: 86px;
    --board: max(240px, min(calc(var(--h) - var(--timeline)), calc(min(1180px, 100vw - 2 * var(--gutter)) - 440px), 680px));
    display: grid;
    grid-template-columns: auto minmax(300px, 1fr);
    gap: 26px;
    height: var(--h);
    align-items: stretch;
  }
  .board-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: calc(var(--board) + 22px);
  }
  .board-row {
    display: flex;
    gap: 8px;
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
    flex: none;
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
  .timeline svg {
    display: block;
    box-sizing: border-box;
    width: 100%;
    cursor: ew-resize;
    touch-action: none;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
  }
  .timeline svg:focus-visible {
    outline: 2px solid var(--panel-ink);
    outline-offset: 2px;
  }
  .tl-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0.03em;
    min-height: 1.4em;
  }
  .tl-hover {
    color: var(--panel-muted);
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
    stroke-width: 2;
  }
  .g-hover {
    stroke: var(--eval-mid);
    stroke-width: 1;
  }
  .g-dot {
    stroke: var(--eval-white);
    stroke-width: 1;
  }
  .g-dot.note-brilliant {
    fill: var(--review-brilliant);
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
  .side {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .meta {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .meta-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex: none;
  }
  .actions button {
    font-size: 11px;
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }
  .line {
    font-size: var(--ui-size-small);
    color: var(--panel-muted);
    text-transform: none;
    letter-spacing: 0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line.ok {
    color: var(--panel-ink);
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
  .summary {
    display: grid;
    gap: 8px;
    flex: none;
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
  .controls button:disabled {
    opacity: 0.4;
    cursor: default;
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
    padding: 0 6px 0 0;
    text-align: left;
    font-weight: 400;
    font-size: 11px;
    line-height: 1.55;
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 30%, transparent);
  }
  .sides thead th {
    color: var(--panel-muted);
  }
  .sides td {
    width: 22%;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    line-height: 1.35;
  }
  .sides tr.first td {
    font-size: 16px;
  }
  /* The side that did better on a line, in white. */
  .sides td span {
    display: inline-block;
    min-width: 2.4ch;
    padding: 0 5px;
    border-radius: var(--radius);
  }
  .sides td span.better {
    background: #ffffff;
    color: #111111;
    box-shadow: 0 0 0 var(--hairline) var(--panel-ink);
  }
  .glyph {
    display: inline-block;
    min-width: 2.6ch;
    font-weight: 700;
  }
  .note-brilliant {
    color: var(--review-brilliant);
  }
  .note-excellent {
    color: var(--review-excellent);
  }
  .note-best {
    color: var(--review-best);
  }
  .note-good {
    color: var(--review-good);
  }
  .note-book {
    color: var(--review-book);
  }
  .note-neutral {
    color: var(--panel-muted);
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
  /* Three lines, always: the panel never changes height as the moves change. */
  .explain {
    flex: none;
    height: calc(3 * 1.5em);
    font-size: 13px;
    line-height: 1.5;
    overflow: hidden;
  }
  .explain p {
    margin: 0;
    height: 1.5em;
    font-size: inherit;
    text-transform: none;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .explain p.note {
    font-size: 12px;
  }
  .explain .glyph {
    min-width: 0;
    margin: 0 4px 0 6px;
  }
  .who {
    color: var(--panel-muted);
  }
  .moves {
    flex: 1;
    min-height: 60px;
    display: flex;
    flex-direction: column;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    padding: 6px 0;
  }
  .moves :global(ol) {
    flex: 1;
    min-height: 0;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: none;
  }
  @media (max-width: 900px) {
    .review {
      --board: min(calc(100vw - 2 * var(--gutter) - 80px), 72dvh);
      grid-template-columns: 1fr;
      height: auto;
    }
    .board-col {
      margin: 0 auto;
    }
    .moves {
      max-height: 40vh;
    }
  }
</style>
