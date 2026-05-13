'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api/client';
import { isMockFallbackEnabled } from '@/lib/api/env';
import { applyLiveTickerPriceToMarkets, type LiveTickerUpdate } from '@/lib/api/livePrices';
import type { Market } from '@/lib/api/types';
import { useBinanceTickerStream } from '@/lib/hooks/useBinanceTickerStream';
import { filterMarketsForView, type FilterMode, type MarketCategory } from '@/lib/markets/filter';
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
    queryFn: async () => {
      const markets = await api.getMarkets({ hydrateLivePrices: false });
      void api.hydrateMarketsLivePrices(markets).then((hydratedMarkets) => {
        queryClient.setQueryData<Market[]>(['markets'], hydratedMarkets);
      });
      return markets;
    },
    staleTime: 2_500,
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
    <main className="mx-auto max-w-[1880px] px-4 py-5 sm:px-6">
      <section className="mb-5 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-black text-terminal-text">All markets</h1>
          <div className="flex items-center gap-2">
            <LiveConnectionBadge status={connectionStatus} label={connectionStatus === 'refetching' ? 'Refetching' : connectionStatus === 'offline' ? 'Offline' : 'Live'} />
            {isMockFallbackEnabled ? <LiveConnectionBadge status="mock" /> : null}
            <label className="relative hidden min-w-[220px] sm:block">
              <span className="sr-only">Search markets</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" size={18} />
              <Input className="h-10 rounded-xl border-terminal-line bg-terminal-elevated pl-10" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search markets" />
            </label>
            <Button size="icon" variant="ghost" aria-label="Filter markets">
              <SlidersHorizontal size={20} />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Saved markets">
              <Bookmark size={20} />
            </Button>
          </div>
        </div>

        <label className="relative block sm:hidden">
          <span className="sr-only">Search markets</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" size={18} />
          <Input className="h-10 rounded-xl border-terminal-line bg-terminal-elevated pl-10" placeholder="Search markets" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search markets" />
        </label>

        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Market filters">
          {filterTabs.map((tab) => (
            <Button key={tab.mode} size="sm" variant={filter === tab.mode ? 'default' : 'ghost'} className={filter === tab.mode ? 'bg-[#0b4f86] text-market-positive hover:bg-[#0b4f86]' : 'text-terminal-muted hover:text-terminal-text'} onClick={() => setFilter(tab.mode)}>
              {tab.label}
            </Button>
          ))}
        </div>
      </section>

      {marketsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-64 rounded-2xl" />)}</div>
      ) : marketsQuery.isError ? (
        <section className="terminal-panel p-6">
          <p className="text-sm font-black text-market-negative">API unavailable</p>
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
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {filteredMarkets.map((market) => <MarketRadarCard key={market.market_id} market={market} />)}
        </section>
      )}
    </main>
  );
}
