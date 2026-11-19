import type { Db, RowDataPacket } from '../db/pool';
import { withTransaction } from '../db/pool';
import { Errors } from '../errors';
import type { VerificationResultKind } from '../verifier';

/** One credit per conclusive verdict. "unknown" is free: we could not tell you anything. */
export function creditCost(result: VerificationResultKind): number {
  return result === 'unknown' ? 0 : 1;
}

export async function getCredits(db: Db, userId: number): Promise<number> {
  const [rows] = await db.query<(RowDataPacket & { credits: number })[]>(
    'SELECT credits FROM users WHERE id = ?',
    [userId],
  );
  return rows[0]?.credits ?? 0;
}

export interface ChargeInput {
  userId: number;
  apiKeyId: number | null;
  email: string;
  result: VerificationResultKind;
}

/**
 * Decrement credits and record the usage row in ONE transaction.
 *
 * The guarded UPDATE (`credits >= cost`) takes the row lock, so concurrent charges
 * for the same user queue up behind each other and each sees the committed balance
 * of the one before it. Zero rows affected means the balance was too low: nothing
 * is written and the caller gets 402. The balance can never go negative or be spent twice.
 */
export async function chargeCredits(db: Db, input: ChargeInput): Promise<{ creditsUsed: number; remaining: number }> {
  const cost = creditCost(input.result);
  return withTransaction(db, async (conn) => {
    if (cost > 0) {
      const [res] = await conn.query(
        'UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?',
        [cost, input.userId, cost],
      );
      if ((res as { affectedRows: number }).affectedRows === 0) throw Errors.paymentRequired();
    }
    await conn.query(
      'INSERT INTO usage_events (user_id, api_key_id, email, result, credits_used) VALUES (?, ?, ?, ?, ?)',
      [input.userId, input.apiKeyId, input.email, input.result, cost],
    );
    const [rows] = await conn.query<(RowDataPacket & { credits: number })[]>(
      'SELECT credits FROM users WHERE id = ?',
      [input.userId],
    );
    return { creditsUsed: cost, remaining: rows[0]?.credits ?? 0 };
  });
}
