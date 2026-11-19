import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { openApiSpec } from '../src/openapi';
import { createCtx } from './helpers/ctx';

const ctx = createCtx();
afterAll(() => ctx.db.end());

describe('API docs', () => {
  it('serves Swagger UI at /docs', async () => {
    const res = await request(ctx.app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('serves the spec at /openapi.json and documents every public endpoint', async () => {
    const res = await request(ctx.app).get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    const ops = Object.entries(res.body.paths as Record<string, Record<string, unknown>>).flatMap(([p, m]) =>
      Object.keys(m).map((method) => `${method.toUpperCase()} ${p}`),
    );
    expect(ops).toEqual(
      expect.arrayContaining([
        'POST /v1/verify',
        'GET /v1/verify',
        'POST /v1/bulk',
        'GET /v1/bulk/{jobId}',
        'GET /v1/bulk/{jobId}/download',
        'GET /v1/usage',
        'GET /health',
        'POST /v1/auth/register',
        'POST /v1/auth/login',
        'POST /v1/keys',
        'GET /v1/keys',
        'DELETE /v1/keys/{id}',
      ]),
    );
  });

  it('has no dangling $refs', () => {
    const text = JSON.stringify(openApiSpec);
    const refs = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1] as string);
    for (const name of refs) expect(Object.keys(openApiSpec.components.schemas)).toContain(name);
  });
});
