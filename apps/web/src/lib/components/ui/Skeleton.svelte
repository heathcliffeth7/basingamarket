<script lang="ts">
  import { cn } from '$lib/utils/cn';

  let { class: className }: { class?: string } = $props();
</script>

<div class={cn('animate-pulse rounded-3xl border border-terminal-line bg-terminal-elevated/80', className)} aria-hidden="true"></div>
