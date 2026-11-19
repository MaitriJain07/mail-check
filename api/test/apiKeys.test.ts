import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createCtx, createKey, registerUser, resetDb } from './helpers/ctx';

const ctx = createCtx();
beforeEach(() => resetDb(ctx.db));
afterAll(() => ctx.db.end());

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('API keys', () => {
  it('creates a key, shows the full key once, and stores only a SHA-256 hash + prefix', async () => {
    const { token } = await registerUser(ctx);
    const res = await request(ctx.app).post('/v1/keys').set(bearer(token)).send({ name: 'prod' });
    expect(res.status).toBe(201);
    const { key, apiKey } = res.body;
    expect(key).toMatch(/^mc_live_[A-Za-z0-9_-]{32}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 12));
    expect(apiKey).not.toHaveProperty('key');

    const [rows] = await ctx.db.query('SELECT prefix, key_hash FROM api_keys');
    const row = (rows as { prefix: string; key_hash: string }[])[0]!;
    expect(row.key_hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(key);

    const list = await request(ctx.app).get('/v1/keys').set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.keys).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(list.body.keys[0]).toMatchObject({ name: 'prod', prefix: key.slice(0, 12), revokedAt: null });
  });

  it('authenticates programmatic requests via X-API-Key and Authorization: Bearer', async () => {
    const { token } = await registerUser(ctx);
    const { key } = await createKey(ctx, token);
    const a = await request(ctx.app).get('/v1/verify').query({ email: 'jane@example.com' }).set('X-API-Key', key);
    const b = await request(ctx.app).get('/v1/verify').query({ email: 'jane@example.com' }).set(bearer(key));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('rejects unknown keys', async () => {
    const res = await request(ctx.app).get('/v1/verify').query({ email: 'a@example.com' }).set('X-API-Key', 'mc_live_doesnotexistdoesnotexist0000');
    expect(res.status).toBe(401);
  });

  it('revoked keys stop working immediately', async () => {
    const { token } = await registerUser(ctx);
    const { key, id } = await createKey(ctx, token);
    expect((await request(ctx.app).delete(`/v1/keys/${id}`).set(bearer(token))).status).toBe(204);
    const res = await request(ctx.app).get('/v1/verify').query({ email: 'a@example.com' }).set('X-API-Key', key);
    expect(res.status).toBe(401);
    const list = await request(ctx.app).get('/v1/keys').set(bearer(token));
    expect(list.body.keys[0].revokedAt).not.toBeNull();
    // revoking twice is a 404, not a silent success
    expect((await request(ctx.app).delete(`/v1/keys/${id}`).set(bearer(token))).status).toBe(404);
  });

  it("cannot revoke or see another user's keys", async () => {
    const alice = await registerUser(ctx);
    const bob = await registerUser(ctx);
    const { id } = await createKey(ctx, alice.token);
    expect((await request(ctx.app).delete(`/v1/keys/${id}`).set(bearer(bob.token))).status).toBe(404);
    expect((await request(ctx.app).get('/v1/keys').set(bearer(bob.token))).body.keys).toHaveLength(0);
  });

  it('an API key cannot manage keys (JWT only)', async () => {
    const { token } = await registerUser(ctx);
    const { key } = await createKey(ctx, token);
    const res = await request(ctx.app).post('/v1/keys').set('X-API-Key', key).send({ name: 'sneaky' });
    expect(res.status).toBe(403);
  });

  it('validates the key name and the id parameter', async () => {
    const { token } = await registerUser(ctx);
    expect((await request(ctx.app).post('/v1/keys').set(bearer(token)).send({ name: '  ' })).status).toBe(400);
    expect((await request(ctx.app).delete('/v1/keys/abc').set(bearer(token))).status).toBe(400);
    expect((await request(ctx.app).get('/v1/keys')).status).toBe(401);
  });
});
