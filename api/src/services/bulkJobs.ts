import { randomUUID } from 'node:crypto';
import type { Db, RowDataPacket } from '../db/pool';
import { withTransaction } from '../db/pool';
import { Errors } from '../errors';
import type { VerificationResult } from '../verifier';

export interface BulkJobView {
  jobId: string;
  status: 'queued' | 'processing' | 'completed';
  progress: { total: number; processed: number; percent: number };
  counts: { deliverable: number; undeliverable: number; risky: number; unknown: number; failed: number };
  createdAt: Date;
  finishedAt: Date | null;
}

interface JobRow extends RowDataPacket {
  id: string;
  status: BulkJobView['status'];
  total: number;
  processed: number;
  deliverable: number;
  undeliverable: number;
  risky: number;
  unknown_count: number;
  failed: number;
  created_at: Date;
  finished_at: Date | null;
}

const toView = (r: JobRow): BulkJobView => ({
  jobId: r.id,
  status: r.status,
  progress: { total: r.total, processed: r.processed, percent: r.total === 0 ? 100 : Math.floor((r.processed / r.total) * 100) },
  counts: {
    deliverable: r.deliverable,
    undeliverable: r.undeliverable,
    risky: r.risky,
    unknown: r.unknown_count,
    failed: r.failed,
  },
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

/** Trim + lowercase + drop blanks and duplicates (a duplicate would cost a credit for no new information). */
export function normaliseEmails(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const e of raw) {
    const v = String(e ?? '').trim().toLowerCase();
    if (v) seen.add(v);
  }
  return [...seen];
}

const INSERT_CHUNK = 500;

export async function createBulkJob(
  db: Db,
  input: { userId: number; apiKeyId: number | null; emails: string[]; maxRows: number },
): Promise<BulkJobView> {
  const emails = normaliseEmails(input.emails);
  if (emails.length === 0) throw Errors.badRequest('No emails found');
  if (emails.length > input.maxRows) throw Errors.tooManyRows(emails.length, input.maxRows);

  const id = randomUUID();
  await withTransaction(db, async (conn) => {
    // Fail fast instead of queueing work the user cannot pay for. Credits are still charged
    // per item by the worker, so this is a courtesy check, not a reservation.
    const [u] = await conn.query<(RowDataPacket & { credits: number })[]>('SELECT credits FROM users WHERE id = ?', [input.userId]);
    const available = u[0]?.credits ?? 0;
    if (available < emails.length) {
      throw Errors.paymentRequired(`Need ${emails.length} credits, you have ${available}`, { required: emails.length, available });
    }
    await conn.query('INSERT INTO bulk_jobs (id, user_id, api_key_id, total) VALUES (?, ?, ?, ?)', [id, input.userId, input.apiKeyId, emails.length]);
    for (let i = 0; i < emails.length; i += INSERT_CHUNK) {
      const rows = emails.slice(i, i + INSERT_CHUNK).map((e) => [id, e]);
      await conn.query('INSERT INTO bulk_items (job_id, email) VALUES ?', [rows]);
    }
  });
  return (await getBulkJob(db, input.userId, id)) as BulkJobView;
}

export async function getBulkJob(db: Db, userId: number, jobId: string): Promise<BulkJobView | null> {
  // Ownership is part of the query: another user's job id is indistinguishable from a missing one.
  const [rows] = await db.query<JobRow[]>('SELECT * FROM bulk_jobs WHERE id = ? AND user_id = ?', [jobId, userId]);
  return rows[0] ? toView(rows[0]) : null;
}

// ---- CSV export ----

const HEADER = ['email', 'result', 'reason', 'score', 'syntax', 'disposable', 'mx', 'role', 'smtp', 'catch_all', 'error'];

/** Quote when needed, and defuse spreadsheet formula injection (=, +, -, @ at the start of a cell). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]): string => `${cells.map(csvCell).join(',')}\r\n`;

interface ItemRow extends RowDataPacket {
  id: number;
  email: string;
  status: string;
  result: VerificationResult | string | null;
  error: string | null;
}

/** Yields the CSV in chunks, paging by primary key so memory stays flat for big jobs. */
export async function* streamResultsCsv(db: Db, jobId: string, pageSize = 500): AsyncGenerator<string> {
  yield csvLine(HEADER);
  let lastId = 0;
  for (;;) {
    const [rows] = await db.query<ItemRow[]>(
      'SELECT id, email, status, result, error FROM bulk_items WHERE job_id = ? AND id > ? ORDER BY id LIMIT ?',
      [jobId, lastId, pageSize],
    );
    if (rows.length === 0) return;
    let chunk = '';
    for (const r of rows) {
      lastId = r.id;
      const res = (typeof r.result === 'string' ? JSON.parse(r.result) : r.result) as VerificationResult | null;
      chunk += csvLine(
        res
          ? [
              res.email,
              res.result,
              res.reason,
              res.score,
              res.checks.syntax.status,
              res.checks.disposable.status,
              res.checks.mx.status,
              res.checks.role.status,
              res.checks.smtp.status,
              res.checks.catchAll.status,
              '',
            ]
          : [r.email, 'failed', '', '', '', '', '', '', '', '', r.error ?? r.status],
      );
    }
    yield chunk;
  }
}
