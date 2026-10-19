<script lang="ts">
  /** Tiny label/value pair: grey mono label above a bold uppercase grotesk value. */
  interface Props {
    label: string;
    value: string;
  }
  let { label, value }: Props = $props();
</script>

<div class="lv">
  <span class="label">{label}</span>
  <span class="value">{value}</span>
</div>

<style>
  .lv {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .value {
    overflow-wrap: anywhere;
  }
</style>
