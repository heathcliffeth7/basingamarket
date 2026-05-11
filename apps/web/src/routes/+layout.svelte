<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { Bell, ChevronDown, Search, UserRound, Wallet } from 'lucide-svelte';
  import '../app.css';
  import { isMockFallbackEnabled } from '$lib/api/env';
  import Button from '$lib/components/ui/Button.svelte';
  import LiveConnectionBadge from '$lib/components/market/LiveConnectionBadge.svelte';

  let { children } = $props();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });

  const isAuthenticated = false;
  const profileHref = '/profiles/4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const categories = ['Trending', 'New', 'Sports', 'Crypto', 'Finance'];
</script>

<QueryClientProvider client={queryClient}>
  <div class="terminal-shell min-h-screen">
    <header class="sticky top-0 z-40 border-b border-terminal-line bg-terminal-bg/94 backdrop-blur-xl" aria-label="Top navigation">
      <div class="mx-auto flex max-w-[1920px] items-center gap-3 px-4 py-1.5 sm:px-6">
        <a href="/markets" class="flex shrink-0 items-center gap-2" aria-label="basingamarket markets">
          <span class="grid h-8 w-8 place-items-center">
            <img src="/brand/bm-logo-mark.svg" alt="" aria-hidden="true" class="app-icon h-6 w-6" />
          </span>
          <span class="hidden text-base font-black text-terminal-text sm:block">basingamarket</span>
        </a>

        <label class="relative hidden min-w-[240px] max-w-[640px] flex-1 md:block">
          <span class="sr-only">Global market search</span>
          <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" size={16} />
          <input class="h-9 w-full rounded-lg border border-terminal-line bg-terminal-panel px-10 text-xs text-terminal-text placeholder:text-terminal-muted focus:border-market-positive" placeholder="Search markets..." />
        </label>

        <div class="ml-auto hidden items-center gap-3 lg:flex">
          <div class="hidden items-center gap-2 xl:flex">
            {#if isMockFallbackEnabled}
              <LiveConnectionBadge status="mock" label="Mock" />
            {/if}
            <LiveConnectionBadge status="live" label="Live" />
          </div>
          {#if isAuthenticated}
            <div class="hidden items-center gap-3 text-[11px] xl:flex">
              <div class="text-right leading-tight">
                <p class="font-semibold text-terminal-muted">BUSDC</p>
                <p class="font-black text-terminal-text">projection pending</p>
              </div>
            </div>
            <a
              href="/markets"
              class="inline-flex h-8 items-center gap-2 rounded-full border border-market-positive/45 bg-market-positive/10 px-3 text-xs font-black text-terminal-text transition hover:border-market-positive/70 hover:bg-market-positive/18"
              aria-label="Mint BUSDC"
            >
              <Wallet size={14} /> Mint BUSDC
            </a>
            <button class="text-terminal-muted hover:text-terminal-text" type="button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <a href={profileHref} class="flex items-center gap-2" aria-label="Profile">
              <span class="grid h-8 w-8 place-items-center rounded-full border border-terminal-line bg-terminal-panel-strong text-terminal-text">
                <UserRound size={16} />
              </span>
              <ChevronDown size={14} class="text-terminal-muted" />
            </a>
          {:else}
            <div class="flex items-center gap-2">
              <Button class="h-8 px-3 text-xs" variant="secondary">Login</Button>
              <Button class="h-8 px-3 text-xs">Sign up</Button>
            </div>
          {/if}
        </div>

        <div class="ml-auto flex min-w-0 items-center gap-2 lg:hidden">
          {#if isMockFallbackEnabled}
            <LiveConnectionBadge status="mock" label="Mock" />
          {/if}
          <LiveConnectionBadge status="live" label="Live" />
          {#if !isAuthenticated}
            <Button class="h-8 px-3 text-xs" variant="secondary">Login</Button>
            <Button class="h-8 px-3 text-xs">Sign up</Button>
          {/if}
        </div>
      </div>

      <nav class="mx-auto flex max-w-3xl justify-start gap-7 overflow-x-auto border-t border-terminal-line px-4 py-2 text-sm font-bold text-terminal-muted sm:justify-center sm:px-6" aria-label="Market categories">
        {#each categories as category, index}
          <a href="/markets" class="inline-flex shrink-0 items-center gap-1 hover:text-terminal-text">
            {#if index === 0}
              <span class="text-market-positive">↗</span>
            {/if}
            {category}
          </a>
        {/each}
      </nav>
    </header>

    {@render children()}
  </div>
</QueryClientProvider>
