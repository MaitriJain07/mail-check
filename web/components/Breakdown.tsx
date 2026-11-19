import type { Usage, Verdict } from '@/lib/types';
import { VERDICT_STYLE } from './ui';

const ORDER: Verdict[] = ['deliverable', 'risky', 'unknown', 'undeliverable'];

export function Breakdown({ totals }: { totals: Usage['totals'] }) {
  if (totals.total === 0) {
    return <p className="text-sm text-muted">No verifications yet. Results will break down here.</p>;
  }
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-line/70" role="img" aria-label={ORDER.map((v) => `${v} ${totals[v]}`).join(', ')}>
        {ORDER.map((v) =>
          totals[v] > 0 ? <div key={v} style={{ width: `${(totals[v] / totals.total) * 100}%`, background: VERDICT_STYLE[v].bar }} /> : null,
        )}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {ORDER.map((v) => (
          <li key={v}>
            <p className="flex items-center gap-2 text-sm text-muted">
              <span aria-hidden className={`h-2 w-2 rounded-full ${VERDICT_STYLE[v].dot}`} />
              {VERDICT_STYLE[v].label}
            </p>
            <p className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
              {totals[v].toLocaleString()}
              <span className="ml-1.5 text-xs font-normal text-muted">{Math.round((totals[v] / totals.total) * 100)}%</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
