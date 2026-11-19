import { ApiError } from '../src/errors';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { chargeCredits } from '../src/services/credits';
import { createCtx, createKey, registerUser, resetDb } from './helpers/ctx';

// High per-key limit so the rate limiter does not interfere with concurrency tests.
const ctx = createCtx({ RATE_LIMIT_MAX: '1000' });
beforeEach(() => resetDb(ctx.db));
afterAll(() => ctx.db.end());

async function setCredits(userId: number, credits: number) {
  await ctx.db.query('UPDATE users SET credits = ? WHERE id = ?', [credits, userId]);
}
async function state(userId: number) {
  const [u] = await ctx.db.query('SELECT credits FROM users WHERE id = ?', [userId]);
  const [e] = await ctx.db.query('SELECT COUNT(*) AS n, COALESCE(SUM(credits_used),0) AS spent FROM usage_events WHERE user_id = ?', [userId]);
  return {
    credits: (u as { credits: number }[])[0]!.credits,
    events: Number((e as { n: number }[])[0]!.n),
    spent: Number((e as { spent: number }[])[0]!.spent),
  };
}

describe('credits', () => {
  it('chargeCredits never overspends under heavy concurrency (service level)', async () => {
    const { user } = await registerUser(ctx);
    await setCredits(user.id, 5);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) =>
        chargeCredits(ctx.db, { userId: user.id, apiKeyId: null, email: `e${i}@example.com`, result: 'deliverable' }),
      ),
    );
    const ok = outcomes.filter((o) => o.status === 'fulfilled');
    const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(35);
    expect(failed.map((f) => (f.reason instanceof ApiError ? f.reason.code : String(f.reason)))).toEqual(Array(35).fill('insufficient_credits'));
    // each success saw a distinct remaining balance: no double-spend
    expect(new Set(ok.map((o) => (o as PromiseFulfilledResult<{ remaining: number }>).value.remaining)).size).toBe(5);
    expect(await state(user.id)).toEqual({ credits: 0, events: 5, spent: 5 });
  });

  it('concurrent HTTP verifications: exactly N succeed, the rest get 402, balance ends at 0', async () => {
    const { token, user } = await registerUser(ctx);
    const { key } = await createKey(ctx, token);
    await setCredits(user.id, 4);
    const responses = await Promise.all(
      Array.from({ length: 16 }, () => request(ctx.app).get('/v1/verify').query({ email: 'jane@example.com' }).set('X-API-Key', key)),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(4);
    expect(statuses.filter((s) => s === 402)).toHaveLength(12);
    expect(statuses.every((s) => s === 200 || s === 402)).toBe(true);
    expect(await state(user.id)).toEqual({ credits: 0, events: 4, spent: 4 });
  });

  it('a failed charge leaves no usage row behind (atomic)', async () => {
    const { user } = await registerUser(ctx);
    await setCredits(user.id, 0);
    await expect(
      chargeCredits(ctx.db, { userId: user.id, apiKeyId: null, email: 'x@example.com', result: 'risky' }),
    ).rejects.toMatchObject({ status: 402 });
    expect(await state(user.id)).toEqual({ credits: 0, events: 0, spent: 0 });
  });

  it('the database itself refuses negative balances', async () => {
    const { user } = await registerUser(ctx);
    await expect(ctx.db.query('UPDATE users SET credits = credits - 1000 WHERE id = ?', [user.id])).rejects.toThrow();
    expect((await state(user.id)).credits).toBe(100);
  });

  it('"unknown" costs nothing but is still recorded', async () => {
    const { user } = await registerUser(ctx);
    const r = await chargeCredits(ctx.db, { userId: user.id, apiKeyId: null, email: 'x@example.com', result: 'unknown' });
    expect(r).toEqual({ creditsUsed: 0, remaining: 100 });
    expect(await state(user.id)).toEqual({ credits: 100, events: 1, spent: 0 });
  });
});
