<script lang="ts">
  let { count = 0, label = 'cluster' }: { count?: number; label?: string } = $props();
</script>

<div class="inline-flex items-center gap-2 rounded-full border border-terminal-line bg-terminal-panel px-2 py-1">
  <span class="h-2 w-2 bg-market-neutral"></span>
  <span class="mono-label text-terminal-muted">{label}</span>
  <span class="font-mono text-sm text-terminal-text">{count}</span>
</div>
