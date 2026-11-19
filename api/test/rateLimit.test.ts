import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/services/rateLimiter';
import { createCtx, createKey, registerUser, resetDb } from './helpers/ctx';

const ctx = createCtx({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_SECONDS: '60', DEMO_RATE_LIMIT_MAX: '2' });
beforeEach(() => resetDb(ctx.db));
afterAll(() => ctx.db.end());

describe('rate limiting (MySQL-backed)', () => {
  it('counts down X-RateLimit-Remaining, then answers 429 with Retry-After', async () => {
    const { token } = await registerUser(ctx);
    const { key } = await createKey(ctx, token);
    const hit = () => request(ctx.app).get('/v1/verify').query({ email: 'jane@example.com' }).set('X-API-Key', key);

    const r1 = await hit();
    expect(r1.status).toBe(200);
    expect(r1.headers['x-ratelimit-limit']).toBe('3');
    expect(r1.headers['x-ratelimit-remaining']).toBe('2');
    expect(Number(r1.headers['x-ratelimit-reset'])).toBeGreaterThan(Date.now() / 1000);
    expect((await hit()).headers['x-ratelimit-remaining']).toBe('1');
    expect((await hit()).headers['x-ratelimit-remaining']).toBe('0');

    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('limits each API key independently', async () => {
    const { token } = await registerUser(ctx);
    const a = await createKey(ctx, token, 'a');
    const b = await createKey(ctx, token, 'b');
    const hit = (key: string) => request(ctx.app).get('/v1/verify').query({ email: 'jane@example.com' }).set('X-API-Key', key);
    for (let i = 0; i < 3; i++) await hit(a.key);
    expect((await hit(a.key)).status).toBe(429);
    expect((await hit(b.key)).status).toBe(200);
  });

  it('does not rate limit key management or usage reads', async () => {
    const { token } = await registerUser(ctx);
    for (let i = 0; i < 6; i++) {
      expect((await request(ctx.app).get('/v1/usage').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    }
  });

  it('limits the public demo endpoint per IP', async () => {
    const hit = () => request(ctx.app).post('/v1/demo/verify').send({ email: 'jane@example.com' });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('counts concurrent hits exactly (no lost updates)', async () => {
    const limiter = createRateLimiter(ctx.db);
    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.hit('concurrent', 5, 60)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(15);
  });

  it('starts a fresh window when time moves on', async () => {
    let now = 1_700_000_000_000;
    const limiter = createRateLimiter(ctx.db, () => now);
    expect((await limiter.hit('w', 1, 60)).allowed).toBe(true);
    const blocked = await limiter.hit('w', 1, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    now += 60_000;
    const again = await limiter.hit('w', 1, 60);
    expect(again.allowed).toBe(true);
    expect(again.remaining).toBe(0);
  });
});
