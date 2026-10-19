<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import { href } from '../app/router.svelte';
  import { storage } from '../storage';
  import type { StoredGame } from '../storage/types';
  import { backupPgn, exportBackup, importBackup } from '../storage/backup';
  import { SPEED_LABEL, formatTimeControl, speedOf } from '../chess/timeControl';
  import { describeTermination } from '../chess/rules';
  import { settings } from '../app/settings.svelte';
  import { rating } from '../rating/rating.svelte';
  import { loadOpenings, nameOpening, type OpeningTable } from '../chess/openings';

  let games = $state<StoredGame[]>([]);
  let open = $state<string | null>(null);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function load() {
    // Aborted games stay in storage (the ledger replay sees them) but are not games played.
    games = (await storage().listGames()).filter((g) => g.outcome && g.outcome.result !== '*');
  }
  let openings = $state<OpeningTable | null>(null);
  onMount(() => {
    void load();
    loadOpenings().then((t) => (openings = t), () => undefined);
  });
  const openingOf = (g: StoredGame) => (openings ? nameOpening(openings, [g.startFen, ...g.moves.map((m) => m.fen)]) : null);

  function save(name: string, text: string, type: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function score(g: StoredGame): string {
    if (!g.outcome || g.outcome.result === '*') return '—';
    if (g.outcome.result === '1/2-1/2') return '½';
    return (g.outcome.winner === g.humanColor) ? '1' : '0';
  }

  async function backup() {
    const b = await exportBackup(storage());
    const stamp = new Date().toISOString().slice(0, 10);
    save(`dither-backup-${stamp}.json`, JSON.stringify(b, null, 1), 'application/json');
    save(`dither-games-${stamp}.pgn`, backupPgn(b), 'application/x-chess-pgn');
    message = `Backup saved: ${b.games.length} games, ${b.ledger.length} rated entries.`;
  }

  async function restore(e: Event) {
    error = message = null;
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const b = await importBackup(storage(), await f.text());
      await settings.load();
      await rating.load(storage());
      await load();
      message = `Restored ${b.games.length} games and ${b.ledger.length} rated entries.`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      fileInput.value = '';
    }
  }

  /** "1. e4 e5 2. Nf3 …" from the stored moves. */
  function moveText(g: StoredGame): string {
    const firstBlack = g.moves[0]?.color === 'b';
    const fullmove = Number(g.startFen.split(' ')[5]) || 1;
    return g.moves
      .map((m, i) => {
        const n = fullmove + Math.floor((i + (firstBlack ? 1 : 0)) / 2);
        if (m.color === 'w') return `${n}. ${m.san}`;
        return i === 0 ? `${n}… ${m.san}` : m.san;
      })
      .join(' ');
  }

  function ratingState(g: StoredGame): 'rated' | 'removed' | 'casual' {
    if (!rating.isInLedger(g.id)) return 'casual';
    return rating.excluded.has(g.id) ? 'removed' : 'rated';
  }

  async function toggleRating(g: StoredGame) {
    const out = ratingState(g) === 'rated';
    await rating.setExcluded(g.id, out);
    message = out ? 'Game taken out of your rating.' : 'Game counts for your rating again.';
  }

  async function copy(g: StoredGame) {
    try {
      await navigator.clipboard.writeText(g.pgn);
      message = 'PGN copied.';
    } catch {
      error = 'Copying is not allowed here; use Download.';
    }
  }
</script>

