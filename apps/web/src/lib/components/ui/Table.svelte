<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<div class="overflow-x-auto rounded-2xl border border-terminal-line">
  <table class="w-full border-collapse text-left text-sm">
    {@render children?.()}
  </table>
</div>
