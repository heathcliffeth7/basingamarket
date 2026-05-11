import type { CanvasNode, CanvasResponse, Market, Ticket } from '$lib/api/types';

export type SimpleMarketRead = {
  dominantOutcomeId: string | null;
  dominantOutcomeLabel: string;
  dominantOutcomeName: string;
  strengthLabel: string;
  confidenceLabel: 'Low' | 'Medium' | 'High';
};

export type DerivedMarketSignals = {
  dominantOutcomeLabel: string | null;
  capitalConcentrationLabel: string | null;
  visualWeightConcentrationLabel: string | null;
  userConcentrationLabel: string;
  averageConfidenceLabel: string;
  moodLabel: string;
  lateFlowLabel: string;
  hasPendingProjection: boolean;
};

export type RenderedCanvasItem =
  | { type: 'ticket'; node: CanvasNode }
  | { type: 'cluster'; outcome_id: string; count: number; x: number; y: number };

type SignalInput = {
  market?: Market | null;
  canvas?: CanvasResponse | null;
  tickets?: Ticket[] | null;
};

type OutcomeBucket = {
  id: string;
  label: string;
  stake: bigint;
  visualWeight: number;
  owners: Set<string>;
  nodeCount: number;
  ticketCount: number;
  confidenceTotal: number;
  confidenceCount: number;
  moods: Map<string, number>;
};

const moodNames: Record<number, string> = {
  0: 'neutral',
  1: 'optimistic',
  2: 'anxious',
  3: 'euphoric'
};

function safeBigInt(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return typeof value === 'bigint' ? value : BigInt(value);
  } catch {
    return 0n;
  }
}

function percent(part: bigint, total: bigint) {
  if (total <= 0n) return 0;
  return Number((part * 1000n) / total) / 10;
}

