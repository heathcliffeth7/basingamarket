<script lang="ts">
  import { cn } from '$lib/utils/cn';

  let { class: className = '', value = $bindable(''), type = 'text', ...rest } = $props();
</script>

<input
  class={cn(
    'h-11 w-full rounded-2xl border border-terminal-line bg-terminal-panel px-4 text-sm text-terminal-text placeholder:text-terminal-muted focus:border-market-positive',
    className
  )}
  bind:value
  {type}
  {...rest}
/>
