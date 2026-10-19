<script lang="ts">
  import { settings } from '../app/settings.svelte';
  import { onMount } from 'svelte';
  import ScreenFrame from '../ui/ScreenFrame.svelte';
  import LabelValue from '../ui/LabelValue.svelte';
  import LevelStrip from '../ui/LevelStrip.svelte';
  import { MANIFEST } from '../models/manifest';
  import { manager } from '../models/manager.svelte';
  import { modelInfo } from '../models/catalog';
  import { inference } from '../inference/client';
  import type { InitResult } from '../inference/protocol';

  let runtime = $state<InitResult | null>(null);
  let importError = $state<string | null>(null);
  let importOk = $state<string | null>(null);
  let sourcesText = $state(manager.sources.join('\n'));
  let sourcesSaved = $state(false);
  let fileInput: HTMLInputElement;

  onMount(() => {
    void inference.init().then((r) => (runtime = r)).catch(() => (runtime = null));
  });

  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  const pct = (d: number, t: number) => (t ? Math.floor((d / t) * 100) : 0);

  async function onImport(e: Event) {
    importError = importOk = null;
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const pack = await manager.importFile(f);
      importOk = `${pack.title} installed and verified.`;
    } catch (err) {
      importError = err instanceof Error ? err.message : String(err);
    } finally {
      fileInput.value = '';
    }
  }

  async function saveSources() {
    await manager.setSources(sourcesText.split('\n'));
    sourcesText = manager.sources.join('\n');
    sourcesSaved = true;
    setTimeout(() => (sourcesSaved = false), 1500);
  }

  function sourceText(s: Record<string, string>): string {
    if (s.type === 'huggingface') return `${s.repo} @ ${s.revision?.slice(0, 12)}`;
    if (s.type === 'git') return `${s.url?.replace('https://github.com/', '')} @ ${s.commit?.slice(0, 12)}`;
    return '';
  }
</script>

