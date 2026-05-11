<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = false,
    side = 'right',
    children,
    onClose
  }: {
    open?: boolean;
    side?: 'right' | 'left' | 'bottom';
    children?: Snippet;
    onClose?: () => void;
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50">
    <div class="absolute inset-0 bg-black/72 backdrop-blur-sm" onclick={onClose} role="presentation" aria-hidden="true"></div>
    <div
      class={`fixed z-50 border-terminal-line-strong bg-terminal-panel shadow-market ${
        side === 'bottom'
          ? 'bottom-0 left-0 right-0 max-h-[85vh] overflow-auto rounded-t-[28px] border-t p-5'
          : side === 'right'
            ? 'right-0 top-0 h-screen w-full max-w-md rounded-l-[28px] border-l p-5'
            : 'left-0 top-0 h-screen w-full max-w-md rounded-r-[28px] border-r p-5'
      }`}
      role="dialog"
      aria-modal="true"
    >
      {@render children?.()}
    </div>
  </div>
{/if}
