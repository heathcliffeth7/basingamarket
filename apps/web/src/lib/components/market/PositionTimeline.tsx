import type { CanvasNode, Ticket } from '@/lib/api/types';
import { formatTokenAmount } from '@/lib/utils/amount';

export default function PositionTimeline({ ticket, node }: { ticket?: Ticket; node?: CanvasNode }) {
  const ticketId = ticket?.ticket_id ?? node?.ticket_id ?? '-';
  const caller = ticket?.original_caller ?? node?.original_caller ?? '-';
  const owner = ticket?.current_owner ?? node?.current_owner ?? node?.owner ?? '-';
  const stake = ticket?.stake_amount ?? node?.listed_price ?? null;

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
        <p className="mono-label text-terminal-muted">minted ticket</p>
        <p className="mt-1 font-mono text-sm text-terminal-text">#{ticketId} by {caller}</p>
      </div>
      <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
        <p className="mono-label text-terminal-muted">current owner</p>
        <p className="mt-1 break-all font-mono text-sm text-terminal-text">{owner}</p>
      </div>
      <div className="rounded-2xl border border-terminal-line bg-terminal-bg p-3">
        <p className="mono-label text-terminal-muted">position value</p>
        <p className="mt-1 font-mono text-sm text-terminal-text">{stake ? formatTokenAmount(stake) : 'projection pending'}</p>
      </div>
    </div>
  );
}
