<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { CUSTOM, type Persona } from '../bots/personas';
  import { ui } from '../app/ui.svelte';
  import { router } from '../app/router.svelte';
  import { session } from '../app/session.svelte';
  import { models } from '../models/state.svelte';
  import { manager } from '../models/manager.svelte';
  import { MODELS, modelInfo, nearestLevel, type ModelFamily } from '../models/catalog';
  import { loadPrefs, savePrefs, type ColourChoice } from '../chess/setup';
  import { TIME_CONTROLS, SPEED_LABEL, formatTimeControl, speedOf, type TimeControl } from '../chess/timeControl';
  import DitherTile from '../dither/DitherTile.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import LabelValue from '../ui/LabelValue.svelte';

  interface Props {
    persona: Persona;
  }
  let { persona }: Props = $props();

  const prefs = loadPrefs();
  let family = $state<ModelFamily>(prefs.family);
  let colour = $state<ColourChoice>(prefs.colour);
  let timeControl = $state<TimeControl>(prefs.timeControl);
  let rated = $state(prefs.rated);
  // The panel is keyed by persona (App.svelte), so the persona never changes while it is open.
  const custom = untrack(() => persona.id) === CUSTOM.id;
  let level = $state(0);
  let panel: HTMLElement;
  let opener: HTMLElement | null = null;

  const covered = $derived(models.coveredLevels(family));
  const playable = $derived(models.playableLevels(family));
  const pack = $derived(models.packFor(family));
  const info = $derived(modelInfo(family));
  const canPlay = $derived(playable.includes(level));
  // A model the website installs by itself may still be on its way: show that instead of sending
  // the player to the Models screen.
  const availability = $derived(manager.availability(family));
  const waiting = $derived(!canPlay && (availability.kind === 'busy' || availability.kind === 'queued'));
  const playLabel = $derived.by(() => {
    if (canPlay) return 'Play';
    if (availability.kind === 'busy') {
      return `${availability.phase === 'downloading' ? 'Downloading' : 'Checking'} · ${Math.floor(availability.fraction * 100)}%`;
    }
    return availability.kind === 'queued' ? 'Preparing model' : 'Install model';
  });
  const speed = $derived(SPEED_LABEL[speedOf(timeControl)]);

  // Pick a model that covers this persona's level, and snap the level to what it covers.
  $effect.pre(() => {
    const lv = models.coveredLevels(family);
    if (!lv.length) {
      const alt = MODELS.find((m) => models.coveredLevels(m.family).length);
      if (alt) family = alt.family;
    }
  });
  $effect.pre(() => {
    const snapped = nearestLevel(covered, level || (custom ? (prefs.customLevel ?? persona.level) : persona.level));
    if (snapped !== null && snapped !== level) level = snapped;
  });

  function step(dir: 1 | -1) {
    const list = [...covered].sort((a, b) => a - b);
    const i = list.indexOf(level);
    const next = list[i + dir];
    if (next === undefined) return;
    level = next;
    if (custom) remember();
  }

  function close() {
    router.go({ name: 'home' });
  }

  function play() {
    remember();
    if (waiting) return;
    if (!canPlay) {
      router.go({ name: 'models' });
      return;
    }
    session.pending = { persona: persona.id, family, level, colour, timeControl, rated };
    router.go({ name: 'game' });
  }

  function remember() {
    savePrefs({ family, colour, timeControl, rated, ...(custom ? { customLevel: level } : prefs.customLevel ? { customLevel: prefs.customLevel } : {}) });
  }

  function focusables(): HTMLElement[] {
    return [
      ...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    opener = document.querySelector<HTMLElement>(`[data-persona="${persona.id}"]`);
    ui.subject = persona.subject;
    void tick().then(() => panel.focus({ preventScroll: true }));
    return () => {
      ui.promotion = false;
      opener?.focus({ preventScroll: true });
    };
  });

  const motion = $derived(ui.reducedMotion ? 0 : 1);
  const tcOptions = TIME_CONTROLS.map((tc) => ({
    value: tc,
    label: formatTimeControl(tc),
    title: `${SPEED_LABEL[speedOf(tc)]} rating`
  }));
  const calibrationNote = $derived(
    family === 'fastelo'
      ? 'Strength from fastelo’s published calibration, used unchanged. Its move quality matches held-out Lichess rapid games; in bot-vs-bot games, levels between 800 and 1800 play closer together than their labels.'
      : family === 'maia3'
        ? 'Strength fitted to held-out Lichess rapid games with fastelo’s method.'
        : 'Rating buckets from 1100 upward; temperature fitted to held-out Lichess rapid games.'
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scrim" transition:fade={{ duration: 160 * motion }} onclick={close} onkeydown={() => {}}></div>
<div
  class="panel"
  bind:this={panel}
  role="dialog"
  aria-modal="true"
  aria-labelledby="bot-name"
  tabindex="-1"
  onkeydown={onKeydown}
  transition:scale={{ start: 0.965, duration: 200 * motion, easing: cubicOut, opacity: 0 }}
>
  <header class="head">
    <span>Bot profile</span>
    <button class="close" data-sound="back" onclick={close}>Close</button>
  </header>
  <hr />
  <div class="top">
    <div class="facts">
      <h2 id="bot-name" class="name">{persona.name}</h2>
      <div class="grid">
        <div class="cell wide">
          <Toggle
            legend="Model"
            value={family}
            options={MODELS.map((m) => ({
              value: m.family,
              label: m.name,
              disabled: models.coveredLevels(m.family).length === 0,
              title: models.coveredLevels(m.family).length ? undefined : 'No calibrated levels yet'
            }))}
            onchange={(v) => {
              family = v;
              remember();
            }}
          />
        </div>
        <div class="cell">
          <span class="label" id="rating-label">Rating (Lichess rapid)</span>
          <div class="stepper" role="group" aria-labelledby="rating-label">
            <button onclick={() => step(-1)} aria-label="Lower rating" disabled={level <= Math.min(...covered)}>−</button>
            <span class="value big" aria-live="polite">{level}</span>
            <button onclick={() => step(1)} aria-label="Higher rating" disabled={level >= Math.max(...covered)}>+</button>
          </div>
        </div>
        <LabelValue label="Model pack" value={pack ? `${pack.id} · verified` : `${info.pack} · not installed`} />
        <div class="cell wide">
          <LabelValue label="Style" value={info.style} />
        </div>
      </div>
    </div>
    <div class="portrait">
      <DitherTile subject={persona.subject} promotion={ui.promotion} label="{persona.name}, dithered portrait" />
    </div>
  </div>
  <hr />
  <div class="bottom">
    <p class="bio">{persona.bio} <span class="note">{calibrationNote}</span></p>
    <div class="actions">
      <div class="toggles">
        <Toggle
          legend="Colour"
          value={colour}
          options={[
            { value: 'white' as const, label: 'White' },
            { value: 'random' as const, label: 'Random' },
            { value: 'black' as const, label: 'Black' }
          ]}
          onchange={(v) => {
            colour = v;
            remember();
          }}
        />
        <Toggle
          legend="Clock · {speed}"
          value={timeControl}
          options={tcOptions}
          equals={(a, b) => a.base === b.base && a.increment === b.increment}
          onchange={(v) => {
            timeControl = v;
            remember();
          }}
        />
        <Toggle
          legend="Game"
          value={rated}
          options={[
            { value: true, label: 'Rated', title: `Counts for your ${speed.toLowerCase()} rating` },
            { value: false, label: 'Casual', title: 'Does not count for any rating' }
          ]}
          onchange={(v) => {
            rated = v;
            remember();
          }}
        />
      </div>
      <button
        class="play"
        data-sound="confirm"
        onclick={play}
        disabled={waiting}
        aria-busy={waiting}
        onpointerenter={() => (ui.promotion = true)}
        onpointerleave={() => (ui.promotion = false)}
        onfocus={() => (ui.promotion = true)}
        onblur={() => (ui.promotion = false)}
      >
        {playLabel}
      </button>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: var(--scrim);
  }
  .panel {
    position: fixed;
    z-index: 11;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    width: min(920px, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100dvh - 2 * var(--gutter));
    overflow-y: auto;
    background: var(--panel);
    color: var(--panel-ink);
    border-radius: var(--radius);
    padding: 22px 26px 26px;
    outline: none;
  }
  .head {
    display: flex;
    justify-content: space-between;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  .close {
    color: var(--panel-muted);
  }
  .close:hover {
    color: var(--panel-ink);
  }
  hr {
    border: 0;
    border-top: var(--hairline) solid var(--panel-muted);
    margin: 16px 0 22px;
    opacity: 0.6;
  }
  .top {
    display: grid;
    grid-template-columns: 1fr minmax(180px, 250px);
    gap: 32px;
  }
  .name {
    margin: 0 0 26px;
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: var(--display-stretch);
    font-size: var(--name-size);
    line-height: var(--display-leading);
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 22px 28px;
  }
  .cell.wide {
    grid-column: 1 / -1;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 6px;
  }
  .stepper button {
    font-family: var(--font-ui);
    font-size: 18px;
    width: 26px;
    height: 26px;
    border: var(--hairline) solid var(--panel-muted);
    border-radius: var(--radius);
    color: var(--panel-ink);
    line-height: 1;
  }
  .stepper button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .big {
    font-size: 22px;
    min-width: 4ch;
    text-align: center;
  }
  .bottom {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 32px;
    align-items: end;
  }
  .bio {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: 100%;
    font-size: 15px;
    line-height: 1.32;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    color: var(--panel-muted);
    max-width: 54ch;
  }
  .note {
    display: block;
    margin-top: 10px;
  }
  .actions {
    display: grid;
    gap: 20px;
    justify-items: end;
  }
  .toggles {
    display: grid;
    gap: 14px;
    justify-items: start;
  }
  .play {
    min-width: 240px;
    padding: 16px 26px;
    background: var(--button);
    color: var(--button-ink);
    border-radius: var(--radius);
    font-family: var(--font-ui);
    font-size: var(--ui-size);
    letter-spacing: 0.32em;
    text-align: center;
  }
  .play:hover,
  .play:focus-visible {
    outline-color: var(--panel-ink);
  }
  .play:disabled {
    cursor: progress;
    opacity: 0.72;
  }

  @media (max-width: 760px) {
    .top,
    .bottom {
      grid-template-columns: 1fr;
    }
    .portrait {
      max-width: 220px;
    }
    .actions {
      justify-items: stretch;
    }
    .play {
      width: 100%;
    }
  }
</style>
