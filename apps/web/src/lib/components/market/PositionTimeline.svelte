<script lang="ts">
  import type { CanvasNode, Ticket } from '$lib/api/types';

  let { ticket, node }: { ticket?: Ticket | null; node?: CanvasNode | null } = $props();

  const originalCaller = $derived(ticket?.original_caller ?? node?.original_caller ?? 'unknown');
  const currentOwner = $derived(ticket?.current_owner ?? node?.current_owner ?? node?.owner ?? 'unknown');
  const lastTransferAt = $derived(node?.last_transfer_at ?? null);
</script>

<ol class="space-y-3">
  <li class="border-l-2 border-market-neutral pl-3">
    <p class="mono-label text-terminal-muted">original caller</p>
    <p class="break-all font-mono text-sm text-terminal-text">{originalCaller}</p>
  </li>
  <li class="border-l-2 border-market-positive pl-3">
    <p class="mono-label text-terminal-muted">current owner</p>
    <p class="break-all font-mono text-sm text-terminal-text">{currentOwner}</p>
  </li>
  {#if lastTransferAt}
    <li class="border-l-2 border-market-warning pl-3">
      <p class="mono-label text-terminal-muted">transfer indicated</p>
      <p class="font-mono text-sm text-market-warning">{new Date(lastTransferAt).toLocaleString()}</p>
    </li>
  {/if}
</ol>
