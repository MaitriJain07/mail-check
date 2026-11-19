import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCtx, registerUser, resetDb } from './helpers/ctx';

const ctx = createCtx();
beforeEach(() => resetDb(ctx.db));
afterAll(() => ctx.db.end());

describe('auth', () => {
  it('registers with 100 free credits and a bcrypt-hashed password', async () => {
    const res = await request(ctx.app).post('/v1/auth/register').send({ email: 'Ada@Example.com', password: 'longenough1' });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(Number), email: 'ada@example.com', credits: 100 });
    expect(typeof res.body.token).toBe('string');

    const [rows] = await ctx.db.query('SELECT password_hash FROM users WHERE email = ?', ['ada@example.com']);
    const hash = (rows as { password_hash: string }[])[0]!.password_hash;
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain('longenough1');
  });

  it('rejects duplicate emails with 409', async () => {
    await registerUser(ctx, 'dup@example.com');
    const res = await request(ctx.app).post('/v1/auth/register').send({ email: 'DUP@example.com', password: 'longenough1' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('validates input with the standard error shape', async () => {
    const res = await request(ctx.app).post('/v1/auth/register').send({ email: 'nope', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'password']);
  });

  it('logs in with the right password and rejects wrong password / unknown user identically', async () => {
    await registerUser(ctx, 'login@example.com');
    const ok = await request(ctx.app).post('/v1/auth/login').send({ email: 'login@example.com', password: 'correct-horse-battery' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    const bad = await request(ctx.app).post('/v1/auth/login').send({ email: 'login@example.com', password: 'wrong-password' });
    const ghost = await request(ctx.app).post('/v1/auth/login').send({ email: 'ghost@example.com', password: 'whatever-123' });
    expect(bad.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(bad.body.error.message).toBe(ghost.body.error.message);
  });

  it('GET /v1/auth/me works with a token and 401s without or with a bad/expired one', async () => {
    const { token, user } = await registerUser(ctx);
    const me = await request(ctx.app).get('/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.id).toBe(user.id);

    expect((await request(ctx.app).get('/v1/auth/me')).status).toBe(401);
    expect((await request(ctx.app).get('/v1/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);

    const expired = jwt.sign({}, ctx.config.JWT_SECRET, { subject: String(user.id), expiresIn: -10 });
    expect((await request(ctx.app).get('/v1/auth/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);

    const wrongSecret = jwt.sign({}, 'another-secret-another-secret', { subject: String(user.id) });
    expect((await request(ctx.app).get('/v1/auth/me').set('Authorization', `Bearer ${wrongSecret}`)).status).toBe(401);
  });

  it('adds a request id to every response and honours an incoming one', async () => {
    const a = await request(ctx.app).get('/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(ctx.app).get('/health').set('X-Request-Id', 'trace-123');
    expect(b.headers['x-request-id']).toBe('trace-123');
  });

  it('returns JSON errors for unknown routes and malformed JSON', async () => {
    const nf = await request(ctx.app).get('/nope');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: { code: 'not_found', message: expect.any(String), details: null } });

    const bad = await request(ctx.app).post('/v1/auth/login').set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_json');
  });
});
