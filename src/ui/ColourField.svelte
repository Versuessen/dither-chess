<script lang="ts">
  /**
   * One colour setting: a swatch that opens the system colour picker, the hex value, and (for
   * colours that can follow something else) a button back to the default.
   */
  interface Props {
    label: string;
    /** Current colour, or null when it follows a default. */
    value: string | null;
    /** Shown in the swatch when value is null. */
    fallback: string;
    /** Label of the reset button; omit for colours that always have their own value. */
    resetLabel?: string;
    onchange: (v: string | null) => void;
  }
  let { label, value, fallback, resetLabel, onchange }: Props = $props();
  const id = `colour-${Math.random().toString(36).slice(2, 9)}`;
  const shown = $derived(value ?? fallback);
</script>

<div class="field">
  <label for={id} class="label">{label}</label>
  <div class="line">
    <input {id} type="color" value={shown} oninput={(e) => onchange((e.currentTarget as HTMLInputElement).value)} />
    <span class="hex">{value ?? resetLabel ?? shown}</span>
    {#if resetLabel && value}
      <button type="button" class="reset" onclick={() => onchange(null)}>{resetLabel}</button>
    {/if}
  </div>
</div>

<style>
  .field {
    display: grid;
    gap: 8px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 30px;
  }
  input[type='color'] {
    inline-size: 44px;
    block-size: 28px;
    padding: 0;
    border: var(--hairline) solid var(--panel-ink);
    border-radius: var(--radius);
    background: none;
    cursor: pointer;
  }
  input[type='color']::-webkit-color-swatch-wrapper {
    padding: 2px;
  }
  input[type='color']::-webkit-color-swatch {
    border: 0;
    border-radius: 1px;
  }
  .hex {
    font-family: var(--font-ui);
    font-size: var(--ui-size-small);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--panel-muted);
  }
  .reset {
    font-size: var(--ui-size-small);
    color: var(--panel-muted);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .reset:hover {
    color: var(--panel-ink);
  }
</style>