<ScreenFrame title="Models" current="models" wide>
  <ul class="packs">
    {#each MANIFEST.packs as p (p.id)}
      {@const st = manager.status[p.id] ?? { kind: 'absent' }}
      <li class="pack" data-pack={p.id}>
        <div class="title">
          <h2 class="name">{p.title}</h2>
          <span class="label">{modelInfo(p.family).name}{p.optional ? ' · optional' : ''}</span>
        </div>
        <div class="facts">
          <LabelValue label="Size" value="{mb(p.size)}{p.variant !== 'fp32' ? ` · ${p.variant}` : ''}" />
          <LabelValue label="Licence" value={p.license} />
          {#if settings.value.devMode}<LabelValue label="Source" value={sourceText(p.source)} />{/if}
          <div class="status">
            <span class="label">Status</span>
            {#if st.kind === 'absent'}
              <span class="value">Not installed</span>
            {:else if st.kind === 'installed'}
              <span class="value">{st.verified ? 'Installed · verified' : 'Installed · checking'}</span>
            {:else if st.kind === 'error'}
              <span class="value error" role="alert">{st.message}</span>
            {:else}
              <span class="value"
                >{st.kind === 'downloading' ? 'Downloading' : st.kind === 'verifying' ? 'Verifying' : 'Importing'}
                {pct(st.done, st.total)}%</span
              >
              <progress max={st.total} value={st.done} aria-label="{p.title} {st.kind}"></progress>
            {/if}
          </div>
          <div class="wide">
            <span class="label">Levels</span>
            <LevelStrip covered={p.calibration.levels} label="{p.title} levels" />
            {#if !p.calibration.levels.length}
              <p class="hint">No playable levels yet.</p>
            {/if}
          </div>
        </div>
        <div class="actions">
          {#if st.kind === 'absent' || st.kind === 'error'}
            <button class="primary" disabled={manager.storeKind === 'none'} onclick={() => manager.install(p.id)}>Download</button>
          {:else if st.kind === 'downloading'}
            <button onclick={() => manager.cancel(p.id)}>Cancel</button>
          {:else if st.kind === 'installed'}
            <button onclick={() => manager.remove(p.id)}>Remove</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <section class="extra">
    <div>
      <h2 class="label">Import from file</h2>

      <label class="file">
        <input bind:this={fileInput} type="file" accept=".dpk" onchange={onImport} />
        <span>Choose pack file</span>
      </label>
      {#if importError}<p class="error" role="alert">{importError}</p>{/if}
      {#if importOk}<p class="ok" role="status">{importOk}</p>{/if}
    </div>
    {#if settings.value.devMode}
    <div>
      <h2 class="label">Download sources</h2>
      <p class="hint">One URL prefix per line, tried in order.</p>
      <textarea bind:value={sourcesText} rows="3" spellcheck="false" aria-label="Download sources"></textarea>
      <button onclick={saveSources}>{sourcesSaved ? 'Saved' : 'Save sources'}</button>
    </div>
    <div>
      <h2 class="label">Runtime</h2>
      {#if runtime}
        <p class="hint">
          {runtime.backend === 'webgpu' ? 'WebGPU, with WASM fallback' : 'WASM SIMD'} ·
          {runtime.threads} {runtime.threads === 1 ? 'thread' : 'threads'}{runtime.isolated ? '' : ' (page not cross-origin isolated)'}
        </p>
      {:else}
        <p class="hint">Starting…</p>
      {/if}
      <p class="hint">Storage: {manager.storeKind === 'opfs' ? 'browser (OPFS)' : manager.storeKind === 'tauri' ? 'app data folder' : 'unavailable in this browser'}</p>
    </div>
    {/if}
  </section>
</ScreenFrame>

<style>
  .packs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 26px;
  }
  .pack {
    display: grid;
    grid-template-columns: minmax(150px, 220px) 1fr auto;
    gap: 24px;
    padding-top: 22px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
  }
  .pack:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .title {
    display: grid;
    gap: 8px;
    align-content: start;
  }
  .name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-stretch: var(--display-stretch);
    font-size: 28px;
    line-height: var(--display-leading);
    text-transform: uppercase;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px 22px;
  }
  .wide {
    grid-column: 1 / -1;
    display: grid;
    gap: 8px;
  }
  .status {
    display: grid;
    gap: 6px;
  }
  progress {
    width: 100%;
    height: 4px;
    appearance: none;
    border: 0;
    background: color-mix(in srgb, var(--panel-muted) 30%, transparent);
    border-radius: 2px;
  }
  progress::-webkit-progress-bar {
    background: color-mix(in srgb, var(--panel-muted) 30%, transparent);
    border-radius: 2px;
  }
  progress::-webkit-progress-value {
    background: var(--panel-ink);
    border-radius: 2px;
  }
  progress::-moz-progress-bar {
    background: var(--panel-ink);
  }
  .actions {
    display: flex;
    align-items: start;
    gap: 12px;
    font-size: var(--ui-size-small);
  }
  .actions button,
  .extra button,
  .file span {
    padding: 9px 14px;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    color: var(--panel-ink);
    font-size: var(--ui-size-small);
    cursor: pointer;
  }
  .actions .primary {
    background: var(--button);
    color: var(--button-ink);
    border-color: var(--button);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .error {
    color: var(--flag);
    margin: 8px 0 0;
  }
  .value.error {
    margin: 0;
  }
  .ok {
    margin: 8px 0 0;
  }
  .hint {
    margin: 6px 0 10px;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    text-transform: none;
    letter-spacing: 0.04em;
    max-width: 60ch;
  }
  .extra {
    margin-top: 34px;
    padding-top: 22px;
    border-top: var(--hairline) solid color-mix(in srgb, var(--panel-muted) 60%, transparent);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 26px;
  }
  .extra h2 {
    margin: 0;
    font-weight: 400;
  }
  .file input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .file:has(input:focus-visible) span {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
  textarea {
    display: block;
    width: 100%;
    margin-bottom: 10px;
    background: transparent;
    border: var(--hairline) solid var(--panel-muted);
    border-radius: var(--radius);
    padding: 8px;
    font-family: var(--font-ui);
    font-size: 12px;
    text-transform: none;
    letter-spacing: 0.02em;
    color: var(--panel-ink);
    resize: vertical;
  }
  @media (max-width: 900px) {
    .pack,
    .extra {
      grid-template-columns: 1fr;
    }
    .facts {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
