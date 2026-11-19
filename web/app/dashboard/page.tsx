'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Breakdown } from '@/components/Breakdown';
import { Card, ErrorNote, PageHeader, Skeleton } from '@/components/ui';
import type { Usage } from '@/lib/types';
import { useApi } from '@/lib/useApi';

// The chart is below the fold and not needed for first paint: load it on demand.
const UsageChart = dynamic(() => import('@/components/UsageChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-48" />,
});

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className={`mt-1.5 font-mono text-4xl font-semibold tabular-nums tracking-tight ${accent ? 'text-brand' : ''}`}>{value}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </Card>
  );
}

export default function Overview() {
  const { data, error, loading, reload } = useApi<Usage>('/v1/usage?page=1&pageSize=1');

  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;

  const week = data?.last7Days.reduce((sum, d) => sum + d.count, 0) ?? 0;

  return (
    <>
      <PageHeader title="Overview" subtitle="Credits, recent activity and how your results break down." />

      {loading || !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading overview">
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Credits left" value={data.credits.toLocaleString()} hint={data.credits === 0 ? 'Out of credits' : '1 credit per conclusive result'} accent />
            <Stat label="Verifications this week" value={week.toLocaleString()} hint="Last 7 days (UTC)" />
            <Stat label="All-time verifications" value={data.totals.total.toLocaleString()} />
          </div>

          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold">Verifications per day</h2>
            {data.totals.total === 0 ? (
              <p className="py-10 text-center text-sm text-muted">
                Nothing yet. <Link href="/dashboard/keys" className="font-semibold text-brand underline underline-offset-2">Create an API key</Link> or{' '}
                <Link href="/dashboard/bulk" className="font-semibold text-brand underline underline-offset-2">upload a CSV</Link> to get started.
              </p>
            ) : (
              <UsageChart data={data.last7Days} />
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-base font-semibold">Result breakdown</h2>
            <Breakdown totals={data.totals} />
          </Card>
        </div>
      )}
    </>
  );
}
