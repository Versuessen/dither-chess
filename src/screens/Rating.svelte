<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import LabelValue from '../ui/LabelValue.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import { rating, ratingLabel } from '../rating/rating.svelte';
  import { RULES } from '../rating/fide';
  import { combine, quote, type QualityMeasurement } from '../rating/moveQuality';
  import { storage } from '../storage';
  import type { StoredGame } from '../storage/types';
  import { href } from '../app/router.svelte';
  import { SPEEDS, SPEED_LABEL, type Speed } from '../chess/timeControl';
  import { speedOfEntry } from '../rating/ledger';

  let games = $state<StoredGame[]>([]);
  let open = $state<string | null>(null);
  let hypo = $state('');
  let birth = $state('');

  onMount(() => {
    rating.refresh();
    void storage()
      .listGames()
      .then((g) => (games = g));
    // A month can turn over while the screen is open.
    const t = setInterval(() => rating.refresh(), 60_000);
    return () => clearInterval(t);
  });

  // The pool shown first is the one played most recently.
  const lastGame = rating.ledger.findLast((e) => e.kind === 'game');
  let speed = $state<Speed>(lastGame?.kind === 'game' ? speedOfEntry(lastGame) : 'rapid');
  const r = $derived(rating.of(speed));
  const s = $derived(r?.settings);
  $effect(() => {
    if (s) {
      hypo = String(s.hypotheticalOpponent);
      birth = s.juniorBirthYear === null ? '' : String(s.juniorBirthYear);
    }
  });

  const monthName = (p: string) =>
    new Date(`${p}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const nextList = $derived.by(() => {
    if (!r) return '';
    const [y, m] = r.currentPeriod.split('-').map(Number);
    const d = new Date(Date.UTC(m === 12 ? y! + 1 : y!, m === 12 ? 0 : m!, 1, 12));
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  });

  const live = $derived(r && r.periods.length ? r.periods[r.periods.length - 1]! : null);
  const unratedNow = $derived(!!r && r.published === null);
  const provisional = $derived(live?.initial ?? null);
  const fideInitial = $derived(
    r && unratedNow && s && s.hypotheticalOpponent !== 1800 ? rating.preview(speed, { hypotheticalOpponent: 1800 }).periods.at(-1)?.initial ?? null : null
  );

  // History graph: the rating at the end of every period, plus the live point.
  const points = $derived.by(() => {
    if (!r) return [] as { period: string; value: number; live: boolean }[];
    return r.periods.filter((p) => p.ratingAfter !== null).map((p) => ({ period: p.period, value: p.ratingAfter!, live: p.live }));
  });
  let graphWidth = $state(640);
  const graph = $derived.by(() => {
    // Drawn at the figure's own width, so text and strokes are never scaled.
    const W = Math.max(280, Math.round(graphWidth));
    const H = 180;
    const left = 48;
    if (points.length === 0) return null;
    const vals = points.map((p) => p.value);
    const lo = Math.floor((Math.min(...vals) - 40) / 100) * 100;
    const hi = Math.ceil((Math.max(...vals) + 40) / 100) * 100;
    const x = (i: number) => (points.length === 1 ? (W + left) / 2 : left + 12 + (i * (W - left - 24)) / (points.length - 1));
    const y = (v: number) => H - 20 - ((v - lo) / (hi - lo)) * (H - 40);
    const closed = points.filter((p) => !p.live);
    const path = closed.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const lastLive = points[points.length - 1]!.live && closed.length > 0;
    const livePath = lastLive
      ? `M${x(closed.length - 1).toFixed(1)},${y(closed.at(-1)!.value).toFixed(1)} L${x(points.length - 1).toFixed(1)},${y(points.at(-1)!.value).toFixed(1)}`
      : '';
    const ticks = [];
    for (let v = lo; v <= hi; v += hi - lo > 400 ? 200 : 100) ticks.push({ v, y: y(v) });
    return { W, H, path, livePath, dots: points.map((p, i) => ({ ...p, x: x(i), y: y(p.value) })), ticks };
  });

  const quality = $derived(
    combine(
      games
        .filter((g) => g.quality)
        .sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''))
        .map(
          (g): QualityMeasurement => ({
            mean: g.quality!.mean,
            minus: g.quality!.minus,
            plus: g.quality!.plus,
            syst: g.quality!.syst,
            resolution: g.quality!.resolution,
            userMoves: g.quality!.userMoves
          })
        )
    )
  );

  function saveHypo() {
    const v = Math.round(Number(hypo));
    if (Number.isFinite(v) && v >= 400 && v <= 2800) void rating.changeSettings({ hypotheticalOpponent: v });
    else hypo = String(s?.hypotheticalOpponent ?? 1800);
  }
  function saveBirth() {
    const t = birth.trim();
    if (!t) return void rating.changeSettings({ juniorBirthYear: null });
    const v = Number(t);
    if (Number.isInteger(v) && v >= 1900 && v <= new Date().getFullYear()) void rating.changeSettings({ juniorBirthYear: v });
    else birth = s?.juniorBirthYear === null || !s ? '' : String(s.juniorBirthYear);
  }
  const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  const score = (x: number) => (x === 0.5 ? '½' : String(x));
</script>

<ScreenFrame title="Rating" current="rating" wide>
  {#if r}
    <div class="speeds">
      <Toggle
        legend="Rating pool"
        value={speed}
        options={SPEEDS.map((sp) => ({ value: sp, label: `${SPEED_LABEL[sp]} ${ratingLabel(rating.of(sp)).replace(/^Unrated.*/, '—')}` }))}
        onchange={(v) => (speed = v)}
      />
    </div>
    <div class="top">
      <div class="status">
        <span class="label">{SPEED_LABEL[speed]} rating · FIDE method · Lichess rapid scale</span>
        <span class="big" data-testid="rating-value">{ratingLabel(r)}</span>
        {#if r.published !== null && r.live !== null && r.live !== r.published}
          <span class="live">Live {r.live} ({fmt(r.live - r.published)} this month)</span>
        {:else if unratedNow && provisional}
          <span class="live">Initial rating {provisional.rating} on the {nextList} list</span>
        {/if}
      </div>
      <div class="facts">
        <LabelValue label="Rating period" value={monthName(r.currentPeriod)} />
        <LabelValue label="Next list" value={nextList} />
        <LabelValue label="K this period" value={r.k === null ? '—' : String(r.k)} />
        <LabelValue label="Rated games" value={String(r.gamesTotal + (live?.games.filter((g) => g.counted).length ?? 0))} />
      </div>
    </div>

    {#if unratedNow}
      <p class="note">
        A rating is published once at least {RULES.initialGames} rated {SPEED_LABEL[speed].toLowerCase()} games, played within {RULES.poolMonths} months,
        are pooled: the average of your opponents plus two hypothetical opponents rated {s?.hypotheticalOpponent}, counted
        as draws, plus the FIDE table value for your score (FIDE 7.2). It appears on the list at the start of the next month.
        {#if provisional}
          From your {provisional.games} games: average {Math.round(provisional.average * 10) / 10}, score {Math.round(provisional.p * 100)}%,
          dp {fmt(provisional.dp)}, so {provisional.rating}{provisional.capped ? ' (capped at 2200)' : ''}.
          {#if fideInitial}With FIDE's 1800 it would be {fideInitial.rating}.{/if}
        {/if}
      </p>
      {#each live?.notes ?? [] as n (n)}<p class="note">{n}</p>{/each}
    {/if}

    {#if graph && points.length > 1}
      <figure class="graph" bind:clientWidth={graphWidth}>
        <svg width={graph.W} height={graph.H} viewBox="0 0 {graph.W} {graph.H}" role="img" aria-label="Rating at the end of each month">
          {#each graph.ticks as t (t.v)}
            <line x1="48" x2={graph.W} y1={t.y} y2={t.y} class="grid" />
            <text x="0" y={t.y + 4} class="tick">{t.v}</text>
          {/each}
          <path d={graph.path} class="line" />
          {#if graph.livePath}<path d={graph.livePath} class="line dashed" />{/if}
          {#each graph.dots as d (d.period)}
            <circle cx={d.x} cy={d.y} r="3.5" class:live={d.live}><title>{monthName(d.period)}: {d.value}{d.live ? ' (live)' : ''}</title></circle>
          {/each}
        </svg>
      </figure>
    {/if}

    <section aria-labelledby="ledger-title">
      <h2 id="ledger-title" class="label">Rating periods</h2>
      {#if r.periods.every((p) => p.games.length === 0)}
        <p class="note">
          No rated {SPEED_LABEL[speed].toLowerCase()} games yet. Each speed has its own rating: bullet, blitz, rapid, and classical (which
          includes untimed games). A game is rated when you choose Rated before it starts, take nothing back and both sides have moved;
          aborted games never count, and History can take any game out of the rating. <a href={href({ name: 'home' })}>Pick an opponent</a>.
        </p>
      {:else}
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Games</th>
              <th scope="col">Score</th>
              <th scope="col">K</th>
              <th scope="col">ΣΔR</th>
              <th scope="col">Change</th>
              <th scope="col">Rating</th>
            </tr>
          </thead>
          <tbody>
            {#each [...r.periods].reverse().filter((p) => p.games.length > 0) as p (p.period)}
              <tr class:live={p.live}>
                <td>
                  <button class="link" aria-expanded={open === p.period} onclick={() => (open = open === p.period ? null : p.period)}>
                    {monthName(p.period)}{p.live ? ' · live' : ''}
                  </button>
                </td>
                <td>{p.games.length}</td>
                <td>{score(p.games.reduce((a, g) => a + g.score, 0))}</td>
                <td>{p.k ?? '—'}</td>
                <td>{p.sumDelta === null ? '—' : p.sumDelta.toFixed(2)}</td>
                <td>{p.change === null ? (p.initial ? 'initial' : '—') : fmt(p.change)}</td>
                <td>{p.ratingAfter ?? `unrated (${Math.min(p.pooled ?? 0, RULES.initialGames)}/${RULES.initialGames})`}</td>
              </tr>
              {#if open === p.period}
                <tr class="detail">
                  <td colspan="7">
                    <ul>
                      {#each p.games as g (g.seq)}
                        <li>
                          {new Date(g.at).toLocaleDateString()} · bot {g.opponentRating} · {score(g.score)}
                          {#if g.pd !== null}· PD {g.pd.toFixed(2)} · ΔR {(g.score - g.pd).toFixed(2)}{/if}
                          {#if !g.counted}· not counted ({g.note}){/if}
                        </li>
                      {/each}
                    </ul>
                    {#if p.initial}
                      <p class="note">
                        Initial rating from {p.initial.games} games: Ra {Math.round(p.initial.average * 10) / 10} (with two hypothetical
                        {p.initial.hypothetical}s), p {p.initial.p.toFixed(2)}, dp {fmt(p.initial.dp)} → {p.initial.rating}.
                      </p>
                    {/if}
                    {#each p.notes as n (n)}<p class="note">{n}</p>{/each}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section aria-labelledby="quality-title">
      <h2 id="quality-title" class="label">Move quality (separate from the rating)</h2>
      {#if quality}
        <p class="q">
          <span class="q-value">{quote(quality.value)}</span>
          <span class="note">
            −{Math.round(quality.minus)}/+{Math.round(quality.plus)} statistical, ±{Math.round(quality.syst)} systematic · fastelo estimate from
            the moves of your last {quality.games} games. It says what your moves look like, not your results, and is quoted only between 600
            and 2200.
          </span>
        </p>
      {:else}
        <p class="note">After each game the fastelo model estimates the rating your moves look like. Install the fastelo pack to see it.</p>
      {/if}
    </section>

    <section aria-labelledby="settings-title">
      <h2 id="settings-title" class="label">Deviations from FIDE</h2>
      <div class="settings">
        <div>
          <label class="label" for="hypo">Hypothetical opponents (FIDE: 1800)</label>
          <input id="hypo" inputmode="numeric" bind:value={hypo} onchange={saveHypo} />
          <p class="note">
            Used for an initial rating from the month it is changed.
            {#if r.published !== null}You are already rated, so it no longer changes anything.{/if}
          </p>
        </div>
        <div>
          <Toggle
            legend="1400 floor (FIDE: on)"
            value={s?.floor1400 ?? false}
            options={[
              { value: true, label: 'On' },
              { value: false, label: 'Off' }
            ]}
            onchange={(v) => void rating.changeSettings({ floor1400: v })}
          />
          <p class="note">On: ratings under 1400 are not published, as in FIDE lists. Off (default): every rating counts.</p>
        </div>
        <div>
          <label class="label" for="birth">Birth year for the junior K (optional)</label>
          <input id="birth" inputmode="numeric" placeholder="none" bind:value={birth} onchange={saveBirth} />
          <p class="note">FIDE gives K = 40 until the end of the year of the 18th birthday while the rating is under 2300.</p>
        </div>
      </div>
      <p class="note">Changes are added to the rating ledger and apply from the current month; past months are never recomputed.</p>
    </section>
  {/if}
</ScreenFrame>

<style>
  .speeds {
    margin-bottom: 26px;
  }
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 28px;
    align-items: end;
  }
  .status {
    display: grid;
    gap: 8px;
  }
  .big {
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: var(--display-stretch);
    font-size: var(--name-size);
    line-height: var(--display-leading);
    text-transform: uppercase;
  }
  .live {
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
  }
  section {
    margin-top: 30px;
    padding-top: 20px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
  }
  h2 {
    margin: 0 0 14px;
    font-weight: 400;
  }
  .note {
    margin: 10px 0 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.04em;
    max-width: 72ch;
  }
  .note a {
    color: var(--panel-ink);
    text-decoration: underline;
  }
  .graph {
    margin: 26px 0 0;
  }
  .graph svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: color-mix(in srgb, var(--panel-muted) 35%, transparent);
    stroke-width: 1;
  }
  .tick {
    fill: var(--panel-muted);
    font-family: var(--font-ui);
    font-size: 10px;
  }
  .line {
    fill: none;
    stroke: var(--panel-ink);
    stroke-width: 2;
  }
  .dashed {
    stroke-dasharray: 4 4;
  }
  circle {
    fill: var(--panel-ink);
  }
  circle.live {
    fill: var(--panel);
    stroke: var(--panel-ink);
    stroke-width: 2;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--ui-size-small);
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px 8px 0;
    border-bottom: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 40%, transparent);
    font-weight: 400;
  }
  th {
    color: var(--panel-muted);
  }
  tr.live td {
    color: var(--panel-muted);
  }
  .link {
    color: var(--panel-ink);
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }
  .detail ul {
    margin: 0;
    padding: 0 0 0 1em;
    text-transform: none;
    letter-spacing: 0.04em;
  }
  .q {
    display: grid;
    gap: 6px;
    margin: 0;
  }
  .q-value {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 32px;
    text-transform: uppercase;
  }
  .settings {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
  }
  input {
    display: block;
    margin-top: 8px;
    width: 9em;
    padding: 6px 8px;
    font: inherit;
    color: var(--panel-ink);
    background: transparent;
    border: var(--hairline) solid var(--panel-muted);
    border-radius: var(--radius);
  }
  @media (max-width: 760px) {
    .top,
    .settings {
      grid-template-columns: 1fr;
    }
    th:nth-child(4),
    td:nth-child(4),
    th:nth-child(5),
    td:nth-child(5) {
      display: none;
    }
  }
</style>
