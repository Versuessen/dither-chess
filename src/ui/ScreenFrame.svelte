<script lang="ts">
  import type { Snippet } from 'svelte';
  import { href, router, type Route } from '../app/router.svelte';

  /** Shared chrome for the secondary screens: corner navigation and one framed panel. */
  interface Props {
    title: string;
    current: Route['name'];
    wide?: boolean;
    children: Snippet;
  }
  let { title, current, wide = false, children }: Props = $props();

  const nav: { name: Route['name']; label: string }[] = [
    { name: 'models', label: 'Models' },
    { name: 'rating', label: 'Rating' },
    { name: 'history', label: 'History' },
    { name: 'settings', label: 'Settings' }
  ];

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !e.defaultPrevented) router.go({ name: 'home' });
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="frame">
  <a class="corner top-left wordmark" href={href({ name: 'home' })} aria-label="Dither home">DITHER</a>
  <nav class="corner top-right" aria-label="Main">
    {#each nav as n (n.name)}
      <a href={href({ name: n.name } as Route)} aria-current={n.name === current ? 'page' : undefined}>{n.label}</a>
    {/each}
  </nav>

  <main class="panel" class:wide aria-labelledby="screen-title">
    <header class="head">
      <h1 id="screen-title">{title}</h1>
      <a class="close" href={href({ name: 'home' })}>Close</a>
    </header>
    <hr />
    <div class="body">
      {@render children()}
    </div>
  </main>
</div>

<style>
  .frame {
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
    gap: 2.4em;
  }
  .top-right a[aria-current='page'],
  .top-right a:hover {
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }
  .panel {
    position: relative;
    margin: calc(var(--gutter) * 3.2) auto var(--gutter);
    width: min(820px, calc(100vw - 2 * var(--gutter)));
    background: var(--panel);
    color: var(--panel-ink);
    border-radius: var(--radius);
    padding: 22px 26px 28px;
  }
  .panel.wide {
    width: min(1180px, calc(100vw - 2 * var(--gutter)));
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  h1 {
    margin: 0;
    font: inherit;
    letter-spacing: inherit;
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
  @media (max-width: 760px) {
    .top-right {
      gap: 1em;
      font-size: var(--ui-size-small);
    }
    .wordmark {
      display: none;
    }
  }
</style>
