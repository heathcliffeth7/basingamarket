<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Toast from '$lib/components/ui/Toast.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import Input from '$lib/components/ui/Input.svelte';
  import { Activity, Ticket } from 'lucide-svelte';
</script>

<svelte:head>
  <title>Style Guide | basingamarket</title>
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <h1 class="text-3xl font-semibold tracking-tight text-terminal-text">Component Style Guide</h1>
  <p class="mono-label mt-2 text-terminal-muted">basingamarket terminal UI system</p>

  <div class="mt-8 grid gap-6 md:grid-cols-2">
    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Buttons</h2>
      <div class="flex flex-wrap gap-2">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="warning">Warning</Button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="icon">i</Button>
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Badges</h2>
      <div class="flex flex-wrap gap-2">
        <Badge tone="neutral">neutral</Badge>
        <Badge tone="positive">positive</Badge>
        <Badge tone="success">success</Badge>
        <Badge tone="negative">negative</Badge>
        <Badge tone="warning">warning</Badge>
        <Badge tone="euphoric">euphoric</Badge>
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Panels</h2>
      <div class="space-y-2">
        <div class="terminal-panel p-3 text-sm text-terminal-text">Default terminal panel</div>
        <div class="border border-terminal-line-strong bg-terminal-panel-strong p-3 text-sm text-terminal-text">Strong panel</div>
        <div class="border border-terminal-line bg-terminal-elevated p-3 text-sm text-terminal-text">Elevated panel</div>
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Tooltip</h2>
      <div class="flex gap-4">
        <Tooltip content="Top tooltip"><span class="cursor-help text-terminal-text">Hover top</span></Tooltip>
        <Tooltip content="Bottom tooltip" side="bottom"><span class="cursor-help text-terminal-text">Hover bottom</span></Tooltip>
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Form</h2>
      <div class="space-y-3">
        <Input placeholder="Enter amount" />
        <Input value="prefilled" />
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Toast</h2>
      <div class="space-y-2">
        <Toast message="Operation successful" tone="positive" />
        <Toast message="Something went wrong" tone="negative" />
        <Toast message="Information note" tone="neutral" />
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Skeleton</h2>
      <div class="space-y-2">
        <Skeleton class="h-4 w-3/4" />
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-20 w-full" />
      </div>
    </section>

    <section class="terminal-panel p-5">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Status Indicators</h2>
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-market-positive"></span>
          <span class="text-sm text-terminal-text">Live connection</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-market-warning"></span>
          <span class="text-sm text-terminal-text">Refetching</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-market-negative"></span>
          <span class="text-sm text-terminal-text">Offline</span>
        </div>
      </div>
    </section>

    <section class="terminal-panel p-5 md:col-span-2">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Ticket Node States</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div class="grid place-items-center gap-2 rounded border border-terminal-line p-4">
          <div class="relative grid h-12 w-12 place-items-center rounded-full border-2 border-market-positive bg-terminal-bg">
            <span class="text-xs font-bold text-terminal-text">3d1f</span>
            <span class="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-market-neutral text-[10px] font-bold text-terminal-bg">A</span>
          </div>
          <span class="mono-label text-terminal-muted">active</span>
        </div>
        <div class="grid place-items-center gap-2 rounded border border-terminal-line p-4">
          <div class="relative grid h-12 w-12 place-items-center rounded-full border-2 border-market-warning bg-terminal-bg">
            <span class="text-xs font-bold text-terminal-text">9bb2</span>
            <span class="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-market-warning text-[10px] font-bold text-terminal-bg">L</span>
          </div>
          <span class="mono-label text-terminal-muted">listed</span>
        </div>
        <div class="grid place-items-center gap-2 rounded border border-terminal-line p-4">
          <div class="relative grid h-12 w-12 place-items-center rounded-full border-2 border-[#10b981] bg-terminal-bg shadow-[0_0_24px_rgba(16,185,129,0.18)]">
            <span class="text-xs font-bold text-terminal-text">e28a</span>
            <span class="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[#10b981] text-[10px] font-bold text-terminal-bg">W</span>
          </div>
          <span class="mono-label text-terminal-muted">won</span>
        </div>
        <div class="grid place-items-center gap-2 rounded border border-terminal-line p-4">
          <div class="relative grid h-12 w-12 place-items-center rounded-full border-2 border-terminal-line bg-[rgba(91,99,107,0.45)] opacity-60">
            <span class="text-xs font-bold text-terminal-muted">78ad</span>
            <span class="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-market-negative text-[10px] font-bold text-terminal-bg">X</span>
          </div>
          <span class="mono-label text-terminal-muted">lost</span>
        </div>
        <div class="grid place-items-center gap-2 rounded border border-terminal-line p-4">
          <div class="relative grid h-12 w-12 place-items-center rounded-full border-2 border-market-neutral bg-terminal-bg">
            <span class="text-xs font-bold text-terminal-text">abcd</span>
            <span class="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-market-neutral text-[10px] font-bold text-terminal-bg">C</span>
          </div>
          <span class="mono-label text-terminal-muted">claimed</span>
        </div>
      </div>
    </section>

    <section class="terminal-panel p-5 md:col-span-2">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Outcome Regions</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded border border-market-neutral/50 bg-market-neutral/10 p-4 text-center">
          <p class="text-sm font-semibold text-terminal-text">Open</p>
          <p class="mono-label mt-1 text-terminal-muted">thin blue-gray</p>
        </div>
        <div class="rounded border-2 border-market-neutral p-4 text-center">
          <p class="text-sm font-semibold text-terminal-text">Leading</p>
          <p class="mono-label mt-1 text-terminal-muted">stronger edge</p>
        </div>
        <div class="rounded border-2 border-[#10b981] bg-[#10b981]/10 p-4 text-center">
          <p class="text-sm font-semibold text-terminal-text">Resolved Winning</p>
          <p class="mono-label mt-1 text-terminal-muted">green outline</p>
        </div>
        <div class="rounded border border-terminal-line bg-terminal-panel p-4 text-center">
          <p class="text-sm font-semibold text-terminal-text">Resolved Losing</p>
          <p class="mono-label mt-1 text-terminal-muted">muted fill</p>
        </div>
      </div>
    </section>

    <section class="terminal-panel p-5 md:col-span-2">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Connection States</h2>
      <div class="flex flex-wrap gap-2">
        <span class="mono-label inline-flex items-center gap-2 border border-market-positive/40 bg-market-positive/10 px-2 py-1 text-market-positive">
          <span class="h-1.5 w-1.5 rounded-full bg-market-positive"></span> live
        </span>
        <span class="mono-label inline-flex items-center gap-2 border border-market-warning/40 bg-market-warning/10 px-2 py-1 text-market-warning">
          <span class="h-1.5 w-1.5 rounded-full bg-market-warning"></span> refetching
        </span>
        <span class="mono-label inline-flex items-center gap-2 border border-market-negative/40 bg-market-negative/10 px-2 py-1 text-market-negative">
          <span class="h-1.5 w-1.5 rounded-full bg-market-negative"></span> offline
        </span>
        <span class="mono-label inline-flex items-center gap-2 border border-market-neutral/40 bg-market-neutral/10 px-2 py-1 text-market-neutral">
          <span class="h-1.5 w-1.5 rounded-full bg-market-neutral"></span> connecting
        </span>
      </div>
    </section>

    <section class="terminal-panel p-5 md:col-span-2">
      <h2 class="mb-4 text-base font-semibold text-terminal-text">Mood Colors</h2>
      <div class="flex flex-wrap gap-3">
        <div class="flex items-center gap-2">
          <span class="h-4 w-4 rounded-full border border-terminal-line" style="background:#00c4ff"></span>
          <span class="text-sm text-terminal-text">neutral</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="h-4 w-4 rounded-full border border-terminal-line" style="background:#60a5fa"></span>
          <span class="text-sm text-terminal-text">optimistic</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="h-4 w-4 rounded-full border border-terminal-line" style="background:#ef4444"></span>
          <span class="text-sm text-terminal-text">anxious</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="h-4 w-4 rounded-full border border-terminal-line" style="background:#818cf8"></span>
          <span class="text-sm text-terminal-text">euphoric</span>
        </div>
      </div>
    </section>
  </div>
</main>