<ScreenFrame title="History" current="history" wide>
  {#if storage().kind === 'memory'}
    <p class="warning" role="status">
      This browser is not letting DITHER store data (private window or storage blocked), so games are kept only until
      this tab closes. Save a backup before leaving.
    </p>
  {/if}
  {#if games.length === 0}
    <p class="empty">No finished games yet.</p>
    <p class="note">Every finished game is kept here with its PGN. <a href={href({ name: 'home' })}>Pick an opponent</a> to play one.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Opponent</th>
          <th scope="col">Colour</th>
          <th scope="col">Clock</th>
          <th scope="col">Result</th>
          <th scope="col">Score</th>
          <th scope="col"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each games as g (g.id)}
          <tr class:open={open === g.id}>
            <td>{new Date(g.startedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
            <td class="opp">
              {g.botName}
              {#if openingOf(g)}<span class="opening">{openingOf(g)!.name}</span>{/if}
            </td>
            <td>{g.humanColor === 'w' ? 'White' : 'Black'}</td>
            <td>
              {formatTimeControl(g.timeControl)}
              {#if ratingState(g) === 'rated'}<span class="tag">{SPEED_LABEL[speedOf(g.timeControl)]}</span>
              {:else if ratingState(g) === 'removed'}<span class="tag off">Removed</span>{/if}
            </td>
            <td>{g.outcome ? describeTermination(g.outcome) : ''}</td>
            <td class="score">{score(g)}</td>
            <td class="act">
              <button onclick={() => (open = open === g.id ? null : g.id)} aria-expanded={open === g.id}>{open === g.id ? 'Close' : 'Details'}</button>
            </td>
          </tr>
          {#if open === g.id}
            <tr class="pgn-row">
              <td colspan="7">
                <p class="moves">{moveText(g) || 'No moves.'}</p>
                {#if settings.value.devMode}
                  <pre class="pgn" data-testid="dev-pgn">{g.pgn}</pre>
                {/if}
                <div class="row-actions">
                  {#if g.moves.length > 0}
                    <a class="button" href={href({ name: 'analysis', game: g.id })}>{g.analysis ? 'Open review' : 'Review with Stockfish'}</a>
                  {/if}
                  {#if ratingState(g) !== 'casual'}
                    <button onclick={() => toggleRating(g)}>{ratingState(g) === 'rated' ? 'Remove from rating' : 'Count for rating again'}</button>
                  {/if}
                  <button onclick={() => save(`dither-${g.startedAt.slice(0, 10)}-${g.id.slice(0, 6)}.pgn`, g.pgn, 'application/x-chess-pgn')}>Download PGN</button>
                  {#if settings.value.devMode}<button onclick={() => copy(g)}>Copy PGN</button>{/if}
                </div>
                {#if ratingState(g) !== 'casual'}
                  <p class="note">
                    {ratingState(g) === 'rated'
                      ? `Counts for your ${SPEED_LABEL[speedOf(g.timeControl)].toLowerCase()} rating. Removing it recomputes the rating as if the game had been casual; you can undo it.`
                      : 'Taken out of your rating. Counting it again restores its effect.'}
                  </p>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}

  <section class="backup">
    <h2 class="label">Backup</h2>
    <p class="note">Everything on this device: games, the rating ledger and settings, as JSON plus a PGN file of all games.</p>
    <div class="row-actions">
      <button onclick={backup}>Export backup</button>
      <label class="file">
        <input bind:this={fileInput} type="file" accept=".json,application/json" onchange={restore} />
        <span>Import backup</span>
      </label>
    </div>
    <p class="note">Importing replaces what is stored here.</p>
    {#if message}<p class="ok" role="status">{message}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>
</ScreenFrame>

<style>
  .warning {
    margin: 0 0 16px;
    padding: 10px 12px;
    border: 1px solid var(--panel-ink);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.04em;
  }
  .empty {
    margin: 0 0 10px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    text-transform: uppercase;
  }
  .note {
    margin: 0 0 10px;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.04em;
  }
  a {
    color: var(--panel-ink);
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    text-align: left;
    font-weight: 400;
    color: var(--panel-muted);
    padding: 0 10px 10px 0;
  }
  td {
    padding: 9px 10px 9px 0;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 40%, transparent);
    vertical-align: top;
  }
  .opp {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.01em;
  }
  .opp .opening {
    display: block;
    margin-top: 3px;
    font-family: var(--font-ui);
    font-weight: 400;
    font-size: 11px;
    color: var(--panel-muted);
    text-transform: none;
    letter-spacing: 0.03em;
  }
  .score {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
  }
  .act button,
  .row-actions button,
  .row-actions a.button,
  .file span {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    height: 30px;
    padding: 0 10px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    font: inherit;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .file {
    position: relative;
    display: inline-flex;
  }
  .file:focus-within span {
    outline: 2px solid var(--panel-ink);
    outline-offset: 2px;
  }
  .tag {
    margin-left: 6px;
    padding: 1px 5px;
    border: var(--hairline) solid currentColor;
    border-radius: var(--radius);
    font-size: 10px;
    letter-spacing: 0.12em;
  }
  .tag.off {
    color: var(--panel-muted);
    border-style: dashed;
  }
  .moves {
    margin: 0 0 12px;
    max-width: 90ch;
    font-size: 12px;
    line-height: 1.7;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .pgn-row td {
    border-top: 0;
  }
  .pgn {
    margin: 0 0 10px;
    padding: 12px;
    max-height: 280px;
    overflow: auto;
    white-space: pre-wrap;
    font-family: var(--font-ui);
    font-size: 12px;
    text-transform: none;
    letter-spacing: 0.02em;
    border: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 50%, transparent);
    border-radius: var(--radius);
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .backup {
    margin-top: 34px;
    padding-top: 20px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
  }
  .backup h2 {
    margin: 0 0 8px;
    font-weight: 400;
  }
  .file input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .ok {
    margin: 6px 0 0;
  }
  .error {
    margin: 6px 0 0;
    color: var(--flag);
  }
  @media (max-width: 760px) {
    th:nth-child(3),
    td:nth-child(3),
    th:nth-child(5),
    td:nth-child(5) {
      display: none;
    }
  }
</style>
