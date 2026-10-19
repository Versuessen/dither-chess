<script lang="ts">
  import DitherLayer from './dither/DitherLayer.svelte';
  import Preloader from './screens/Preloader.svelte';
  import Home from './screens/Home.svelte';
  import BotProfile from './screens/BotProfile.svelte';
  import Settings from './screens/Settings.svelte';
  import Models from './screens/Models.svelte';
  import Rating from './screens/Rating.svelte';
  import History from './screens/History.svelte';
  import Game from './screens/Game.svelte';
  import { createOpponent } from './inference/opponents';
  import { notifyFinished } from './game/finalize';
  import { storage } from './storage';
  import { session } from './app/session.svelte';
  import { router } from './app/router.svelte';
  import { ui } from './app/ui.svelte';
  import { themeStore } from './app/themeStore.svelte';
  import { boot } from './app/boot.svelte';
  import { personaById } from './bots/personas';

  let booting = $state(true);

  const route = $derived(router.route);
  const persona = $derived(route.name === 'bot' ? personaById(route.persona) : undefined);

  // Unknown persona ids, and the game screen without a game to start, fall back to the roster.
  $effect(() => {
    if (route.name === 'bot' && !persona) router.go({ name: 'home' }, true);
    if (route.name === 'game' && !session.pending) router.go({ name: 'home' }, true);
  });

  // The game screen calms the background; every other screen keeps it alive.
  $effect(() => {
    if (booting) return;
    ui.mode = route.name === 'game' ? 'calm' : 'live';
  });

  $effect(() => {
    document.documentElement.dataset.motion = ui.reducedMotion ? 'reduce' : 'system';
  });

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') themeStore.toggle();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<DitherLayer />

<!-- Screens that read saved data mount once boot has opened storage: a reload can land on them. -->

{#if route.name === 'home' || route.name === 'bot'}
  <div class="screen" class:booting>
    <Home covered={route.name === 'bot'} />
  </div>
{:else if route.name === 'settings' && boot.dataReady}
  <div class="screen" class:booting><Settings /></div>
{:else if route.name === 'models' && boot.dataReady}
  <div class="screen" class:booting><Models /></div>
{:else if route.name === 'rating' && boot.dataReady}
  <div class="screen" class:booting><Rating /></div>
{:else if route.name === 'history' && boot.dataReady}
  <div class="screen" class:booting><History /></div>
{:else if route.name === 'game' && session.pending && !booting}
  {#key session.gameNo}
    <Game setup={session.pending} {createOpponent} storage={storage()} onfinished={notifyFinished} />
  {/key}
{/if}

{#if persona && !booting}
  {#key persona.id}
    <BotProfile {persona} />
  {/key}
{/if}

{#if booting}
  <Preloader ondone={() => (booting = false)} />
{/if}

<style>
  .screen {
    transition: opacity 480ms var(--ease-out);
  }
  .screen.booting {
    opacity: 0;
  }
</style>
