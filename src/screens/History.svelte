<script lang="ts">
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import { href } from '../app/router.svelte';
</script>

<ScreenFrame title="History" current="history">
  <p class="empty">No finished games yet.</p>
  <p class="note">Every finished game is kept here with its PGN. <a href={href({ name: 'home' })}>Pick an opponent</a> to play one.</p>
</ScreenFrame>

<style>
  .empty {
    margin: 0 0 10px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    text-transform: uppercase;
  }
  .note {
    margin: 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
  }
  a {
    color: var(--panel-ink);
    text-decoration: underline;
    text-underline-offset: 0.3em;
  }
</style>
