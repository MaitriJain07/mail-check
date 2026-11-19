export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'skipped';
export type Verdict = 'deliverable' | 'undeliverable' | 'risky' | 'unknown';

export interface Check {
  status: CheckStatus;
  detail?: string;
}

export type CheckName = 'syntax' | 'disposable' | 'mx' | 'role' | 'smtp' | 'catchAll';

export interface VerificationResult {
  email: string;
  result: Verdict;
  reason: string;
  checks: Record<CheckName, Check>;
  score: number;
  durationMs: number;
}

export interface User {
  id: number;
  email: string;
  credits: number;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface Usage {
  credits: number;
  totals: { total: number } & Record<Verdict, number>;
  last7Days: { date: string; count: number }[];
  history: {
    items: { id: number; email: string; result: Verdict; creditsUsed: number; apiKeyPrefix: string | null; createdAt: string }[];
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface BulkJob {
  jobId: string;
  status: 'queued' | 'processing' | 'completed';
  progress: { total: number; processed: number; percent: number };
  counts: Record<Verdict | 'failed', number>;
  createdAt: string;
  finishedAt: string | null;
}
