<script lang="ts">
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import LabelValue from '../ui/LabelValue.svelte';
  import LevelStrip from '../ui/LevelStrip.svelte';
  import { MODELS } from '../models/catalog';
  import { models } from '../models/state.svelte';
</script>

<ScreenFrame title="Models" current="models" wide>
  <p class="intro">
    Each bot is a neural network trained on human games. Nothing leaves this device: packs are checked against
    their SHA-256 checksum before any game can use them.
  </p>
  <ul class="packs">
    {#each MODELS as m (m.family)}
      {@const pack = models.packFor(m.family)}
      <li class="pack">
        <h2 class="name">{m.name}</h2>
        <div class="facts">
          <LabelValue label="Pack" value={pack ? `${pack.id} ${pack.version}` : m.pack} />
          <LabelValue label="Status" value={pack ? 'Verified' : 'Not installed'} />
          <div class="wide">
            <LabelValue label="Style" value={m.style} />
          </div>
          <div class="wide">
            <span class="label">Levels (Lichess rapid)</span>
            <LevelStrip covered={models.coveredLevels(m.family)} label="{m.name} levels" />
          </div>
        </div>
      </li>
    {/each}
  </ul>
</ScreenFrame>

<style>
  .intro {
    margin: 0 0 26px;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    max-width: 70ch;
  }
  .packs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 30px;
  }
  .pack {
    display: grid;
    grid-template-columns: minmax(160px, 240px) 1fr;
    gap: 24px;
    padding-top: 22px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
  }
  .pack:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: var(--display-stretch);
    font-size: 34px;
    line-height: var(--display-leading);
    text-transform: uppercase;
    letter-spacing: -0.01em;
  }
  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px 28px;
  }
  .wide {
    grid-column: 1 / -1;
    display: grid;
    gap: 8px;
  }
  @media (max-width: 760px) {
    .pack {
      grid-template-columns: 1fr;
    }
  }
</style>
