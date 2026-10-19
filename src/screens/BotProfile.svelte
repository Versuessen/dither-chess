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
  import { nearestLevel } from '../models/catalog';
  import { loadPrefs, savePrefs, type ColourChoice } from '../chess/setup';
  import { TIME_CONTROLS, SPEED_LABEL, formatTimeControl, speedOf, type TimeControl } from '../chess/timeControl';
  import Toggle from '../ui/Toggle.svelte';

  interface Props {
    persona: Persona;
  }
  let { persona }: Props = $props();

  const prefs = loadPrefs();
  let colour = $state<ColourChoice>(prefs.colour);
  let timeControl = $state<TimeControl>(prefs.timeControl);
  let rated = $state(prefs.rated);
  // The panel is keyed by persona (App.svelte), so the persona never changes while it is open.
  const custom = untrack(() => persona.id) === CUSTOM.id;
  let level = $state(0);
  let panel: HTMLElement;
  let opener: HTMLElement | null = null;

  const family = 'maia3' as const;
  const covered = $derived(models.coveredLevels(family));
  const playable = $derived(models.playableLevels(family));
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

  // Snap the level to what the model covers.
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
    savePrefs({ colour, timeControl, rated, ...(custom ? { customLevel: level } : prefs.customLevel ? { customLevel: prefs.customLevel } : {}) });
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="scrim" transition:fade={{ duration: 160 * motion }} onclick={close} onkeydown={() => {}}></div>
<div
  class="panel window"
  bind:this={panel}
  role="dialog"
  aria-modal="true"
  aria-labelledby="bot-name"
  tabindex="-1"
  onkeydown={onKeydown}
  transition:scale={{ start: 0.965, duration: 200 * motion, easing: cubicOut, opacity: 0 }}
>
  <header class="titlebar">
    <span class="title">{custom ? 'Custom game' : 'New game'}</span>
    <span class="end">
      <span class="counter" aria-hidden="true">{String(level).padStart(4, '0')}</span>
      <button class="close" data-sound="back" onclick={close}>Close</button>
    </span>
  </header>
  <div class="body">
    <h2 id="bot-name" class="name">{persona.name}</h2>
    {#if !custom}<p class="bio">{persona.bio}</p>{/if}

    <div class="settings">
      <div class="cell">
        <span class="label" id="rating-label">Rating</span>
        <div class="stepper" role="group" aria-labelledby="rating-label">
          <button onclick={() => step(-1)} aria-label="Lower rating" disabled={!covered.length || level <= Math.min(...covered)}>−</button>
          <span class="value big" aria-live="polite">{level || '—'}</span>
          <button onclick={() => step(1)} aria-label="Higher rating" disabled={!covered.length || level >= Math.max(...covered)}>+</button>
        </div>
      </div>
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
      <div class="cell wide">
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
      </div>
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
      onclick={play}
      disabled={waiting}
      aria-busy={waiting}
      data-sound="confirm"
      onpointerenter={() => (ui.promotion = true)}
      onpointerleave={() => (ui.promotion = false)}
      onfocus={() => (ui.promotion = true)}
      onblur={() => (ui.promotion = false)}
    >
      {playLabel}
    </button>
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
    width: min(640px, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100dvh - 2 * var(--gutter));
    display: flex;
    flex-direction: column;
    background: var(--panel);
    color: var(--panel-ink);
    border-radius: var(--radius);
    outline: none;
  }
  .titlebar {
    flex: none;
    margin: 0;
    border-radius: var(--radius) var(--radius) 0 0;
  }
  /* The content scrolls inside the frame, so the corner brackets stay outside it. */
  .body {
    min-height: 0;
    overflow-y: auto;
    padding: 22px 26px 26px;
    display: grid;
    gap: 22px;
  }
  .name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: var(--display-stretch);
    font-size: var(--name-size);
    line-height: var(--display-leading);
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }
  .bio {
    margin: -8px 0 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.03em;
    max-width: 60ch;
  }
  .settings {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 22px 28px;
    padding-top: 18px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
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
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 26px;
    min-width: 4ch;
    text-align: center;
  }
  .play {
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
  @media (max-width: 560px) {
    .settings {
      grid-template-columns: 1fr;
    }
  }
</style>
