import Link from 'next/link';
import { listApplicationsByStatus } from '@/db/applications';
import { tryGetDb } from '@/db/client';
import { type CurrentStatus } from '@/db/schema';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

type ArchiveFilter = 'all' | 'approved' | 'rejected';

function parseFilter(raw: string | undefined): ArchiveFilter {
  if (raw === 'approved' || raw === 'rejected') return raw;
  return 'all';
}

function statusesFor(filter: ArchiveFilter): CurrentStatus[] {
  if (filter === 'approved') return ['approved'];
  if (filter === 'rejected') return ['rejected'];
  return ['approved', 'rejected'];
}

export default async function ApplicationsPage({ searchParams }: PageProps) {
  if (!tryGetDb()) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <h1 className="text-lg font-semibold">Applications</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          DATABASE_URL is not configured. Set it in <code>.env.local</code> and
          run <code>npm run db:push</code> to enable persistence.
        </p>
      </div>
    );
  }

  const { status } = await searchParams;
  const filter = parseFilter(status);
  // Archive page only shows rows the reviewer explicitly archived from the
  // Finalized tab. Finalized-but-not-yet-archived rows stay in the queue.
  const rows = await listApplicationsByStatus(statusesFor(filter), 200, true);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <Link
        href="/"
        className="mb-3 inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to Queue
      </Link>
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">Applications archive</h1>
        <p className="text-xs text-muted-foreground">
          Every COLA application that&apos;s been finalized. In-flight items
          live on the <Link href="/" className="underline">Queue</Link>.
        </p>
      </header>

      <div className="mb-4 inline-flex rounded-md border border-border bg-card p-0.5">
        <FilterLink href="/applications" label="All" active={filter === 'all'} />
        <FilterLink
          href="/applications?status=approved"
          label="Approved"
          active={filter === 'approved'}
        />
        <FilterLink
          href="/applications?status=rejected"
          label="Rejected"
          active={filter === 'rejected'}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {filter === 'all'
            ? 'No finalized applications yet. Items appear here after you Finalize them on the Queue.'
            : `No ${filter} applications yet.`}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Filename</th>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Serial</th>
                <th className="px-3 py-2 font-medium">Final status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-accent/30">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    <Link href={`/applications/${row.id}`} className="block">
                      {formatRelative(row.createdAt)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/applications/${row.id}`}
                      className="block truncate text-foreground hover:underline"
                    >
                      {row.sourceFilename}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-foreground/90">
                    <Link href={`/applications/${row.id}`} className="block">
                      {row.brandName ?? <span className="text-muted-foreground">—</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-foreground/80">
                    <Link href={`/applications/${row.id}`} className="block">
                      {row.ttbSerialNumber ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/applications/${row.id}`} className="block">
                      <FinalStatusPill status={row.currentStatus} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

function FinalStatusPill({ status }: { status: string }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {status}
    </span>
  );
}

function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}
