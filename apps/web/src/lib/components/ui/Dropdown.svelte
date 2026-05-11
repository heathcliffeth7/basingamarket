<script lang="ts">
  import type { Snippet } from 'svelte';

  let { label = 'Menu', children }: { label?: string; children?: Snippet } = $props();
</script>

<details class="group relative">
  <summary class="inline-flex h-9 cursor-pointer select-none items-center gap-2 rounded-full border border-terminal-line bg-terminal-panel px-3 text-sm text-terminal-text transition-colors hover:border-terminal-line-strong">
    {label}
    <svg class="h-3.5 w-3.5 text-terminal-muted transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
  </summary>
  <div class="absolute right-0 z-30 mt-2 min-w-48 overflow-hidden rounded-2xl border border-terminal-line-strong bg-terminal-bg shadow-market">
    <div class="p-1">
      {@render children?.()}
    </div>
  </div>
</details>
