'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, Search, Sparkles } from 'lucide-react';
import { api } from '@/lib/api/client';
import { isMockFallbackEnabled } from '@/lib/api/env';
import { applyLiveTickerPriceToMarkets, type LiveTickerUpdate } from '@/lib/api/livePrices';
import type { Market } from '@/lib/api/types';
import { useBinanceTickerStream } from '@/lib/hooks/useBinanceTickerStream';
import { filterMarketsForView, type FilterMode, type MarketCategory } from '@/lib/markets/filter';
import Badge from '@/lib/components/ui/Badge';
import Button from '@/lib/components/ui/Button';
import Input from '@/lib/components/ui/Input';
import Skeleton from '@/lib/components/ui/Skeleton';
import LiveConnectionBadge from '@/lib/components/market/LiveConnectionBadge';
import MarketRadarCard from '@/lib/components/market/MarketRadarCard';

const filterTabs: { mode: FilterMode; label: string }[] = [
  { mode: 'movers', label: 'Movers' },
  { mode: 'open', label: 'Open' },
  { mode: 'closing', label: 'Closing' },
  { mode: 'resolved', label: 'Resolved' },
  { mode: 'demo', label: 'Demo' }
];

export default function MarketsClientPage({ initialCategory }: { initialCategory: MarketCategory }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>('movers');
  const [search, setSearch] = useState('');
  const marketsQuery = useQuery({
    queryKey: ['markets'],
    queryFn: () => api.getMarkets(),
    staleTime: 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true
  });
  const updateLivePrice = useCallback(
    (update: LiveTickerUpdate) => {
      queryClient.setQueryData<Market[]>(['markets'], (markets) => applyLiveTickerPriceToMarkets(markets, update));
    },
    [queryClient]
  );
  useBinanceTickerStream(marketsQuery.data, updateLivePrice);
  const filteredMarkets = useMemo(
    () => filterMarketsForView({
      markets: marketsQuery.data ?? [],
      filter,
      search,
      category: initialCategory,
      mockFallbackEnabled: isMockFallbackEnabled
    }),
    [filter, initialCategory, marketsQuery.data, search]
  );
  const connectionStatus = marketsQuery.isError ? 'offline' : marketsQuery.isFetching ? 'refetching' : 'live';

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <section className="mb-5 space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-black text-terminal-text">Markets</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-terminal-muted">Browse live sentiment markets and open the field that is leaning hardest.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveConnectionBadge status={connectionStatus} label={connectionStatus === 'refetching' ? 'Refetching' : connectionStatus === 'offline' ? 'Offline' : 'Live'} />
            {isMockFallbackEnabled ? <LiveConnectionBadge status="mock" /> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-terminal-line bg-terminal-panel p-3 xl:flex-row xl:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search markets</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-terminal-muted" size={18} />
            <Input className="pl-11" placeholder="Search markets..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search markets" />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 xl:pb-0" aria-label="Market filters">
            <span className="inline-flex shrink-0 items-center gap-1 px-2 text-sm font-semibold text-terminal-muted"><Filter size={13} /> Filters</span>
            {filterTabs.map((tab) => (
              <Button key={tab.mode} size="sm" variant={filter === tab.mode ? 'default' : 'secondary'} onClick={() => setFilter(tab.mode)}>
                {tab.mode === 'movers' ? <Sparkles size={14} /> : null}
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {marketsQuery.isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-36" />)}</div>
      ) : marketsQuery.isError ? (
        <section className="terminal-panel p-6">
          <Badge tone="negative">API unavailable</Badge>
          <p className="mt-3 text-sm text-terminal-muted">The market list could not be loaded.</p>
        </section>
      ) : filteredMarkets.length === 0 ? (
        <section className="terminal-panel grid min-h-[360px] place-items-center p-8 text-center">
          <div>
            <p className="mono-label text-terminal-muted">empty state</p>
            <h2 className="mt-2 text-2xl font-semibold text-terminal-text">No markets match this search.</h2>
            <p className="mt-2 text-sm text-terminal-muted">Clear search, switch filters, or start the Rust API with seeded projections.</p>
          </div>
        </section>
      ) : (
        <section className="grid gap-3">
          {filteredMarkets.map((market) => <MarketRadarCard key={market.market_id} market={market} />)}
        </section>
      )}
    </main>
  );
}
