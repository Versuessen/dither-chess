<script lang="ts">
  import { PERSONAS, HOME_SUBJECT, CUSTOM, type Persona } from '../bots/personas';
  import { settings } from '../app/settings.svelte';
  import { ui } from '../app/ui.svelte';
  import { router, href } from '../app/router.svelte';
  import LogoMark from '../ui/LogoMark.svelte';
  import ScrollRail from '../ui/ScrollRail.svelte';

  interface Props {
    /** The profile panel is open over the roster. */
    covered?: boolean;
  }
  let { covered = false }: Props = $props();

  let list: HTMLUListElement;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  let visible = $state(1);
  /** Phones: the roster opens from the menu. */
  let rosterOpen = $state(false);

  function seek(f: number) {
    list.scrollTop = f * (list.scrollHeight - list.clientHeight);
  }

  function toggleDev() {
    void settings.update({ devMode: !settings.value.devMode });
  }

  function show(p: Persona) {
    clearTimeout(leaveTimer);
    ui.subject = p.subject;
  }

  function leave() {
    clearTimeout(leaveTimer);
    if (covered) return;
    leaveTimer = setTimeout(() => {
      if (!covered) ui.subject = HOME_SUBJECT;
    }, 900);
  }

  function open(p: Persona) {
    router.go({ name: 'bot', persona: p.id });
  }

  function onScroll() {
    const max = list.scrollHeight - list.clientHeight;
    ui.scroll = max > 0 ? list.scrollTop / max : 0;
    visible = list.scrollHeight > 0 ? list.clientHeight / list.scrollHeight : 1;
  }

  function onKey(e: KeyboardEvent, index: number) {
    const rows = list.querySelectorAll<HTMLButtonElement>('button.row');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = rows[(index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
      next?.focus();
    }
  }

  $effect(() => {
    onScroll();
    const ro = new ResizeObserver(onScroll);
    ro.observe(list);
    return () => ro.disconnect();
  });
</script>

<div class="home" class:covered class:roster-open={rosterOpen} inert={covered}>
  <header class="corner top-left">Human-like chess · offline</header>
  <div class="corner top-center wordmark" aria-hidden="true">DITHER</div>
  <nav class="corner top-right" aria-label="Main">
    <a href={href({ name: 'models' })}>Models</a>
    <a href={href({ name: 'rating' })}>Rating</a>
    <a href={href({ name: 'history' })}>History</a>
    <a href={href({ name: 'settings' })}>Settings</a>
  </nav>

  <div class="logo">
    <LogoMark width="min(34vw, 500px)" tag="CHESS" />
  </div>

  <section class="roster" aria-label="Choose an opponent">
    <!-- Outside the scrolling list: any model at any rating. -->
    <button
      class="row display play"
      onpointerenter={() => show(CUSTOM)}
      onpointerleave={leave}
      onfocus={() => show(CUSTOM)}
      onblur={leave}
      onclick={() => open(CUSTOM)}
      data-persona={CUSTOM.id}
      data-sound="confirm"
    >
      <span class="level">Any</span>
      <span class="name">Play</span>
    </button>
    <button class="menu-item opponents" aria-expanded={rosterOpen} aria-controls="roster-list" onclick={() => (rosterOpen = !rosterOpen)}>
      {rosterOpen ? 'Hide opponents' : 'Opponents'}
    </button>
    <ul id="roster-list" bind:this={list} onscroll={onScroll} onpointerleave={leave}>
      {#each PERSONAS as p, i (p.id)}
        <li>
          <button
            class="row display"
            onpointerenter={() => show(p)}
            onfocus={() => show(p)}
            onblur={leave}
            onclick={() => open(p)}
            onkeydown={(e) => onKey(e, i)}
            data-persona={p.id}
          >
            <span class="level">{p.level}</span>
            <span class="name">{p.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  </section>

  <ScrollRail progress={ui.scroll} size={visible} controls="roster-list" label="Opponents" onseek={seek} />

  <nav class="mobile-menu" aria-label="Menu">
    <a class="menu-item" href={href({ name: 'history' })}>History</a>
    <a class="menu-item" href={href({ name: 'rating' })}>Rating</a>
    <a class="menu-item" href={href({ name: 'models' })}>Models</a>
    <a class="menu-item" href={href({ name: 'settings' })}>Settings</a>
  </nav>

  <!-- The copyright sign also switches the developer details (PGN text and diagnostics) on and off. -->
  <button
    class="corner bottom-left muted year"
    aria-pressed={settings.value.devMode}
    title={settings.value.devMode ? 'Developer details on' : '2026'}
    onclick={toggleDev}
  >
    2026©{settings.value.devMode ? ' · dev' : ''}
  </button>
</div>

<style>
  .home {
    position: fixed;
    inset: 0;
    z-index: 1;
    color: var(--over-dither);
    transition: opacity var(--t-panel) var(--ease-out);
  }
  .home.covered {
    opacity: 0.35;
  }

  .corner {
    position: absolute;
    padding: var(--gutter);
    font-size: var(--ui-size);
    line-height: 1;
    white-space: nowrap;
    z-index: 2;
  }
  .top-left {
    top: 0;
    left: 0;
  }
  .top-center {
    top: 0;
    left: 50%;
    transform: translateX(-50%);
  }
  .wordmark {
    letter-spacing: 0.6em;
    padding-right: calc(var(--gutter) - 0.6em);
  }
  .top-right {
    top: 0;
    right: 0;
    display: flex;
    gap: 2.4em;
  }
  .bottom-left {
    bottom: 0;
    left: 0;
  }
  .muted {
    color: var(--over-dither-muted);
    font-size: var(--ui-size-small);
  }
  .year[aria-pressed='true'] {
    color: var(--over-dither);
  }
  .corner a:hover,
  button.corner:hover {
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }

  .logo {
    position: absolute;
    left: 61%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: var(--logo, var(--over-dither));
    pointer-events: none;
  }

  .roster {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: min(50vw, 780px);
    height: min(76vh, 860px);
    display: flex;
    flex-direction: column;
  }
  .play {
    flex: none;
  }
  .play .level {
    text-transform: uppercase;
  }
  /* The list starts a little below the Play button and fades out well before the bottom. */
  ul {
    flex: 1;
    min-height: 0;
    list-style: none;
    margin: 1.2vh 0 0;
    padding: 3vh 0 16vh;
    overflow-y: auto;
    scrollbar-width: none;
    overscroll-behavior: contain;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 9%, #000 62%, transparent 100%);
    mask-image: linear-gradient(to bottom, transparent 0, #000 9%, #000 62%, transparent 100%);
  }
  ul::-webkit-scrollbar {
    display: none;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.28em;
    width: 100%;
    padding: 0.02em var(--gutter);
    text-align: left;
    color: var(--list-row);
    transition:
      transform var(--t-fast) var(--ease-out),
      color var(--t-fast) linear;
  }
  .row:hover,
  .row:focus-visible {
    color: var(--list-row-hover);
    transform: translateX(var(--row-shift));
    outline: none;
  }
  .row:focus-visible .name {
    text-decoration: underline;
    text-decoration-thickness: 3px;
    text-underline-offset: 0.08em;
  }
  .level {
    font-family: var(--font-ui);
    font-size: var(--ui-size);
    font-weight: 400;
    letter-spacing: var(--ui-tracking);
    line-height: 1;
    min-width: 4.2ch;
    padding-top: 0.28em;
  }
  .name {
    white-space: nowrap;
  }

  .menu-item {
    display: block;
    min-height: 44px;
    padding: 12px var(--gutter);
    font-size: var(--ui-size);
    letter-spacing: var(--ui-tracking);
    text-align: left;
    color: var(--over-dither);
  }
  /* Phone-only controls. */
  .menu-item.opponents,
  .mobile-menu {
    display: none;
  }

  /* Phones and narrow windows: a main menu (Play, then the rest), the roster on demand. */
  @media (max-width: 760px) {
    .top-left,
    .top-right,
    .top-center,
    .play .level,
    .home :global(.rail) {
      display: none;
    }
    .play {
      font-size: 64px;
    }
    .top-center {
      left: var(--gutter);
      transform: none;
      padding-left: 0;
      padding-top: calc(var(--gutter) + env(safe-area-inset-top));
    }
    .logo {
      top: 19dvh;
      left: 50%;
      transform: translate(-50%, -50%);
    }
    .logo :global(svg) {
      width: 76vw !important;
    }
    .roster {
      width: 100vw;
      top: 34dvh;
      bottom: auto;
      transform: none;
      height: auto;
    }
    .menu-item.opponents {
      display: block;
      font-family: var(--font-display);
      font-weight: 800;
      font-stretch: var(--display-stretch);
      font-size: 26px;
      letter-spacing: 0.01em;
      text-transform: uppercase;
      padding-top: 6px;
    }
    ul {
      display: none;
    }
    .roster-open ul {
      display: block;
      max-height: 52dvh;
      margin: 0;
      padding: 1vh 0 14vh;
    }
    .mobile-menu {
      display: flex;
      flex-direction: column;
      position: absolute;
      left: 0;
      bottom: calc(5dvh + env(safe-area-inset-bottom));
    }
    .roster-open .mobile-menu {
      display: none;
    }
    .year {
      font-size: 11px;
      padding-bottom: calc(var(--gutter) + env(safe-area-inset-bottom));
    }
    .bottom-left.year {
      left: auto;
      right: 0;
    }
  }
</style>
