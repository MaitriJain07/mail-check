import type { Db } from '../db/pool';
import { withTransaction } from '../db/pool';
import type { RowDataPacket } from '../db/pool';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch seconds when the current window ends. */
  resetAt: number;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface RateLimiter {
  hit(bucket: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Fixed-window counter in MySQL (no Redis). The upsert takes the row lock, so
 * concurrent hits on one bucket are counted exactly. Trade-off: a client can burst
 * up to 2x the limit across a window boundary. Acceptable here; a sliding window
 * would need a row per request or a two-window weighted estimate.
 */
export function createRateLimiter(db: Db, now: () => number = Date.now): RateLimiter {
  return {
    async hit(bucket, limit, windowSeconds) {
      const nowSec = Math.floor(now() / 1000);
      const windowStart = nowSec - (nowSec % windowSeconds);
      const resetAt = windowStart + windowSeconds;

      const hits = await withTransaction(db, async (conn) => {
        await conn.query(
          'INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1',
          [bucket, windowStart],
        );
        const [rows] = await conn.query<(RowDataPacket & { hits: number })[]>(
          'SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?',
          [bucket, windowStart],
        );
        return rows[0]?.hits ?? 1;
      });

      // Opportunistic cleanup of long-dead windows; never blocks or fails the request.
      if (Math.random() < 0.01) {
        void db.query('DELETE FROM rate_limits WHERE window_start < ?', [nowSec - 3600]).catch(() => undefined);
      }

      return {
        allowed: hits <= limit,
        limit,
        remaining: Math.max(0, limit - hits),
        resetAt,
        retryAfter: Math.max(1, resetAt - nowSec),
      };
    },
  };
}
