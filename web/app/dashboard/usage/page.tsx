'use client';

import { useState } from 'react';
import { btnSecondary, Card, ErrorNote, PageHeader, Skeleton, VerdictChip } from '@/components/ui';
import type { Usage } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const PAGE_SIZE = 10;

export default function UsagePage() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Usage>(`/v1/usage?page=${page}&pageSize=${PAGE_SIZE}`);

  const total = data?.history.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Usage history" subtitle="Every verification, newest first." />

      {error ? (
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
      ) : !data ? (
        <Skeleton className="h-96" />
      ) : data.history.items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No verifications yet.</Card>
      ) : (
        <Card className={`overflow-x-auto ${loading ? 'opacity-60 transition-opacity' : ''}`} aria-busy={loading}>
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Result</th>
                <th className="px-4 py-3 text-right font-semibold">Credits</th>
                <th className="px-4 py-3 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.history.items.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{new Date(row.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 font-mono text-[13px]" title={row.email}>{row.email}</td>
                  <td className="px-4 py-3"><VerdictChip verdict={row.result} /></td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{row.creditsUsed}</td>
                  <td className="px-4 py-3 font-mono text-[13px] text-muted">{row.apiKeyPrefix ? `${row.apiKeyPrefix}…` : 'Dashboard'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {data && total > 0 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted">
            Page {page} of {pages} · {total.toLocaleString()} total
          </p>
          <div className="flex gap-2">
            <button className={btnSecondary} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className={btnSecondary} disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </nav>
      )}
    </>
  );
}
