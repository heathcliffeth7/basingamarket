<script lang="ts">
  import type { Snippet } from 'svelte';

  let { value = '', children }: { value?: string; children?: Snippet } = $props();
</script>

<div class="space-y-3" data-tab-value={value}>
  {@render children?.()}
</div>
