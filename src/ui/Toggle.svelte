<script lang="ts" generics="T">
  /** A row of mono text toggles acting as one radio group. */
  interface Option {
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
  }
  interface Props {
    legend: string;
    options: Option[];
    value: T;
    onchange: (value: T) => void;
    equals?: (a: T, b: T) => boolean;
  }
  let { legend, options, value, onchange, equals = (a, b) => a === b }: Props = $props();
  const name = $props.id();
</script>

<fieldset class="toggle">
  <legend class="label">{legend}</legend>
  <div class="options">
    {#each options as o, i (i)}
      <label class:on={equals(o.value, value)} class:disabled={o.disabled} title={o.title}>
        <input
          type="radio"
          {name}
          checked={equals(o.value, value)}
          disabled={o.disabled}
          onchange={() => onchange(o.value)}
        />
        <span>{o.label}</span>
      </label>
    {/each}
  </div>
</fieldset>

<style>
  .toggle {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 8px;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  label {
    position: relative;
    cursor: pointer;
    color: var(--panel-muted);
    font-size: var(--ui-size-small);
    line-height: 1.6;
    padding-bottom: 2px;
    border-bottom: 2px solid transparent;
  }
  label:hover {
    color: var(--panel-ink);
  }
  label.on {
    color: var(--panel-ink);
    border-bottom-color: currentColor;
  }
  label.disabled {
    cursor: not-allowed;
    color: var(--ink-faint);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
  }
  label:has(input:focus-visible) {
    outline: 2px solid currentColor;
    outline-offset: 3px;
    border-radius: var(--radius);
  }
</style>
