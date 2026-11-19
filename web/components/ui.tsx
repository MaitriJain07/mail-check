import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Verdict } from '@/lib/types';

export const inputClass =
  'w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted/70 shadow-[inset_0_1px_0_rgba(0,0,0,0.02)] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-[15px] font-semibold text-white transition hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-60';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink transition hover:border-ink/30 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span className="text-[17px]">MailCheck</span>
    </Link>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad">
      <span>{children}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-line/60 ${className}`} />;
}

export const VERDICT_STYLE: Record<Verdict, { label: string; chip: string; dot: string; bar: string }> = {
  deliverable: { label: 'Deliverable', chip: 'bg-good-soft text-good', dot: 'bg-good', bar: '#0d6b45' },
  undeliverable: { label: 'Undeliverable', chip: 'bg-bad-soft text-bad', dot: 'bg-bad', bar: '#b42318' },
  risky: { label: 'Risky', chip: 'bg-warn-soft text-warn', dot: 'bg-warn', bar: '#c4631a' },
  unknown: { label: 'Unknown', chip: 'bg-neutral-soft text-neutral', dot: 'bg-neutral', bar: '#8a94a3' },
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${s.chip}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-card ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
