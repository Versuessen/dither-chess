<script lang="ts">
  import { onMount } from 'svelte';
  import type { Key } from 'chessground/types';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import Board from '../game/Board.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { settings } from '../app/settings.svelte';
  import { boardPalette } from '../app/colours';
  import { ui } from '../app/ui.svelte';
  import { play as playSound, preloadSounds, soundForSan, type SoundName } from '../game/sounds';
  import { loadPuzzles, themesOf, THEME_LABEL, type Puzzle } from '../puzzles/data';
  import { DIFFICULTIES, MOTIFS, PHASES, PIECE_FILTERS, matching, pickPuzzle, type Filters } from '../puzzles/filters';
  import { PuzzleRun } from '../puzzles/run';
  import { introFor } from '../puzzles/intro';
  import { puzzles, type PuzzleResult } from '../puzzles/progress.svelte';

  let all = $state<Puzzle[] | null>(null);
  let failure = $state<string | null>(null);
  let run = $state<PuzzleRun | null>(null);
  /** Bumped whenever the run changes, since PuzzleRun is a plain object. */
  let rev = $state(0);
  let intro = $state('');
  type Phase = 'loading' | 'opening' | 'solving' | 'wrong' | 'good' | 'solved' | 'shown';
  let phase = $state<Phase>('loading');
  /** What has been recorded for this puzzle (null: nothing yet). */
  let recorded = $state<PuzzleResult | null>(null);
  let delta = $state<number | null>(null);
  let hint = $state<Key | null>(null);
  let touched = false;
  let board: ReturnType<typeof Board> | undefined = $state();
  let token = 0;

  const filters = $derived(puzzles.value.filters);
  const pool = $derived(all ? matching(all, filters, puzzles.value.rating) : []);

  const sound = (name: SoundName, gain = 1) => {
    if (settings.value.sounds) playSound(name, gain);
  };
  const wait = (ms: number, t: number) => new Promise<boolean>((r) => setTimeout(() => r(t === token), ui.reducedMotion ? Math.min(ms, 150) : ms));

  onMount(() => {
    if (settings.value.sounds) preloadSounds();
    void (async () => {
      try {
        await puzzles.load();
        all = await loadPuzzles();
        await next();
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      token++;
    };
  });

  /** Leaving a started puzzle unsolved still counts it as seen (no rating change). */
  async function leaveCurrent() {
    if (run && touched && !recorded) await puzzles.record(run.puzzle.id, run.puzzle.rating, 'assisted');
  }

  async function next() {
    if (!all) return;
    await leaveCurrent();
    const p = pickPuzzle(pool, puzzles.lastPlayed(), Date.now(), Math.random, run?.puzzle.id);
    if (!p) {
      run = null;
      phase = 'loading';
      return;
    }
    const t = ++token;
    run = new PuzzleRun(p);
    recorded = null;
    delta = null;
    hint = null;
    touched = false;
    phase = 'opening';
    intro = introFor(p, run.solver, run.sanOf(p.moves[0]!));
    rev++;
    if (!(await wait(700, t))) return;
    const san = run.opponentMove();
    if (san) sound(soundForSan(san));
    phase = 'solving';
    rev++;
  }

  async function record(result: PuzzleResult) {
    if (!run || recorded) return;
    recorded = result;
    delta = await puzzles.record(run.puzzle.id, run.puzzle.rating, result);
  }

  async function onmove(from: Key, to: Key) {
    const r = run;
    if (!r || !r.solverToMove) return;
    touched = true;
    hint = null;
    const uci = `${from}${to}${r.promotionFor(from, to) ?? ''}`;
    const san = (() => {
      try {
        return r.sanOf(uci);
      } catch {
        return null;
      }
    })();
    const result = r.tryMove(uci);
    if (result === 'wrong') {
      phase = 'wrong';
      sound('illegal', 0.7);
      await record('failed');
      board?.reset();
      rev++;
      return;
    }
    if (san) sound(soundForSan(san));
    rev++;
    if (result === 'solved') return finish();
    phase = 'good';
    const t = token;
    if (!(await wait(450, t))) return;
    const reply = r.opponentMove();
    if (reply) sound(soundForSan(reply));
    phase = 'solving';
    rev++;
  }

  async function finish() {
    phase = 'solved';
    sound('confirm');
    await record(hintUsed ? 'assisted' : 'solved');
  }

  let hintUsed = false;
  function showHint() {
    const r = run;
    if (!r?.expected) return;
    hint = r.expected.slice(0, 2) as Key;
    hintUsed = true;
    touched = true;
  }

  /** Play the rest of the solution, one move at a time. */
  async function showSolution() {
    const r = run;
    if (!r || r.done) return;
    touched = true;
    hint = null;
    await record('failed');
    phase = 'shown';
    const t = token;
    while (!r.done) {
      const uci = r.expected ?? r.puzzle.moves[r.ply]!;
      const san = r.solverToMove ? r.sanOf(uci) : null;
      if (r.solverToMove) r.tryMove(uci);
      else r.opponentMove();
      if (san) sound(soundForSan(san));
      rev++;
      if (!r.done && !(await wait(650, t))) return;
    }
  }

  async function setFilters(patch: Partial<Filters>) {
    await puzzles.setFilters({ ...filters, ...patch });
    hintUsed = false;
    await next();
  }

  async function nextPuzzle() {
    hintUsed = false;
    await next();
  }

  // The board, from the run (read through rev).
  const view = $derived.by(() => {
    void rev;
    const r = run;
    if (!r) return null;
    const cg = (c: 'w' | 'b') => (c === 'w' ? 'white' : 'black') as 'white' | 'black';
    return {
      fen: r.fen,
      orientation: cg(r.solver),
      turnColor: cg(r.turn),
      movable: r.solverToMove && phase !== 'shown' ? cg(r.solver) : undefined,
      dests: r.dests() as Map<Key, Key[]>,
      lastMove: (r.lastMove ?? undefined) as [Key, Key] | undefined,
      check: r.inCheck ? cg(r.turn) : (false as const),
      done: r.done
    };
  });

  const status = $derived.by(() => {
    switch (phase) {
      case 'opening':
        return 'Get ready…';
      case 'solving':
        return run?.ply === 1 ? 'Your move.' : 'Keep going.';
      case 'good':
        return 'Good move.';
      case 'wrong':
        return 'Not this one. Try again, or see the solution.';
      case 'solved':
        return recorded === 'solved' ? 'Solved.' : recorded === 'assisted' ? 'Solved, with a hint.' : 'Solved, after a miss.';
      case 'shown':
        return 'That was the solution.';
      default:
        return '';
    }
  });
  const revealed = $derived(run && (phase === 'solved' || phase === 'shown') ? themesOf(run.puzzle).filter((t) => !['oneMove', 'short', 'long', 'veryLong'].includes(t)) : []);
  const p = $derived(puzzles.value);
  const ply = $derived.by(() => {
    void rev;
    return run?.ply ?? 0;
  });
</script>

<ScreenFrame title="Puzzles" current="puzzles" wide>
  {#if failure}
    <p class="note" role="alert">The puzzles could not be loaded: {failure}</p>
  {:else}
    <!-- data-state / data-puzzle / data-ply describe the attempt for the end-to-end tests. -->
    <div class="puzzles" data-state={phase} data-puzzle={run?.puzzle.id ?? ''} data-ply={ply}>
      <div class="board-col">
        <div class="board-wrap">
          {#if view}
            <Board
              bind:this={board}
              fen={view.fen}
              orientation={view.orientation}
              turnColor={view.turnColor}
              movableColor={view.movable}
              dests={view.dests}
              lastMove={view.lastMove}
              check={view.check}
              coordinates={settings.value.coordinates}
              showDests={settings.value.showDests}
              palette={boardPalette(settings.value.colours)}
              pieceSet={settings.value.pieceSet}
              animate={!ui.reducedMotion}
              viewOnly={!view.movable}
              marked={hint ? [hint] : []}
              label="Puzzle board, you play {view.orientation}"
              {onmove}
            />
          {:else}
            <div class="placeholder" aria-hidden="true"></div>
          {/if}
        </div>
      </div>

      <aside class="side">
        <div class="head">
          <span class="label">{run ? `${run.solver === 'w' ? 'White' : 'Black'} to play` : 'Loading'}</span>
          <span class="label rating" title="Your puzzle rating">You {p.rating}{#if delta !== null && delta !== 0}<span class="delta" class:up={delta > 0}> {delta > 0 ? '+' : '−'}{Math.abs(delta)}</span>{/if}</span>
        </div>
        <p class="intro" aria-live="polite">{intro}</p>
        <p class="status" class:bad={phase === 'wrong'} class:good={phase === 'solved'} role="status">{status}</p>

        <div class="actions">
          {#if view?.done}
            <button class="primary" onclick={nextPuzzle}>Next puzzle</button>
          {:else}
            <button onclick={showHint} disabled={!run?.solverToMove || phase === 'shown'}>Hint</button>
            <button onclick={showSolution} disabled={!run || phase === 'opening'}>Solution</button>
            <button onclick={nextPuzzle}>Skip</button>
          {/if}
        </div>

        <div class="after">
          {#if run && revealed.length}
            <p class="themes">
              {#each revealed as t (t)}<span class="chip">{THEME_LABEL[t]}</span>{/each}
            </p>
            <p class="note">Puzzle {run.puzzle.id} · rated {run.puzzle.rating} on Lichess</p>
          {/if}
        </div>

        <dl class="stats">
          <div><dt class="label">Solved</dt><dd>{p.solved}</dd></div>
          <div><dt class="label">Missed</dt><dd>{p.failed}</dd></div>
          <div><dt class="label">Streak</dt><dd>{p.streak}</dd></div>
        </dl>

        <section class="filters" aria-labelledby="pz-filters">
          <h2 id="pz-filters" class="label">Filters <span class="count">· {pool.length.toLocaleString()} puzzles</span></h2>
          <Toggle legend="Difficulty" value={filters.difficulty} options={DIFFICULTIES.map((d) => ({ value: d.id, label: d.label }))} onchange={(v) => setFilters({ difficulty: v })} />
          <Toggle legend="Key piece" value={filters.piece} options={PIECE_FILTERS.map((d) => ({ value: d.id, label: d.label }))} onchange={(v) => setFilters({ piece: v })} />
          <Toggle legend="Phase" value={filters.phase} options={PHASES.map((d) => ({ value: d.id, label: d.label }))} onchange={(v) => setFilters({ phase: v })} />
          <div>
            <label class="label field-label" for="pz-motif">Motif</label>
            <select id="pz-motif" value={filters.motif} onchange={(e) => setFilters({ motif: (e.currentTarget as HTMLSelectElement).value as Filters['motif'] })}>
              {#each MOTIFS as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
            </select>
          </div>
        </section>
      </aside>
    </div>
  {/if}
</ScreenFrame>

<style>
  .puzzles {
    --h: max(500px, calc(100dvh - var(--gutter) * 4.2 - 92px));
    --board: max(240px, min(var(--h), calc(min(1180px, 100vw - 2 * var(--gutter)) - 440px), 680px));
    display: grid;
    grid-template-columns: auto minmax(300px, 1fr);
    gap: 28px;
    min-height: var(--h);
  }
  .board-wrap,
  .placeholder {
    width: var(--board);
  }
  .placeholder {
    aspect-ratio: 1;
    background: color-mix(in srgb, var(--panel-muted) 12%, transparent);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .delta {
    color: var(--review-blunder);
  }
  .delta.up {
    color: var(--review-best);
  }
  .intro {
    margin: 0;
    min-height: 3.2em;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 19px;
    line-height: 1.25;
    text-transform: none;
    letter-spacing: 0.005em;
  }
  .status {
    margin: 0;
    min-height: 1.4em;
    font-size: 13px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .status.bad {
    color: var(--review-blunder);
  }
  .status.good {
    color: var(--review-best);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .actions button {
    padding: 7px 12px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    font-size: 12px;
  }
  .actions button.primary {
    background: var(--button);
    color: var(--button-ink);
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .after {
    min-height: 3.6em;
  }
  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 6px;
  }
  .chip {
    padding: 2px 7px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    font-size: 11px;
  }
  .note {
    margin: 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.03em;
  }
  .stats {
    display: flex;
    gap: 26px;
    margin: 0;
    padding: 10px 0;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 45%, transparent);
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 45%, transparent);
  }
  .stats dd {
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
  }
  .filters {
    display: grid;
    gap: 14px;
  }
  .filters h2 {
    margin: 0;
    font-weight: 400;
  }
  .count {
    color: var(--panel-muted);
  }
  .field-label {
    display: block;
    margin-bottom: 8px;
  }
  select {
    width: 100%;
    max-width: 260px;
    padding: 5px 8px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--panel-ink);
    font: inherit;
    font-size: var(--ui-size-small);
  }
  @media (max-width: 900px) {
    .puzzles {
      --board: min(calc(100vw - 2 * var(--gutter) - 52px), 70dvh);
      grid-template-columns: 1fr;
      min-height: 0;
    }
    .board-col {
      justify-self: center;
    }
  }
</style>
