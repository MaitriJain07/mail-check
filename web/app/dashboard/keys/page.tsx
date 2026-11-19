'use client';

import { useState, type FormEvent } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { btnPrimary, btnSecondary, Card, ErrorNote, inputClass, PageHeader, Skeleton, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ApiKey } from '@/lib/types';
import { useApi } from '@/lib/useApi';

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

export default function KeysPage() {
  const { token } = useAuth();
  const { data, error, loading, reload } = useApi<{ keys: ApiKey[] }>('/v1/keys');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const r = await api<{ key: string; apiKey: ApiKey }>('/v1/keys', { method: 'POST', body: { name }, token });
      setFresh({ key: r.key, name: r.apiKey.name });
      setName('');
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: number) {
    setRevoking(id);
    try {
      await api(`/v1/keys/${id}`, { method: 'DELETE', token });
      setConfirming(null);
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <PageHeader title="API keys" subtitle="Use a key in the X-API-Key header. We only store a hash, so a key can be copied once." />

      {fresh && (
        <div role="status" className="mb-5 rounded-xl border border-brand/30 bg-brand-soft p-4">
          <p className="text-sm font-semibold text-brand-ink">Key “{fresh.name}” created. Copy it now: you won’t be able to see it again.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-brand/20 bg-white px-3 py-2.5 font-mono text-sm">{fresh.key}</code>
            <CopyButton value={fresh.key} label="Copy key" />
            <button onClick={() => setFresh(null)} className={btnSecondary}>Done</button>
          </div>
        </div>
      )}

      <Card className="mb-5 p-5">
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="key-name" className="mb-1.5 block text-sm font-medium">New key name</label>
            <input id="key-name" required maxLength={100} placeholder="e.g. production backend" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <button type="submit" disabled={creating || !name.trim()} className={btnPrimary}>
            {creating && <Spinner />} Create key
          </button>
        </form>
        {formError && <div className="mt-3"><ErrorNote>{formError}</ErrorNote></div>}
      </Card>

      {error ? (
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
      ) : loading && !data ? (
        <Skeleton className="h-40" />
      ) : data && data.keys.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No keys yet. Create one above.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Key</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Last used</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.keys.map((k) => (
                <tr key={k.id} className={k.revokedAt ? 'text-muted' : ''}>
                  <td className="px-4 py-3 font-medium">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-[13px]">{k.prefix}…</td>
                  <td className="px-4 py-3">{fmt(k.createdAt)}</td>
                  <td className="px-4 py-3">{fmt(k.lastUsedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {k.revokedAt ? (
                      <span className="rounded-full bg-neutral-soft px-2.5 py-1 text-xs font-semibold text-neutral">Revoked</span>
                    ) : confirming === k.id ? (
                      <span className="inline-flex items-center gap-2">
                        <button onClick={() => revoke(k.id)} disabled={revoking === k.id} className="rounded-lg bg-bad px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                          {revoking === k.id ? 'Revoking…' : 'Confirm revoke'}
                        </button>
                        <button onClick={() => setConfirming(null)} className="text-sm font-medium text-muted hover:text-ink">Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirming(k.id)} className="text-sm font-semibold text-bad hover:underline">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