function percentNumber(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function confidenceLabel(value: number) {
  if (value >= 80) return `high ${Math.round(value)}`;
  if (value >= 60) return `steady ${Math.round(value)}`;
  if (value > 0) return `low ${Math.round(value)}`;
  return 'projection pending';
}

function simpleConfidenceLabel(value: number): SimpleMarketRead['confidenceLabel'] {
  if (value >= 70) return 'High';
  if (value >= 50) return 'Medium';
  return 'Low';
}

function getDominantMood(moods: Map<string, number>) {
  let best: { mood: string; count: number } | null = null;
  for (const [mood, count] of moods) {
    if (!best || count > best.count) best = { mood, count };
  }
  return best?.mood ?? null;
}

function ensureBucket(buckets: Map<string, OutcomeBucket>, id: string, label = id) {
  const existing = buckets.get(id);
  if (existing) {
    if (existing.label === id && label !== id) existing.label = label;
    return existing;
  }

  const bucket: OutcomeBucket = {
    id,
    label,
    stake: 0n,
    visualWeight: 0,
    owners: new Set(),
    nodeCount: 0,
    ticketCount: 0,
    confidenceTotal: 0,
    confidenceCount: 0,
    moods: new Map()
  };
  buckets.set(id, bucket);
  return bucket;
}

function labelForOutcome(input: SignalInput, outcomeId: string) {
  const outcome = input.market?.outcomes.find((item) => String(item.outcome_id) === outcomeId);
  if (outcome) return outcome.label;

  const region = input.canvas?.regions.find((item) => item.outcome_id === outcomeId);
  return region?.label ?? outcomeId;
}

export function deriveMarketSignals({ market, canvas, tickets }: SignalInput): DerivedMarketSignals {
  const buckets = new Map<string, OutcomeBucket>();

  for (const outcome of market?.outcomes ?? []) {
    const bucket = ensureBucket(buckets, String(outcome.outcome_id), outcome.label);
    bucket.stake += safeBigInt(outcome.total_stake);
  }

  for (const region of canvas?.regions ?? []) {
    ensureBucket(buckets, region.outcome_id, region.label);
  }

  for (const ticket of tickets ?? []) {
    const bucket = ensureBucket(buckets, String(ticket.outcome_id), labelForOutcome({ market, canvas, tickets }, String(ticket.outcome_id)));
    bucket.ticketCount += 1;
    bucket.stake += market?.outcomes?.length ? 0n : safeBigInt(ticket.stake_amount);
    bucket.owners.add(ticket.current_owner);
    bucket.confidenceTotal += ticket.confidence;
    bucket.confidenceCount += 1;
    const mood = moodNames[ticket.mood] ?? 'neutral';
    bucket.moods.set(mood, (bucket.moods.get(mood) ?? 0) + 1);
  }

  for (const node of canvas?.nodes ?? []) {
    const bucket = ensureBucket(buckets, node.outcome_id, labelForOutcome({ market, canvas, tickets }, node.outcome_id));
    bucket.nodeCount += 1;
    bucket.visualWeight += node.radius;
    bucket.owners.add(node.current_owner ?? node.owner);
    bucket.confidenceTotal += node.confidence;
    bucket.confidenceCount += 1;
    bucket.moods.set(node.mood, (bucket.moods.get(node.mood) ?? 0) + 1);
  }

  const allBuckets = [...buckets.values()];
  const totalStake = allBuckets.reduce((sum, bucket) => sum + bucket.stake, 0n);
  const totalVisualWeight = allBuckets.reduce((sum, bucket) => sum + bucket.visualWeight, 0);
  const totalOwners = allBuckets.reduce((sum, bucket) => sum + bucket.owners.size, 0);
  const totalConfidence = allBuckets.reduce((sum, bucket) => sum + bucket.confidenceTotal, 0);
  const totalConfidenceCount = allBuckets.reduce((sum, bucket) => sum + bucket.confidenceCount, 0);

  const dominantByStake = totalStake > 0n
    ? allBuckets.reduce<OutcomeBucket | null>((best, bucket) => (!best || bucket.stake > best.stake ? bucket : best), null)
    : null;
  const dominantByVisual = totalVisualWeight > 0
    ? allBuckets.reduce<OutcomeBucket | null>((best, bucket) => (!best || bucket.visualWeight > best.visualWeight ? bucket : best), null)
    : null;
  const dominantByUsers = totalOwners > 0
    ? allBuckets.reduce<OutcomeBucket | null>((best, bucket) => (!best || bucket.owners.size > best.owners.size ? bucket : best), null)
    : null;

  const dominant = dominantByStake ?? dominantByVisual ?? dominantByUsers;
  const capitalConcentrationLabel = dominantByStake
    ? `${formatPercent(percent(dominantByStake.stake, totalStake))} in ${dominantByStake.label}`
    : null;
  const visualWeightConcentrationLabel = !capitalConcentrationLabel && dominantByVisual
    ? `${formatPercent(percentNumber(dominantByVisual.visualWeight, totalVisualWeight))} in ${dominantByVisual.label}`
    : null;
  const userConcentrationLabel = dominantByUsers
    ? `${formatPercent(percentNumber(dominantByUsers.owners.size, totalOwners))} in ${dominantByUsers.label}`
    : 'projection pending';

  const averageConfidenceLabel = totalConfidenceCount > 0
    ? confidenceLabel(totalConfidence / totalConfidenceCount)
    : 'projection pending';

  const allMoods = new Map<string, number>();
  for (const bucket of allBuckets) {
    for (const [mood, count] of bucket.moods) {
      allMoods.set(mood, (allMoods.get(mood) ?? 0) + count);
    }
  }
  const mood = getDominantMood(allMoods);
  const moodLabel = mood ? `${mood} crowd` : 'projection pending';

  const latestMovedNode = [...(canvas?.nodes ?? [])]
    .filter((node): node is CanvasNode & { last_transfer_at: string } => Boolean(node.last_transfer_at))
    .sort((a, b) => Date.parse(b.last_transfer_at) - Date.parse(a.last_transfer_at))[0];
  const lateFlowLabel = latestMovedNode
    ? `toward ${labelForOutcome({ market, canvas, tickets }, latestMovedNode.outcome_id)}`
    : canvas?.nodes?.length || tickets?.length
      ? 'projection pending'
      : 'unavailable';

  return {
    dominantOutcomeLabel: dominant?.label ?? null,
    capitalConcentrationLabel,
    visualWeightConcentrationLabel,
    userConcentrationLabel,
    averageConfidenceLabel,
    moodLabel,
    lateFlowLabel,
    hasPendingProjection:
      !capitalConcentrationLabel ||
      userConcentrationLabel.includes('pending') ||
      averageConfidenceLabel.includes('pending') ||
      moodLabel.includes('pending') ||
      lateFlowLabel.includes('pending') ||
      lateFlowLabel === 'unavailable'
  };
}

export function deriveSimpleMarketRead({ market, canvas, tickets }: SignalInput): SimpleMarketRead {
  const advanced = deriveMarketSignals({ market, canvas, tickets });
  const buckets = new Map<string, OutcomeBucket>();

  for (const outcome of market?.outcomes ?? []) {
    const bucket = ensureBucket(buckets, String(outcome.outcome_id), outcome.label);
    bucket.stake += safeBigInt(outcome.total_stake);
  }

  for (const region of canvas?.regions ?? []) {
    ensureBucket(buckets, region.outcome_id, region.label);
  }

  for (const ticket of tickets ?? []) {
    const bucket = ensureBucket(buckets, String(ticket.outcome_id), labelForOutcome({ market, canvas, tickets }, String(ticket.outcome_id)));
    bucket.stake += market?.outcomes?.length ? 0n : safeBigInt(ticket.stake_amount);
    bucket.confidenceTotal += ticket.confidence;
    bucket.confidenceCount += 1;
  }

  for (const node of canvas?.nodes ?? []) {
    const bucket = ensureBucket(buckets, node.outcome_id, labelForOutcome({ market, canvas, tickets }, node.outcome_id));
    bucket.visualWeight += node.radius;
    bucket.confidenceTotal += node.confidence;
    bucket.confidenceCount += 1;
  }

  const allBuckets = [...buckets.values()];
  const totalStake = allBuckets.reduce((sum, bucket) => sum + bucket.stake, 0n);
  const totalVisualWeight = allBuckets.reduce((sum, bucket) => sum + bucket.visualWeight, 0);
  const totalConfidence = allBuckets.reduce((sum, bucket) => sum + bucket.confidenceTotal, 0);
  const totalConfidenceCount = allBuckets.reduce((sum, bucket) => sum + bucket.confidenceCount, 0);

  const dominantByStake = totalStake > 0n
    ? allBuckets.reduce<OutcomeBucket | null>((best, bucket) => (!best || bucket.stake > best.stake ? bucket : best), null)
    : null;
  const dominantByVisual = totalVisualWeight > 0
    ? allBuckets.reduce<OutcomeBucket | null>((best, bucket) => (!best || bucket.visualWeight > best.visualWeight ? bucket : best), null)
    : null;
  const dominant = dominantByStake ?? dominantByVisual ?? null;

  const capitalStrength = dominantByStake
    ? `${formatPercent(percent(dominantByStake.stake, totalStake))} capital`
    : null;
  const visualStrength = !capitalStrength && dominantByVisual
    ? `${formatPercent(percentNumber(dominantByVisual.visualWeight, totalVisualWeight))} visual capital`
    : null;

  return {
    dominantOutcomeId: dominant?.id ?? null,
    dominantOutcomeLabel: dominant?.label ?? advanced.dominantOutcomeLabel ?? 'Projection pending',
    dominantOutcomeName: dominant?.label ?? advanced.dominantOutcomeLabel ?? 'Projection pending',
    strengthLabel: capitalStrength ?? visualStrength ?? 'projection pending',
    confidenceLabel: simpleConfidenceLabel(totalConfidenceCount > 0 ? totalConfidence / totalConfidenceCount : 0)
  };
}

export function getRenderedCanvasItems({
  canvas,
  maxTicketsPerOutcome = 3
}: {
  canvas: CanvasResponse | null | undefined;
  maxTicketsPerOutcome?: number;
}): RenderedCanvasItem[] {
  if (!canvas) return [];

  const grouped = new Map<string, CanvasNode[]>();
  for (const node of canvas.nodes) {
    grouped.set(node.outcome_id, [...(grouped.get(node.outcome_id) ?? []), node]);
  }

  const items: RenderedCanvasItem[] = [];
  for (const [outcomeId, nodes] of grouped) {
    const sorted = [...nodes].sort((a, b) => b.radius - a.radius || a.z_index - b.z_index || a.ticket_id.localeCompare(b.ticket_id));
    const visible = sorted.slice(0, maxTicketsPerOutcome);
    const hidden = sorted.slice(maxTicketsPerOutcome);

    for (const node of visible) {
      items.push({ type: 'ticket', node });
    }

    if (hidden.length > 0) {
      const region = canvas.regions.find((candidate) => candidate.outcome_id === outcomeId);
      const x = region
        ? region.x + region.width - Math.min(96, region.width * 0.18)
        : hidden.reduce((sum, node) => sum + node.x, 0) / hidden.length;
      const y = region
        ? region.y + region.height - Math.min(72, region.height * 0.2)
        : hidden.reduce((sum, node) => sum + node.y, 0) / hidden.length;
      items.push({ type: 'cluster', outcome_id: outcomeId, count: hidden.length, x, y });
    }
  }

  return items;
}
