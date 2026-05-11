<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children, content, side = 'top' }: { children?: Snippet; content: string; side?: 'top' | 'bottom' | 'left' | 'right' } = $props();

  const pos = {
    top: 'bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2',
    bottom: 'top-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2',
    left: 'right-[calc(100%+0.5rem)] top-1/2 -translate-y-1/2',
    right: 'left-[calc(100%+0.5rem)] top-1/2 -translate-y-1/2'
  };
</script>

<span class="group relative inline-flex">
  {@render children?.()}
  <span
    class={`pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-xl border border-terminal-line bg-terminal-bg px-2 py-1 text-xs text-terminal-text shadow-market group-hover:block group-focus-within:block ${pos[side]}`}
    role="tooltip"
  >
    {content}
  </span>
</span>
