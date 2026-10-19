<script lang="ts">
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import LabelValue from '../ui/LabelValue.svelte';
</script>

<ScreenFrame title="Rating" current="rating">
  <div class="status">
    <span class="big">Unrated (0/5)</span>
  </div>
  <div class="facts">
    <LabelValue label="System" value="FIDE rating regulations, rapid" />
    <LabelValue label="Rating period" value="Calendar month" />
  </div>
  <p class="note">
    Finish five rated rapid games against the bots to get a published rating. Rated games use a rapid clock, allow no
    takebacks or hints, and count only once both sides have moved.
  </p>
</ScreenFrame>

<style>
  .big {
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: var(--display-stretch);
    font-size: var(--name-size);
    line-height: var(--display-leading);
    text-transform: uppercase;
  }
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
    margin: 26px 0;
  }
  .note {
    margin: 0;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    max-width: 64ch;
  }
</style>
