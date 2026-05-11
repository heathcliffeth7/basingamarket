import MarketsClientPage from './MarketsClientPage';
import { normalizeMarketCategory } from '@/lib/markets/filter';

type MarketsSearchParams = {
  category?: string | string[];
};

export default async function MarketsPage({
  searchParams
}: {
  searchParams?: MarketsSearchParams | Promise<MarketsSearchParams>;
}) {
  const params = await searchParams;
  const rawCategory = Array.isArray(params?.category) ? params.category[0] : params?.category;

  return <MarketsClientPage initialCategory={normalizeMarketCategory(rawCategory)} />;
}
