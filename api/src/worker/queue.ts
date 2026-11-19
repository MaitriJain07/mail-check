import type { Conn, Db, ResultSetHeader, RowDataPacket } from '../db/pool';
import { withTransaction } from '../db/pool';
import { ApiError } from '../errors';
import { chargeCreditsTx } from '../services/credits';
import type { VerificationResult, VerificationResultKind } from '../verifier';

export interface ClaimedItem {
  id: number;
  jobId: string;
  email: string;
  /** Attempt number of THIS claim (1-based). Doubles as a fencing token. */
  attempts: number;
  userId: number;
  apiKeyId: number | null;
}

/**
 * Hand expired leases back to the queue: a worker that crashed (or stalled past
 * its lease) must not strand items in "processing" forever.
 */
export async function recoverStaleItems(db: Db): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    "UPDATE bulk_items SET status = 'pending', locked_until = NULL WHERE status = 'processing' AND locked_until < NOW(3)",
  );
  return res.affectedRows;
}

/**
 * Claim up to `limit` due items. `FOR UPDATE SKIP LOCKED` lets many workers pull from
 * the same table at once: each takes whatever rows nobody else has locked instead of
 * queueing behind them, so no item is handed to two workers and nobody blocks.
 */
export async function claimItems(db: Db, limit: number, leaseSeconds: number): Promise<ClaimedItem[]> {
  return withTransaction(db, async (conn) => {
    const [rows] = await conn.query<(RowDataPacket & { id: number; job_id: string; email: string; attempts: number })[]>(
      `SELECT id, job_id, email, attempts FROM bulk_items
        WHERE status = 'pending' AND next_attempt_at <= NOW(3)
        ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const jobIds = [...new Set(rows.map((r) => r.job_id))];
    await conn.query(
      "UPDATE bulk_items SET status = 'processing', attempts = attempts + 1, locked_until = NOW(3) + INTERVAL ? SECOND WHERE id IN (?)",
      [leaseSeconds, ids],
    );
    await conn.query("UPDATE bulk_jobs SET status = 'processing' WHERE id IN (?) AND status = 'queued'", [jobIds]);
    const [jobs] = await conn.query<(RowDataPacket & { id: string; user_id: number; api_key_id: number | null })[]>(
      'SELECT id, user_id, api_key_id FROM bulk_jobs WHERE id IN (?)',
      [jobIds],
    );
    const owner = new Map(jobs.map((j) => [j.id, j]));
    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      email: r.email,
      attempts: r.attempts + 1,
      userId: owner.get(r.job_id)!.user_id,
      apiKeyId: owner.get(r.job_id)!.api_key_id,
    }));
  });
}

type Counter = VerificationResultKind | 'failed';
const COLUMN: Record<Counter, string> = {
  deliverable: 'deliverable',
  undeliverable: 'undeliverable',
  risky: 'risky',
  unknown: 'unknown_count',
  failed: 'failed',
};

async function bumpJob(conn: Conn, jobId: string, counter: Counter): Promise<void> {
  const col = COLUMN[counter]; // whitelisted above, never user input
  await conn.query(`UPDATE bulk_jobs SET processed = processed + 1, ${col} = ${col} + 1 WHERE id = ?`, [jobId]);
  await conn.query(
    "UPDATE bulk_jobs SET status = 'completed', finished_at = NOW(3) WHERE id = ? AND processed >= total AND status <> 'completed'",
    [jobId],
  );
}

class LeaseLost extends Error {}

/** Mark failed for good (no retry): counted in the job and visible in the CSV. */
export async function failItemPermanently(db: Db, item: ClaimedItem, error: string): Promise<void> {
  await withTransaction(db, async (conn) => {
    const [r] = await conn.query<ResultSetHeader>(
      "UPDATE bulk_items SET status = 'failed', error = ?, locked_until = NULL WHERE id = ? AND status = 'processing' AND attempts = ?",
      [error.slice(0, 255), item.id, item.attempts],
    );
    if (r.affectedRows === 0) return; // someone else owns it now
    await bumpJob(conn, item.jobId, 'failed');
  });
}

/** Retry with a small backoff while attempts remain, otherwise fail permanently. */
export async function retryOrFail(
  db: Db,
  item: ClaimedItem,
  error: string,
  opts: { maxAttempts: number; retryDelaySeconds: number },
): Promise<'retry' | 'failed'> {
  if (item.attempts >= opts.maxAttempts) {
    await failItemPermanently(db, item, error);
    return 'failed';
  }
  await db.query(
    `UPDATE bulk_items
        SET status = 'pending', locked_until = NULL, error = ?,
            next_attempt_at = NOW(3) + INTERVAL ? SECOND
      WHERE id = ? AND status = 'processing' AND attempts = ?`,
    [error.slice(0, 255), opts.retryDelaySeconds * item.attempts, item.id, item.attempts],
  );
  return 'retry';
}

/**
 * One transaction: mark the item done (fenced on the attempt number), charge the credit,
 * write the usage row and bump the job. A crash anywhere leaves nothing half-applied,
 * and a worker whose lease expired cannot double-charge because its fence no longer matches.
 * Returns false when out of credits (the item is then failed, not retried).
 */
export async function completeItem(db: Db, item: ClaimedItem, result: VerificationResult): Promise<boolean> {
  try {
    await withTransaction(db, async (conn) => {
      const [r] = await conn.query<ResultSetHeader>(
        "UPDATE bulk_items SET status = 'done', result = ?, error = NULL, locked_until = NULL WHERE id = ? AND status = 'processing' AND attempts = ?",
        [JSON.stringify(result), item.id, item.attempts],
      );
      if (r.affectedRows === 0) throw new LeaseLost();
      await chargeCreditsTx(conn, { userId: item.userId, apiKeyId: item.apiKeyId, email: result.email, result: result.result });
      await bumpJob(conn, item.jobId, result.result);
    });
    return true;
  } catch (err) {
    if (err instanceof LeaseLost) return true;
    if (err instanceof ApiError && err.status === 402) {
      await failItemPermanently(db, item, 'insufficient_credits');
      return false;
    }
    throw err;
  }
}
