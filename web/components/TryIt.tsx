'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { VerificationResult } from '@/lib/types';
import { ResultCard } from './ResultCard';
import { btnPrimary, ErrorNote, inputClass, Spinner } from './ui';

const EXAMPLES = ['someone@gmail.com', 'info@example.com', 'test@mailinator.com', 'hi@no-such-domain-4821.com'];

export function TryIt() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);

  async function run(value: string) {
    if (!value.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api<VerificationResult>('/v1/demo/verify', { method: 'POST', body: { email: value } }));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(email);
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row" noValidate>
        <label htmlFor="try-email" className="sr-only">Email address to verify</label>
        <input
          id="try-email"
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputClass} font-mono`}
        />
        <button type="submit" disabled={loading || !email.trim()} className={`${btnPrimary} sm:w-32`}>
          {loading ? <Spinner /> : null}
          {loading ? 'Checking' : 'Verify'}
        </button>
      </form>

      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
        Try:
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setEmail(ex);
              void run(ex);
            }}
            className="rounded-md border border-line bg-white px-2 py-1 font-mono text-[11.5px] text-ink hover:border-brand hover:text-brand"
          >
            {ex}
          </button>
        ))}
      </p>

      <div className="mt-5 min-h-4" aria-live="polite">
        {error && <ErrorNote>{error}</ErrorNote>}
        {result && !error && <ResultCard result={result} />}
      </div>
    </div>
  );
}
