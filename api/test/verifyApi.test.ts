import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCtx, createKey, registerUser, resetDb } from './helpers/ctx';

const ctx = createCtx();
beforeEach(() => resetDb(ctx.db));
afterAll(() => ctx.db.end());

describe('single verification API', () => {
  it('POST /v1/verify returns the documented result shape and charges one credit', async () => {
    const { token } = await registerUser(ctx);
    const { key } = await createKey(ctx, token);
    const res = await request(ctx.app).post('/v1/verify').set('X-API-Key', key).send({ email: ' Jane@Example.com ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: 'jane@example.com',
      result: 'deliverable',
      reason: expect.any(String),
      checks: {
        syntax: expect.objectContaining({ status: 'pass' }),
        disposable: expect.objectContaining({ status: 'pass' }),
        mx: expect.objectContaining({ status: 'pass' }),
        role: expect.objectContaining({ status: 'pass' }),
        smtp: expect.objectContaining({ status: 'pass' }),
        catchAll: expect.objectContaining({ status: 'pass' }),
      },
      score: expect.any(Number),
      durationMs: expect.any(Number),
    });
    expect(res.headers['x-credits-remaining']).toBe('99');
  });

  it('GET /v1/verify?email= works', async () => {
    const { token } = await registerUser(ctx);
    const res = await request(ctx.app).get('/v1/verify').query({ email: 'ghost@example.com' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('undeliverable');
  });

  it('covers other verdicts: invalid syntax, disposable, no MX, role', async () => {
    const { token } = await registerUser(ctx);
    const get = (email: string) => request(ctx.app).get('/v1/verify').query({ email }).set('Authorization', `Bearer ${token}`);
    expect((await get('bad-address')).body).toMatchObject({ result: 'undeliverable' });
    expect((await get('x@mailinator.com')).body).toMatchObject({ result: 'risky', reason: 'Disposable email domain' });
    expect((await get('x@nomx.example')).body).toMatchObject({ result: 'undeliverable' });
    expect((await get('admin@example.com')).body).toMatchObject({ result: 'risky' });
  });

  it('unknown results are free but still logged', async () => {
    const { token, user } = await registerUser(ctx);
    const res = await request(ctx.app).get('/v1/verify').query({ email: 'greylist@example.com' }).set('Authorization', `Bearer ${token}`);
    expect(res.body.result).toBe('unknown');
    expect(res.headers['x-credits-remaining']).toBe('100');
    const [rows] = await ctx.db.query('SELECT result, credits_used FROM usage_events WHERE user_id = ?', [user.id]);
    expect(rows).toEqual([{ result: 'unknown', credits_used: 0 }]);
  });

  it('writes a usage row with api_key_id, result, credits_used and timestamp', async () => {
    const { token, user } = await registerUser(ctx);
    const { key, id } = await createKey(ctx, token);
    await request(ctx.app).post('/v1/verify').set('X-API-Key', key).send({ email: 'jane@example.com' });
    const [rows] = await ctx.db.query('SELECT user_id, api_key_id, result, credits_used, created_at FROM usage_events');
    expect(rows).toEqual([{ user_id: user.id, api_key_id: id, result: 'deliverable', credits_used: 1, created_at: expect.any(Date) }]);
  });

  it('validates input (400) and requires auth (401)', async () => {
    const { token } = await registerUser(ctx);
    const auth = { Authorization: `Bearer ${token}` };
    const noEmail = await request(ctx.app).post('/v1/verify').set(auth).send({});
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error.code).toBe('validation_error');
    expect((await request(ctx.app).get('/v1/verify').set(auth)).status).toBe(400);
    expect((await request(ctx.app).post('/v1/verify').send({ email: 'a@b.co' })).status).toBe(401);
  });

  it('returns 402 once credits are exhausted', async () => {
    const { token, user } = await registerUser(ctx);
    await ctx.db.query('UPDATE users SET credits = 0 WHERE id = ?', [user.id]);
    const res = await request(ctx.app).get('/v1/verify').query({ email: 'jane@example.com' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('insufficient_credits');
  });

  it('health reports DB status', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('demo endpoint is public and free', async () => {
    const res = await request(ctx.app).post('/v1/demo/verify').send({ email: 'jane@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('deliverable');
    const [rows] = await ctx.db.query('SELECT COUNT(*) AS n FROM usage_events');
    expect(rows).toEqual([{ n: 0 }]);
  });

  it('GET /v1/usage returns credits, breakdown, 7-day series and paginated history', async () => {
    const { token } = await registerUser(ctx);
    const auth = { Authorization: `Bearer ${token}` };
    for (const e of ['a@example.com', 'ghost@example.com', 'b@example.com']) {
      await request(ctx.app).get('/v1/verify').query({ email: e }).set(auth);
    }
    const res = await request(ctx.app).get('/v1/usage').query({ page: 1, pageSize: 2 }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.credits).toBe(97);
    expect(res.body.totals).toMatchObject({ total: 3, deliverable: 2, undeliverable: 1 });
    expect(res.body.last7Days).toHaveLength(7);
    expect(res.body.last7Days.at(-1).count).toBe(3);
    expect(res.body.history).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(res.body.history.items).toHaveLength(2);
    expect(res.body.history.items[0].email).toBe('b@example.com');
    const p2 = await request(ctx.app).get('/v1/usage').query({ page: 2, pageSize: 2 }).set(auth);
    expect(p2.body.history.items).toHaveLength(1);
    expect((await request(ctx.app).get('/v1/usage').query({ page: 0 }).set(auth)).status).toBe(400);
  });
});
