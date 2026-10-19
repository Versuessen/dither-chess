<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import { href } from '../app/router.svelte';
  import { storage } from '../storage';
  import type { StoredGame } from '../storage/types';
  import { backupPgn, exportBackup, importBackup } from '../storage/backup';
  import { formatTimeControl } from '../chess/timeControl';
  import { describeTermination } from '../chess/rules';
  import { settings } from '../app/settings.svelte';
  import { rating } from '../rating/rating.svelte';

  let games = $state<StoredGame[]>([]);
  let open = $state<string | null>(null);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement;

  async function load() {
    // Aborted games stay in storage (the ledger replay sees them) but are not games played.
    games = (await storage().listGames()).filter((g) => g.outcome && g.outcome.result !== '*');
  }
  onMount(load);

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
            <td class="opp">{g.botName}</td>
            <td>{g.humanColor === 'w' ? 'White' : 'Black'}</td>
            <td>{formatTimeControl(g.timeControl)}{g.rated ? ' · rated' : ''}</td>
            <td>{g.outcome ? describeTermination(g.outcome) : ''}</td>
            <td class="score">{score(g)}</td>
            <td class="act">
              <button onclick={() => (open = open === g.id ? null : g.id)} aria-expanded={open === g.id}>PGN</button>
            </td>
          </tr>
          {#if open === g.id}
            <tr class="pgn-row">
              <td colspan="7">
                <pre class="pgn">{g.pgn}</pre>
                <div class="row-actions">
                  <button onclick={() => copy(g)}>Copy PGN</button>
                  <button onclick={() => save(`dither-${g.startedAt.slice(0, 10)}-${g.id.slice(0, 6)}.pgn`, g.pgn, 'application/x-chess-pgn')}>Download PGN</button>
                </div>
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
  .score {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
  }
  .act button,
  .row-actions button,
  .file span {
    padding: 6px 10px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    font-size: 12px;
    cursor: pointer;
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
