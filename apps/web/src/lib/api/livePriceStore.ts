import type { LiveTickerUpdate } from './livePrices';

export type LivePriceListener = (update: LiveTickerUpdate) => void;

export type LivePriceStore = {
  getLatest: (symbol: string) => LiveTickerUpdate | null;
  push: (update: LiveTickerUpdate) => void;
  reset: () => void;
  subscribe: (listener: LivePriceListener) => () => void;
};

export function createLivePriceStore(): LivePriceStore {
  const listeners = new Set<LivePriceListener>();
  const latest = new Map<string, LiveTickerUpdate>();

  return {
    getLatest(symbol) {
      return latest.get(symbol) ?? null;
    },
    push(update) {
      latest.set(update.symbol, update);
      for (const listener of listeners) {
        listener(update);
      }
    },
    reset() {
      latest.clear();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
