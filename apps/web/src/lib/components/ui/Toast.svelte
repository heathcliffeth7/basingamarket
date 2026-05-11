<script lang="ts">
  let { message = '', tone = 'neutral' }: { message?: string; tone?: 'neutral' | 'positive' | 'negative' } = $props();

  const toneClass = {
    neutral: 'border-market-neutral text-market-neutral',
    positive: 'border-market-positive text-market-positive',
    negative: 'border-market-negative text-market-negative'
  };
</script>

{#if message}
  <div class={`rounded-2xl border bg-terminal-bg px-3 py-2 text-sm shadow-market ${toneClass[tone]}`} role="status">
    {message}
  </div>
{/if}
