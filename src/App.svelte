<script lang="ts">
  import { untrack } from 'svelte';
  import DitherLayer from './dither/DitherLayer.svelte';
  import Preloader from './screens/Preloader.svelte';
  import Home from './screens/Home.svelte';
  import BotProfile from './screens/BotProfile.svelte';
  // Screens other than the roster load when they are first opened, so the first screen starts
  // with less JavaScript (DECISIONS.md, performance budgets); the service worker caches them all.
  const loadSettings = () => import('./screens/Settings.svelte');
  const loadModels = () => import('./screens/Models.svelte');
  const loadRating = () => import('./screens/Rating.svelte');
  const loadHistory = () => import('./screens/History.svelte');
  const loadAnalysis = () => import('./screens/Analysis.svelte');
  const loadGame = () => import('./screens/Game.svelte');
  const loadPuzzles = () => import('./screens/Puzzles.svelte');
  import { createOpponent } from './inference/opponents';
  import { notifyFinished } from './game/finalize';
  import { storage } from './storage';
  import { session } from './app/session.svelte';
  import { router } from './app/router.svelte';
  import { ui } from './app/ui.svelte';
  import { themeStore } from './app/themeStore.svelte';
  import { settings } from './app/settings.svelte';
  import { boot } from './app/boot.svelte';
  import { personaById } from './bots/personas';
  import { music, play as playSound, type SoundName } from './game/sounds';

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
    ui.mode = route.name === 'game' || route.name === 'puzzles' ? 'calm' : 'live';
  });

  $effect(() => {
    document.documentElement.dataset.motion = ui.reducedMotion ? 'reduce' : 'system';
  });

  // Background colours chosen in Settings override the theme's dither inks.
  $effect(() => {
    const { bgShadow, bgLight } = settings.value.colours;
    const root = document.documentElement.style;
    for (const [name, v] of [['--dither-shadow', bgShadow], ['--dither-light', bgLight]] as const) {
      if (v) root.setProperty(name, v);
      else root.removeProperty(name);
    }
    untrack(() => ui.inksVersion++);
  });

  // Optional background music; the audio context starts on the first gesture.
  $effect(() => {
    music.setVolume(settings.value.musicVolume);
  });
  $effect(() => {
    if (settings.value.music) music.start(settings.value.musicTrack);
    else music.stop();
  });

  /**
   * Quiet interface sounds for buttons, links and toggles (data-sound picks "confirm", "back" or
   * "none"; the default is "select"). The board makes its own sounds.
   */
  function onClick(e: MouseEvent) {
    if (!settings.value.sounds) return;
    const target = e.target as Element | null;
    // A click on a label also clicks its input: sound once.
    if (!target || target.tagName === 'INPUT') return;
    const el = target.closest('button, a[href], label, [role="button"]');
    if (!el || el.closest('cg-container, .board-wrap') || el.matches(':disabled, [aria-disabled="true"]')) return;
    const name = el.getAttribute('data-sound') ?? 'select';
    if (name !== 'none') playSound(name as SoundName, 0.8);
  }

  function onPointerDown() {
    // Browsers keep audio suspended until a gesture; music switched on earlier starts now.
    if (settings.value.music) music.start(settings.value.musicTrack);
  }

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') themeStore.toggle();
  }
</script>

<svelte:window onkeydown={onKeydown} onclickcapture={onClick} onpointerdown={onPointerDown} />

<DitherLayer />

<!-- Screens that read saved data mount once boot has opened storage: a reload can land on them. -->

{#if route.name === 'home' || route.name === 'bot'}
  <div class="screen" class:booting>
    <Home covered={route.name === 'bot'} />
  </div>
{:else if route.name === 'settings' && boot.dataReady}
  {#await loadSettings() then { default: Settings }}<div class="screen" class:booting><Settings /></div>{/await}
{:else if route.name === 'models' && boot.dataReady}
  {#await loadModels() then { default: Models }}<div class="screen" class:booting><Models /></div>{/await}
{:else if route.name === 'rating' && boot.dataReady}
  {#await loadRating() then { default: Rating }}<div class="screen" class:booting><Rating /></div>{/await}
{:else if route.name === 'history' && boot.dataReady}
  {#await loadHistory() then { default: History }}<div class="screen" class:booting><History /></div>{/await}
{:else if route.name === 'analysis' && boot.dataReady}
  {#key route.game}
    {#await loadAnalysis() then { default: Analysis }}
      <div class="screen" class:booting><Analysis gameId={route.game} /></div>
    {/await}
  {/key}
{:else if route.name === 'puzzles' && boot.dataReady}
  {#await loadPuzzles() then { default: Puzzles }}<div class="screen" class:booting><Puzzles /></div>{/await}
{:else if route.name === 'game' && session.pending && !booting}
  {#key session.gameNo}
    {#await loadGame() then { default: Game }}
      <Game setup={session.pending!} {createOpponent} storage={storage()} onfinished={notifyFinished} />
    {/await}
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
