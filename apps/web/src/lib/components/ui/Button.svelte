<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils/cn';

  type Variant = 'default' | 'secondary' | 'ghost' | 'danger' | 'warning';
  type Size = 'sm' | 'md' | 'icon';

  let {
    children,
    class: className,
    variant = 'default',
    size = 'md',
    href,
    type = 'button',
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    variant?: Variant;
    size?: Size;
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    [key: string]: unknown;
  } = $props();

  const base =
    'inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45';
  const variants: Record<Variant, string> = {
    default: 'border-market-positive bg-market-positive text-white shadow-[0_0_24px_rgba(83,102,242,0.24)] hover:bg-market-positive/90',
    secondary: 'border-terminal-line bg-terminal-panel-strong text-terminal-text hover:border-terminal-line-strong hover:bg-terminal-elevated',
    ghost: 'border-transparent bg-transparent text-terminal-muted hover:bg-terminal-panel-strong hover:text-terminal-text',
    danger: 'border-market-negative/35 bg-market-negative/10 text-market-negative hover:bg-market-negative/18',
    warning: 'border-market-warning/35 bg-market-warning/10 text-market-warning hover:bg-market-warning/18'
  };
  const sizes: Record<Size, string> = {
    sm: 'h-9 px-3 text-xs',
    md: 'h-11 px-5 text-sm',
    icon: 'h-10 w-10 p-0'
  };
</script>

{#if href}
  <a class={cn(base, variants[variant], sizes[size], className)} {href} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button class={cn(base, variants[variant], sizes[size], className)} {type} {...rest}>
    {@render children?.()}
  </button>
{/if}
