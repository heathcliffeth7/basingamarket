<script lang="ts">
  import { Image, RotateCcw, Loader2 } from 'lucide-svelte';
  import type { ShareCardResponse, ShareRenderResponse } from '$lib/api/types';
  import Button from '$lib/components/ui/Button.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';

  let {
    share,
    render,
    onRender
  }: {
    share?: ShareCardResponse | null;
    render?: ShareRenderResponse | null;
    onRender?: () => void;
  } = $props();

  const status = $derived(share?.status ?? render?.status ?? 'not requested');
</script>

<section class="terminal-panel overflow-hidden">
  <div class="flex items-center justify-between gap-3 border-b border-terminal-line-strong px-4 py-3">
    <div>
      <p class="mono-label text-terminal-muted">share card</p>
      <h3 class="text-base font-semibold text-terminal-text">
        {status === 'pending' ? 'Preparing share card...' : status === 'rendering' ? 'Rendering market field...' : status === 'ready' ? 'Share card ready' : status === 'failed' ? 'Share render failed' : 'Not requested'}
      </h3>
    </div>
    {#if onRender}
      <Button size="sm" variant="secondary" onclick={onRender} disabled={status === 'rendering' || status === 'pending'}>
        {#if status === 'rendering' || status === 'pending'}
          <Loader2 size={14} class="animate-spin" />
        {:else}
          <RotateCcw size={14} />
        {/if}
        {status === 'rendering' || status === 'pending' ? 'Rendering' : 'Render'}
      </Button>
    {/if}
  </div>

  <div class="p-4">
    {#if status === 'ready' && share?.png_url}
      <div class="overflow-hidden rounded-2xl border border-terminal-line">
        <img class="aspect-[1200/630] w-full object-cover" src={share.png_url} alt="Share card preview" />
      </div>
      <div class="mt-2 flex items-center justify-between gap-3">
        <p class="mono-label text-terminal-muted">basingamarket · {share.kind}</p>
        <p class="mono-label text-terminal-muted">{share.id}</p>
      </div>
    {:else if status === 'failed'}
      <div class="grid aspect-[1200/630] place-items-center rounded-2xl border border-market-negative/35 bg-market-negative/10 p-6 text-center">
        <div>
          <p class="text-sm font-medium text-market-negative">Share render failed</p>
          <p class="mt-1 text-xs text-terminal-muted">{share?.error_message ?? 'Retry when the worker is ready.'}</p>
          {#if onRender}
            <Button size="sm" variant="danger" class="mt-3" onclick={onRender}>
              <RotateCcw size={14} /> Retry
            </Button>
          {/if}
        </div>
      </div>
    {:else if status === 'rendering' || status === 'pending'}
      <div class="grid aspect-[1200/630] place-items-center rounded-2xl border border-dashed border-terminal-line bg-terminal-bg p-6 text-center">
        <div>
          <Loader2 class="mx-auto mb-3 animate-spin text-terminal-muted" size={32} />
          <p class="text-sm text-terminal-muted">
            {status === 'pending' ? 'Preparing share card...' : 'Rendering market field...'}
          </p>
          <p class="mono-label mt-1 text-terminal-muted">canvas-native output</p>
        </div>
      </div>
    {:else}
      <div class="grid aspect-[1200/630] place-items-center rounded-2xl border border-dashed border-terminal-line bg-terminal-bg p-6 text-center">
        <div>
          <Image class="mx-auto mb-3 text-terminal-muted" size={32} />
          <p class="text-sm text-terminal-muted">No share card rendered yet.</p>
          {#if onRender}
            <Button size="sm" variant="secondary" class="mt-3" onclick={onRender}>
              <RotateCcw size={14} /> Render
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</section>
