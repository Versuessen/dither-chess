<script lang="ts">
  import { PERSONAS, HOME_SUBJECT, type Persona } from '../bots/personas';
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

<div class="home" class:covered inert={covered}>
  <header class="corner top-left">Human-like chess · offline</header>
  <div class="corner top-center wordmark" aria-hidden="true">DITHER</div>
  <nav class="corner top-right" aria-label="Main">
    <a href={href({ name: 'models' })}>Models</a>
    <a href={href({ name: 'rating' })}>Rating</a>
    <span class="year">2026©</span>
  </nav>

  <div class="logo">
    <LogoMark width="min(34vw, 500px)" />
  </div>

  <section class="roster" aria-label="Choose an opponent">
    <ul bind:this={list} onscroll={onScroll} onpointerleave={leave}>
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

  <ScrollRail progress={ui.scroll} size={visible} />

  <a class="corner bottom-left muted" href={href({ name: 'settings' })}>Settings</a>
  <a class="corner bottom-right muted" href={href({ name: 'history' })}>History</a>
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
  .bottom-right {
    bottom: 0;
    right: 0;
  }
  .muted {
    color: var(--over-dither-muted);
    font-size: var(--ui-size-small);
  }
  .corner a:hover,
  a.corner:hover {
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
    height: min(72vh, 820px);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 12vh 0;
    height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
    overscroll-behavior: contain;
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14%, #000 86%, transparent 100%);
    mask-image: linear-gradient(to bottom, transparent 0, #000 14%, #000 86%, transparent 100%);
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

  @media (max-width: 760px) {
    .top-left {
      display: none;
    }
    .top-center {
      left: var(--gutter);
      transform: none;
      padding-left: 0;
    }
    .logo {
      top: 15vh;
      left: 50%;
      transform: translate(-50%, -50%);
    }
    .logo :global(svg) {
      width: 62vw !important;
    }
    .roster {
      width: 100vw;
      top: auto;
      bottom: 6vh;
      transform: none;
      height: 64vh;
    }
    .top-right {
      gap: 1.2em;
    }
    .year {
      display: none;
    }
  }
</style>
