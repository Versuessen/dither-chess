<script lang="ts">
  import { boardPalette } from '../app/colours';
  import { onMount, untrack } from 'svelte';
  import type { Key } from 'chessground/types';
  import Board from '../game/Board.svelte';
  import Clock from '../game/Clock.svelte';
  import MoveList from '../game/MoveList.svelte';
  import PromotionPicker from '../game/PromotionPicker.svelte';
  import LabelValue from '../ui/LabelValue.svelte';
  import { GameController } from '../game/controller.svelte';
  import { play as playSound, soundForSan } from '../game/sounds';
  import { settings } from '../app/settings.svelte';
  import { ui } from '../app/ui.svelte';
  import { router, href } from '../app/router.svelte';
  import { session } from '../app/session.svelte';
  import { personaById } from '../bots/personas';
  import { modelInfo } from '../models/catalog';
  import { formatTimeControl, speedOf, SPEED_LABEL } from '../chess/timeControl';
  import type { GameSetup } from '../chess/setup';
  import type { Opponent } from '../bots/opponent';
  import type { AppStorage, StoredGame } from '../storage/types';
  import { createRng } from '../lib/rng';
  import { parseTypedMove, spokenSan } from '../game/typedMove';
  import { quality } from '../rating/quality.svelte';
  import { quote } from '../rating/moveQuality';
  import { rating, ratingLabel } from '../rating/rating.svelte';
  import { loadOpenings, nameOpening, type OpeningTable } from '../chess/openings';

  interface Props {
    setup: GameSetup;
    createOpponent: (setup: GameSetup, seed: number) => Promise<Opponent>;
    storage: AppStorage | null;
    onfinished?: (game: StoredGame) => void | Promise<void>;
  }
  let { setup, createOpponent, storage, onfinished }: Props = $props();

  const persona = $derived(personaById(setup.persona));
  let controller = $state<GameController | null>(null);
  let failure = $state<string | null>(null);
  let orientation = $state<'white' | 'black'>('white');
  let viewing = $state<number | null>(null);
  let promotion = $state<{ from: Key; to: Key } | null>(null);
  let confirm = $state<'resign' | 'leave' | 'takeback' | null>(null);
  let board: ReturnType<typeof Board> | undefined = $state();
  let copied = $state(false);

  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;

  let openings = $state<OpeningTable | null>(null);
  loadOpenings().then((t) => (openings = t), () => undefined);
  const opening = $derived(
    openings && controller ? nameOpening(openings, [controller.game.startFen, ...controller.moves.slice(0, viewing ?? undefined).map((m) => m.fen)]) : null
  );

  onMount(() => {
    let disposed = false;
    let raf = 0;
    let lastLowTick = -1;
    (async () => {
      let opponent: Opponent;
      try {
        opponent = await createOpponent(setup, seed);
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        return;
      }
      if (disposed) {
        opponent.dispose();
        return;
      }
      const humanColor =
        setup.colour === 'white' ? 'w' : setup.colour === 'black' ? 'b' : createRng(seed).next() < 0.5 ? 'w' : 'b';
      orientation = humanColor === 'w' ? 'white' : 'black';
      const c = new GameController({
        id: crypto.randomUUID(),
        opponent,
        botName: `${persona?.name ?? 'Bot'} (${modelInfo(setup.family).name} ${setup.level})`,
        persona: setup.persona,
        humanColor,
        timeControl: setup.timeControl,
        rated: setup.rated,
        instantBot: () => settings.value.instantBot,
        storage,
        onFinished: async (g) => {
          if (settings.value.sounds) playSound('end');
          await onfinished?.(g);
        }
      });
      c.onBotMoved = () => board?.playPremove();
      controller = c;
      c.start();
      const loop = () => {
        c.tick();
        // A soft tick each second under ten seconds on the human's clock.
        const mine = c.humanColor === 'w' ? c.clockWhite : c.clockBlack;
        if (settings.value.sounds && c.humanToMove && Number.isFinite(mine) && mine < 10_000) {
          const s = Math.ceil(mine / 1000);
          if (s !== lastLowTick) {
            lastLowTick = s;
            playSound('low-time');
          }
        }
        if (!c.outcome) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (controller && !controller.outcome) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('beforeunload', beforeUnload);
      if (controller && !controller.outcome) controller.abort();
      controller?.opts.opponent.dispose();
      controller?.dispose();
    };
  });

  // Move sounds.
  let soundedPly = 0;
  $effect(() => {
    const c = controller;
    if (!c) return;
    const n = c.moves.length;
    untrack(() => {
      if (n > soundedPly && settings.value.sounds) playSound(soundForSan(c.moves[n - 1]!.san));
      soundedPly = n;
      if (viewing !== null && n > 0) viewing = null; // a new move returns to the live position
    });
  });

  const live = $derived(viewing === null);
  const shownFen = $derived.by(() => {
    const c = controller;
    if (!c) return 'start';
    if (viewing === null) return c.fen;
    return viewing === 0 ? c.game.startFen : c.moves[viewing - 1]!.fen;
  });
  const shownLastMove = $derived.by((): [Key, Key] | undefined => {
    const c = controller;
    if (!c) return undefined;
    const ply = viewing ?? c.moves.length;
    const m = c.moves[ply - 1];
    return m ? [m.uci.slice(0, 2) as Key, m.uci.slice(2, 4) as Key] : undefined;
  });
  const humanCg = $derived(controller?.humanColor === 'b' ? 'black' : 'white');
  const dests = $derived(controller && live && controller.humanToMove ? controller.legalDests() : new Map());
  const initialClock = $derived(
    setup.timeControl.base === 0 && setup.timeControl.increment === 0 ? Infinity : setup.timeControl.base * 1000
  );
  const botClock = $derived(controller ? (controller.humanColor === 'w' ? controller.clockBlack : controller.clockWhite) : initialClock);
  const myClock = $derived(controller ? (controller.humanColor === 'w' ? controller.clockWhite : controller.clockBlack) : initialClock);
  const botColor = $derived(controller?.humanColor === 'w' ? 'b' : 'w');

  function onmove(orig: Key, dest: Key) {
    const c = controller;
    if (!c) return;
    if (c.needsPromotion(orig as never, dest as never)) {
      if (settings.value.autoQueen || !c.humanToMove) {
        c.humanMove(orig + dest + 'q');
      } else {
        promotion = { from: orig, to: dest };
      }
      return;
    }
    if (!c.humanMove(orig + dest)) board?.reset();
  }

  function pick(piece: 'q' | 'r' | 'b' | 'n') {
    if (!promotion || !controller) return;
    const p = promotion;
    promotion = null;
    if (!controller.humanMove(p.from + p.to + piece)) board?.reset();
  }

  function cancelPromotion() {
    promotion = null;
    board?.reset();
  }

  // Keyboard move entry (SAN such as "Nf3", "exd5", "O-O", "e8=Q", or UCI such as "e2e4").
  let typed = $state('');
  let typedError = $state<string | null>(null);
  function submitTyped(e: SubmitEvent) {
    e.preventDefault();
    const c = controller;
    const text = typed.trim();
    if (!c || !text) return;
    if (!c.humanToMove || !live) {
      typedError = 'Wait for your turn.';
      return;
    }
    const uci = parseTypedMove(c.fen, text);
    if (!uci || !c.humanMove(uci)) {
      typedError = `${text} is not a legal move here.`;
      return;
    }
    typed = '';
    typedError = null;
  }

  /** Announcement of the latest move for screen readers. */
  const announcement = $derived.by(() => {
    const c = controller;
    const m = c?.moves.at(-1);
    if (!c || !m) return '';
    return `${m.color === c.humanColor ? 'You played' : 'The bot played'} ${spokenSan(m.san)}`;
  });

  /** Leaving aborts the game (never rated); a game under way asks first. */
  function leave() {
    if (controller && !controller.outcome && controller.moves.some((m) => m.color === controller!.humanColor)) {
      confirm = 'leave';
      return;
    }
    if (controller && !controller.outcome) controller.abort();
    router.go({ name: 'home' });
  }

  function doConfirm() {
    const c = controller;
    const what = confirm;
    confirm = null;
    if (!c) return;
    if (what === 'resign') c.resign();
    else if (what === 'leave') {
      c.abort();
      router.go({ name: 'home' });
    } else if (what === 'takeback') c.takeback();
  }

  function takeback() {
    const c = controller;
    if (!c) return;
    if (c.rated) confirm = 'takeback';
    else c.takeback();
  }

  function playAgain() {
    session.pending = { ...setup };
    session.gameNo++;
  }

  async function copyPgn() {
    if (!controller) return;
    try {
      await navigator.clipboard.writeText(controller.pgn());
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      copied = false;
    }
  }

  function downloadPgn() {
    if (!controller) return;
    const blob = new Blob([controller.pgn()], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dither-${controller.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function onKeydown(e: KeyboardEvent) {
    const c = controller;
    if (!c || promotion || confirm) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const n = c.moves.length;
    const at = viewing ?? n;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        viewing = Math.max(0, at - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        viewing = at + 1 >= n ? null : at + 1;
        break;
      case 'Home':
        e.preventDefault();
        viewing = 0;
        break;
      case 'End':
        e.preventDefault();
        viewing = null;
        break;
      case 'f':
      case 'F':
        orientation = orientation === 'white' ? 'black' : 'white';
        break;
      case 'Escape':
        e.preventDefault();
        leave();
        break;
    }
  }

  const rated = $derived(controller ? controller.rated : setup.rated);
  const speed = $derived(speedOf(setup.timeControl));
  const bothMoved = $derived(!!controller && controller.moves.some((m) => m.color === 'w') && controller.moves.some((m) => m.color === 'b'));

  function setPace(instant: boolean) {
    void settings.update({ instantBot: instant });
    if (instant) controller?.hurry();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- data-fen / data-state / data-inference-ms describe the live game for tooling, end-to-end and performance tests. -->
<div
  class="screen-game"
  data-fen={controller?.fen ?? ''}
  data-state={!controller ? 'loading' : controller.outcome ? 'over' : controller.humanToMove ? 'human' : 'bot'}
  data-inference-ms={controller?.lastInferenceMs?.toFixed(1) ?? ''}
>
  <a class="corner top-left wordmark" href={href({ name: 'home' })} onclick={(e) => { e.preventDefault(); leave(); }}>DITHER</a>
  <div class="corner top-right status">
    <span>{rated ? `Rated ${SPEED_LABEL[speed]}` : 'Casual'}</span>
    <span>{formatTimeControl(setup.timeControl)}</span>
  </div>

  <main class="panel" aria-label="Game">
    <header class="head">
      <span>Game · {persona?.name ?? ''}</span>
      <button class="close" onclick={leave}>{controller?.outcome ? 'Close' : 'Leave'}</button>
    </header>
    <hr />

    {#if failure}
      <div class="failure">
        <p class="big">The bot could not start.</p>
        <p class="note">{failure}</p>
        <a class="action" href={href({ name: 'models' })}>Open models</a>
      </div>
    {:else}
      <div class="layout">
        <div class="board-col">
          <div class="board-wrap">
            <Board
              bind:this={board}
              fen={shownFen}
              {orientation}
              turnColor={controller?.turn === 'b' ? 'black' : 'white'}
              movableColor={controller && live && !controller.outcome ? humanCg : undefined}
              {dests}
              lastMove={shownLastMove}
              check={live && (controller?.check ?? false)}
              coordinates={settings.value.coordinates}
              showDests={settings.value.showDests}
              premoves={settings.value.premoves && live}
              palette={boardPalette(settings.value.colours)}
              pieceSet={settings.value.pieceSet}
              animate={!ui.reducedMotion}
              viewOnly={!live || !controller || !!controller.outcome}
              label="Chess board, you play {humanCg}"
              {onmove}
            />
            {#if promotion && controller}
              <PromotionPicker
                file={promotion.to.charCodeAt(0) - 97}
                whiteBottom={orientation === 'white'}
                color={humanCg}
                pieceSet={settings.value.pieceSet}
                onpick={pick}
                oncancel={cancelPromotion}
              />
            {/if}
          </div>
        </div>

        <aside class="side">
          <div class="who">
            <LabelValue label="Opponent" value="{modelInfo(setup.family).name} · {setup.level}" />
            <span class="label scale">Lichess rapid</span>
          </div>
          <Clock ms={botClock} active={controller?.clockRunning === botColor} label="Opponent's clock" />
          <div class="pace-row">
            <div class="pace" role="group" aria-label="Bot pace">
              <button type="button" aria-pressed={!settings.value.instantBot} onclick={() => setPace(false)} title="Pauses like a human player of its level">Human</button>
              <button type="button" aria-pressed={settings.value.instantBot} onclick={() => setPace(true)} title="Moves as soon as it has chosen">Instant</button>
            </div>
            <span class="thinking label" aria-live="polite">{controller?.thinking ? 'Thinking' : ' '}</span>
          </div>
          <p class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

          <div class="moves">
            <p class="opening" data-testid="opening" title={opening ? `ECO ${opening.eco}` : undefined}>
              {#if opening}<span class="eco">{opening.eco}</span> {opening.name}{:else}&nbsp;{/if}
            </p>
            {#if controller}
              <MoveList moves={controller.moves} viewing={viewing ?? controller.moves.length} onselect={(p) => (viewing = p === controller!.moves.length ? null : p)} />
            {/if}
          </div>

          <Clock ms={myClock} active={controller?.clockRunning === controller?.humanColor} label="Your clock" />
          <div class="who you"><span class="label">You</span></div>

          {#if controller?.notice}
            <p class="notice" role="status">{controller.notice.text}</p>
          {/if}

          {#if controller?.outcome}
            <section class="result" aria-live="polite">
              <p class="big">{controller.outcome.result === '*' ? 'Aborted' : controller.outcome.result}</p>
              <p class="note">{controller.resultText}{controller.outcome.result !== '*' ? (controller.rated ? ` · rated ${SPEED_LABEL[speed].toLowerCase()}` : ' · casual') : ' · not rated'}</p>
              {#if controller.outcome.result !== '*' && controller.rated && rating.of(speed)}
                {@const rs = rating.of(speed)!}
                <p class="note rating-line" data-testid="rating-after">
                  {SPEED_LABEL[speed]} rating {ratingLabel(rs, 'live')}{rs.published !== null && rs.live !== null && rs.live !== rs.published
                    ? ` live (${rs.live - rs.published > 0 ? '+' : ''}${rs.live - rs.published} this month)`
                    : rs.published === null && rs.live !== null
                      ? ' provisional'
                      : ''}
                </p>
              {/if}
              {#if controller.outcome.result !== '*'}
                {@const q = quality.status[controller.opts.id]}
                <div class="quality" data-quality={q?.kind ?? 'none'}>
                  {#if q?.kind === 'done'}
                    <span class="label">Move quality</span>
                    <span class="q-value">{quote(q.quality.mean)}</span>
                    <span class="note">
                      −{Math.round(q.quality.minus)}/+{Math.round(q.quality.plus)} · syst. ±{Math.round(q.quality.syst)} · fastelo estimate
                      from your {q.quality.userMoves} moves, not your rating
                    </span>
                  {:else if q?.kind === 'pending'}
                    <span class="note">Estimating move quality…</span>
                  {:else if q?.kind === 'unavailable'}
                    <span class="note">{q.reason}</span>
                  {/if}
                </div>
              {/if}
              <div class="actions">
                <button class="primary" onclick={playAgain}>Play again</button>
                <button onclick={copyPgn}>{copied ? 'Copied' : 'Copy PGN'}</button>
                <button onclick={downloadPgn}>Download PGN</button>
                <a href={href({ name: 'home' })}>Roster</a>
              </div>
            </section>
          {:else if confirm}
            <div class="confirm" role="alertdialog" aria-label="Confirm" tabindex="-1">
              <p>
                {confirm === 'resign'
                  ? 'Resign this game?'
                  : confirm === 'leave'
                    ? 'Leave and abort this game? Aborted games never count for your rating.'
                    : 'A takeback makes this game unrated. Take back?'}
              </p>
              <div class="actions">
                <button class="primary" onclick={doConfirm}>{confirm === 'resign' ? 'Resign' : confirm === 'leave' ? 'Abort and leave' : 'Take back'}</button>
                <button onclick={() => (confirm = null)}>Cancel</button>
              </div>
            </div>
          {:else if controller}
            <form class="typed" onsubmit={submitTyped}>
              <label class="label" for="typed-move">Type a move</label>
              <input
                id="typed-move"
                autocomplete="off"
                spellcheck="false"
                placeholder="e4, Nf3, O-O, e2e4"
                bind:value={typed}
                oninput={() => (typedError = null)}
                aria-describedby="typed-error"
              />
              <span id="typed-error" class="typed-error" role="status">{typedError ?? ''}</span>
            </form>
            <div class="controls">
              {#if bothMoved}
                <button onclick={() => (confirm = 'resign')}>Resign</button>
              {/if}
              <button onclick={() => controller!.abort()} title="End the game without a result; it never counts for your rating">Abort</button>
              {#if controller.claimable && controller.humanToMove}
                <button onclick={() => controller!.claimDraw()}>Claim draw</button>
              {:else}
                <button disabled={!controller.canOfferDraw() || !bothMoved} onclick={() => controller!.offerDraw()}>Offer draw</button>
              {/if}
              <button disabled={!controller.moves.some((m) => m.color === controller!.humanColor)} onclick={takeback}>Takeback</button>
              <button onclick={() => (orientation = orientation === 'white' ? 'black' : 'white')} aria-label="Flip board">Flip</button>
            </div>
          {:else}
            <p class="label">Warming up the model</p>
          {/if}
        </aside>
      </div>
    {/if}
  </main>
</div>

<style>
  .screen-game {
    position: fixed;
    inset: 0;
    z-index: 5;
    color: var(--over-dither);
    overflow-y: auto;
  }
  .corner {
    position: fixed;
    padding: var(--gutter);
    line-height: 1;
    z-index: 6;
  }
  .top-left {
    top: 0;
    left: 0;
  }
  .wordmark {
    letter-spacing: 0.6em;
  }
  .top-right {
    top: 0;
    right: 0;
    display: flex;
    gap: 2em;
  }
  .panel {
    position: relative;
    margin: calc(var(--gutter) * 2.6) auto var(--gutter);
    width: min(1180px, calc(100vw - 2 * var(--gutter)));
    background: var(--panel);
    color: var(--panel-ink);
    border-radius: var(--radius);
    padding: 18px 22px 22px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  .close:hover {
    color: var(--panel-ink);
  }
  hr {
    border: 0;
    border-top: var(--hairline) solid var(--panel-muted);
    opacity: 0.6;
    margin: 14px 0 18px;
  }
  .layout {
    /* The side column is exactly as tall as the board; the move list takes up the slack. */
    --board: max(280px, min(calc(100dvh - var(--gutter) * 2.6 - 120px), 72vw, 760px));
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(260px, 340px);
    gap: 26px;
    align-items: start;
  }
  .board-col {
    display: flex;
    justify-content: center;
  }
  .board-wrap {
    position: relative;
    width: var(--board);
  }
  .side {
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto auto auto auto;
    gap: 8px;
    height: var(--board);
    min-height: 0;
  }
  .who {
    display: flex;
    justify-content: space-between;
    align-items: end;
  }
  .scale {
    font-size: 11px;
  }
  .pace-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 1.6em;
  }
  .pace {
    display: inline-flex;
    border: var(--hairline) solid var(--panel-muted);
    border-radius: var(--radius);
    overflow: hidden;
    font-size: 11px;
  }
  .pace button {
    padding: 3px 9px;
    color: var(--panel-muted);
    letter-spacing: 0.14em;
  }
  .pace button[aria-pressed='true'] {
    background: var(--panel-ink);
    color: var(--panel);
  }
  .pace button:focus-visible {
    outline: 2px solid var(--panel-ink);
    outline-offset: -2px;
  }
  .thinking {
    min-height: 1.2em;
  }
  .moves {
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    padding: 6px 0;
  }
  .opening {
    margin: 0 0 6px;
    min-height: 1.3em;
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .eco {
    color: var(--panel-muted);
    letter-spacing: 0.1em;
  }
  .moves :global(ol) {
    flex: 1;
    min-height: 0;
  }
  .controls,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: var(--ui-size-small);
  }
  .controls button,
  .actions button,
  .actions a,
  .action {
    padding: 8px 0;
    color: var(--panel-ink);
  }
  .controls button:disabled {
    color: var(--ink-faint);
    cursor: not-allowed;
  }
  .controls button:not(:disabled):hover,
  .actions button:hover,
  .actions a:hover {
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }
  .actions .primary {
    background: var(--button);
    color: var(--button-ink);
    padding: 10px 18px;
    border-radius: var(--radius);
    letter-spacing: 0.24em;
  }
  .actions .primary:hover {
    text-decoration: none;
  }
  .result,
  .confirm {
    display: grid;
    gap: 10px;
    padding-top: 6px;
  }
  .big {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    line-height: 1;
    text-transform: uppercase;
  }
  .note,
  .notice,
  .confirm p {
    margin: 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  .notice {
    color: var(--panel-ink);
  }
  .typed {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 4px 12px;
  }
  .typed input {
    min-width: 0;
    padding: 6px 8px;
    font: inherit;
    font-size: var(--ui-size-small);
    color: var(--panel-ink);
    background: transparent;
    border: var(--hairline) solid var(--panel-muted);
    border-radius: var(--radius);
  }
  .typed input:focus-visible {
    outline: 2px solid var(--panel-ink);
    outline-offset: 1px;
  }
  .typed-error {
    grid-column: 1 / -1;
    min-height: 1.2em;
    color: var(--panel-ink);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.04em;
  }
  .quality {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 2px 12px;
  }
  .quality .note {
    grid-column: 1 / -1;
    text-transform: none;
    letter-spacing: 0.04em;
  }
  .q-value {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    text-transform: uppercase;
  }
  .failure {
    display: grid;
    gap: 12px;
    padding: 20px 0;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .board-wrap {
      width: min(100%, 72dvh);
    }
    .side {
      height: auto;
    }
    .moves {
      max-height: 22vh;
    }
  }
</style>
