import type { CheckName, CheckStatus, VerificationResult } from '@/lib/types';
import { VERDICT_STYLE } from './ui';

const ROWS: { key: CheckName; label: string; pass: string; fail: string }[] = [
  { key: 'syntax', label: 'Syntax', pass: 'Valid format', fail: 'Invalid format' },
  { key: 'disposable', label: 'Disposable domain', pass: 'Not a throwaway domain', fail: 'Disposable domain' },
  { key: 'mx', label: 'MX records', pass: 'Domain accepts mail', fail: 'No mail servers' },
  { key: 'role', label: 'Role account', pass: 'Personal mailbox', fail: 'Shared role address' },
  { key: 'smtp', label: 'SMTP mailbox', pass: 'Mailbox exists', fail: 'Mailbox rejected' },
  { key: 'catchAll', label: 'Catch-all', pass: 'Not a catch-all domain', fail: 'Catch-all domain' },
];

const STATUS: Record<CheckStatus, { text: string; cls: string }> = {
  pass: { text: 'Pass', cls: 'text-good' },
  fail: { text: 'Fail', cls: 'text-bad' },
  unknown: { text: 'Inconclusive', cls: 'text-neutral' },
  skipped: { text: 'Not run', cls: 'text-muted' },
};

function Icon({ status }: { status: CheckStatus }) {
  const common = { className: 'h-4 w-4', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (status === 'pass') return <svg aria-hidden {...common}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
  if (status === 'fail') return <svg aria-hidden {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (status === 'unknown') return <svg aria-hidden {...common}><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01" /></svg>;
  return <svg aria-hidden {...common}><path d="M6 12h12" /></svg>;
}

export function ResultCard({ result }: { result: VerificationResult }) {
  const v = VERDICT_STYLE[result.result];
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card text-left shadow-[0_1px_0_rgba(0,0,0,0.03),0_12px_32px_-16px_rgba(20,23,26,0.18)]">
      <div className={`flex items-start justify-between gap-4 px-5 py-4 ${v.chip}`}>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">Verdict</p>
          <p className="text-2xl font-semibold tracking-tight">{v.label}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">Score</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">{result.score}</p>
        </div>
      </div>

      <div className="border-b border-line px-5 py-3">
        <p className="truncate font-mono text-sm" title={result.email}>{result.email}</p>
        <p className="mt-0.5 text-sm text-muted">{result.reason}</p>
      </div>

      <ul className="divide-y divide-dashed divide-line">
        {ROWS.map((row) => {
          const check = result.checks[row.key];
          const s = STATUS[check.status];
          const text = check.status === 'pass' ? row.pass : check.status === 'fail' ? row.fail : s.text;
          return (
            <li key={row.key} className="flex items-center gap-3 px-5 py-2.5">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-current/10 ${s.cls}`}>
                <Icon status={check.status} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{row.label}</p>
                {check.detail && <p className="truncate font-mono text-xs text-muted" title={check.detail}>{check.detail}</p>}
              </div>
              <span className={`shrink-0 text-sm font-medium ${s.cls}`}>
                <span className="sr-only">{s.text}: </span>
                {text}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-line bg-paper/60 px-5 py-2 text-right font-mono text-xs text-muted">{result.durationMs} ms</p>
    </div>
  );
}
