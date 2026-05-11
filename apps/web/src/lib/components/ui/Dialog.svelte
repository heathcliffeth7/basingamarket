<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';

  let {
    open = false,
    title = '',
    children,
    onClose
  }: {
    open?: boolean;
    title?: string;
    children?: Snippet;
    onClose?: () => void;
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div
      class="terminal-panel max-h-[90vh] w-full max-w-xl overflow-auto p-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-terminal-text">{title}</h2>
        <Button size="icon" variant="ghost" onclick={onClose} aria-label="Close dialog">x</Button>
      </div>
      {@render children?.()}
    </div>
  </div>
{/if}
