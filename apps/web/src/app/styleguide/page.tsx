import { Activity, Ticket } from 'lucide-react';
import Button from '@/lib/components/ui/Button';
import Badge from '@/lib/components/ui/Badge';
import Skeleton from '@/lib/components/ui/Skeleton';
import Toast from '@/lib/components/ui/Toast';
import Tooltip from '@/lib/components/ui/Tooltip';
import Input from '@/lib/components/ui/Input';

export default function StyleguidePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-terminal-text">Component Style Guide</h1>
      <p className="mono-label mt-2 text-terminal-muted">basingamarket terminal UI system</p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Buttons</h2>
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="warning">Warning</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="icon">i</Button>
          </div>
        </section>

        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Badges</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">neutral</Badge>
            <Badge tone="positive">positive</Badge>
            <Badge tone="success">success</Badge>
            <Badge tone="negative">negative</Badge>
            <Badge tone="warning">warning</Badge>
            <Badge tone="euphoric">euphoric</Badge>
          </div>
        </section>

        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Tooltip</h2>
          <div className="flex gap-4">
            <Tooltip content="Top tooltip"><span className="cursor-help text-terminal-text">Hover top</span></Tooltip>
            <Tooltip content="Bottom tooltip" side="bottom"><span className="cursor-help text-terminal-text">Hover bottom</span></Tooltip>
          </div>
        </section>

        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Form</h2>
          <div className="space-y-3">
            <Input placeholder="Enter amount" />
            <Input defaultValue="prefilled" />
          </div>
        </section>

        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Toast</h2>
          <div className="space-y-2">
            <Toast message="Operation successful" tone="positive" />
            <Toast message="Something went wrong" tone="negative" />
            <Toast message="Information note" tone="neutral" />
          </div>
        </section>

        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Skeleton</h2>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </div>
        </section>

        <section className="terminal-panel p-5">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Status Indicators</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-market-positive" /><span className="text-sm text-terminal-text">Live connection</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-market-warning" /><span className="text-sm text-terminal-text">Refetching</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-market-negative" /><span className="text-sm text-terminal-text">Offline</span></div>
          </div>
        </section>

        <section className="terminal-panel p-5 md:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Ticket Node States</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['active', '3d1f', 'A', 'border-market-positive', 'bg-market-neutral'],
              ['listed', '9bb2', 'L', 'border-market-warning', 'bg-market-warning'],
              ['won', 'e28a', 'W', 'border-[#10b981]', 'bg-[#10b981]'],
              ['lost', '78ad', 'X', 'border-terminal-line opacity-60', 'bg-market-negative'],
              ['claimed', 'abcd', 'C', 'border-market-neutral', 'bg-market-neutral']
            ].map(([label, owner, marker, border, bg]) => (
              <div key={label} className="grid place-items-center gap-2 rounded border border-terminal-line p-4">
                <div className={`relative grid h-12 w-12 place-items-center rounded-full border-2 bg-terminal-bg ${border}`}>
                  <span className="text-xs font-bold text-terminal-text">{owner}</span>
                  <span className={`absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-terminal-bg ${bg}`}>{marker}</span>
                </div>
                <span className="mono-label text-terminal-muted">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="terminal-panel p-5 md:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-terminal-text">Connection States</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="positive"><Activity size={13} /> live</Badge>
            <Badge tone="warning">refetching</Badge>
            <Badge tone="negative">offline</Badge>
            <Badge tone="neutral"><Ticket size={13} /> connecting</Badge>
          </div>
        </section>
      </div>
    </main>
  );
}
