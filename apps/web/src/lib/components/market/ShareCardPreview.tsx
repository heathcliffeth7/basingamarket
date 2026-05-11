'use client';

import { Image, Loader2, RotateCcw } from 'lucide-react';
import type { ShareCardResponse, ShareRenderResponse } from '@/lib/api/types';
import Button from '@/lib/components/ui/Button';

export default function ShareCardPreview({
  share,
  render,
  onRender,
  disabled = false
}: {
  share?: ShareCardResponse;
  render?: ShareRenderResponse;
  onRender?: () => void;
  disabled?: boolean;
}) {
  const status = share?.status ?? render?.status ?? 'not requested';

  return (
    <section className="terminal-panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-terminal-line-strong px-4 py-3">
        <div>
          <p className="mono-label text-terminal-muted">share card</p>
          <h3 className="text-base font-semibold text-terminal-text">
            {status === 'pending' ? 'Preparing share card...' : status === 'rendering' ? 'Rendering market field...' : status === 'ready' ? 'Share card ready' : status === 'failed' ? 'Share render failed' : 'Not requested'}
          </h3>
        </div>
        {onRender ? (
          <Button size="sm" variant="secondary" onClick={onRender} disabled={disabled || status === 'rendering' || status === 'pending'}>
            {status === 'rendering' || status === 'pending' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {status === 'rendering' || status === 'pending' ? 'Rendering' : 'Render'}
          </Button>
        ) : null}
      </div>
      <div className="p-4">
        {status === 'ready' && share?.png_url ? (
          <div className="overflow-hidden rounded-2xl border border-terminal-line">
            <img className="aspect-[1200/630] w-full object-cover" src={share.png_url} alt="Share card preview" />
          </div>
        ) : (
          <div className="grid aspect-[1200/630] place-items-center rounded-2xl border border-dashed border-terminal-line bg-terminal-bg p-6 text-center">
            <div>
              {status === 'rendering' || status === 'pending' ? <Loader2 className="mx-auto mb-3 animate-spin text-terminal-muted" size={32} /> : <Image className="mx-auto mb-3 text-terminal-muted" size={32} />}
              <p className="text-sm text-terminal-muted">{status === 'failed' ? share?.error_message ?? 'Retry when the worker is ready.' : 'No share card rendered yet.'}</p>
              {onRender && status !== 'rendering' && status !== 'pending' ? (
                <Button size="sm" variant={status === 'failed' ? 'danger' : 'secondary'} className="mt-3" onClick={onRender} disabled={disabled}>
                  <RotateCcw size={14} /> {status === 'failed' ? 'Retry' : 'Render'}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
