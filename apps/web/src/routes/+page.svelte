<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    void goto('/markets', { replaceState: true });
  });
</script>

<main class="mx-auto flex min-h-[70vh] max-w-5xl items-center px-6">
  <div class="space-y-4">
    <p class="mono-label text-terminal-muted">routing</p>
    <h1 class="text-3xl font-semibold text-terminal-text">Opening the market terminal...</h1>
    <a class="text-market-positive underline decoration-market-positive/40 underline-offset-4" href="/markets">
      Go to markets
    </a>
  </div>
</main>
