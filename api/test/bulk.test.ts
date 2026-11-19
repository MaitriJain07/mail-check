import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { emailsFromCsv } from '../src/routes/bulk';
import { csvCell } from '../src/services/bulkJobs';
import type { VerificationResult, Verifier } from '../src/verifier';
import { createWorker } from '../src/worker/runner';
import { DomainThrottle } from '../src/worker/throttle';
import { createCtx, registerUser, resetDb, testVerifier, warmPool, type TestCtx } from './helpers/ctx';

const silent = { info: () => undefined, error: () => undefined };
const ctx = createCtx({ RATE_LIMIT_MAX: '1000', WORKER_CONCURRENCY: '3', BULK_MAX_ROWS: '100', BULK_MAX_ATTEMPTS: '3' });
const extraPools: TestCtx[] = [];

beforeEach(() => resetDb(ctx.db));
afterAll(async () => {
  await ctx.db.end();
  await Promise.all(extraPools.map((c) => c.db.end().catch(() => undefined)));
});

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const workerFor = (c: TestCtx, verifier: Verifier = c.verifier) => createWorker({ db: c.db, config: c.config, verifier, log: silent });

function fakeResult(email: string, result: VerificationResult['result'] = 'deliverable'): VerificationResult {
  const pass = { status: 'pass' as const };
  return { email, result, reason: 'fake', score: 90, durationMs: 1, checks: { syntax: pass, disposable: pass, mx: pass, role: pass, smtp: pass, catchAll: pass } };
}

async function submit(token: string, emails: string[]) {
  return request(ctx.app).post('/v1/bulk').set(bearer(token)).send({ emails });
}
async function itemRows() {
  const [rows] = await ctx.db.query('SELECT email, status, attempts, error FROM bulk_items ORDER BY id');
  return rows as { email: string; status: string; attempts: number; error: string | null }[];
}
async function credits(userId: number) {
  const [rows] = await ctx.db.query('SELECT credits FROM users WHERE id = ?', [userId]);
  return (rows as { credits: number }[])[0]!.credits;
}
async function usageCount() {
  const [rows] = await ctx.db.query('SELECT COUNT(*) AS n FROM usage_events');
  return Number((rows as { n: number }[])[0]!.n);
}

describe('bulk job lifecycle', () => {
  it('queue -> process -> status -> CSV download, charging one credit per verified email', async () => {
    const { token, user } = await registerUser(ctx);
    const created = await submit(token, ['Jane@Example.com', 'ghost@example.com', ' jane@example.com ', 'x@mailinator.com', 'greylist@example.com']);
    expect(created.status).toBe(202);
    expect(created.headers.location).toBe(`/v1/bulk/${created.body.jobId}`);
    // duplicates (case/whitespace-insensitive) collapse
    expect(created.body).toMatchObject({ status: 'queued', progress: { total: 4, processed: 0, percent: 0 } });
    const { jobId } = created.body;

    // not downloadable until finished
    expect((await request(ctx.app).get(`/v1/bulk/${jobId}/download`).set(bearer(token))).status).toBe(409);

    await workerFor(ctx).runUntilIdle();

    const status = await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(token));
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      status: 'completed',
      progress: { total: 4, processed: 4, percent: 100 },
      counts: { deliverable: 1, undeliverable: 1, risky: 1, unknown: 1, failed: 0 },
    });
    expect(status.body.finishedAt).not.toBeNull();

    const csv = await request(ctx.app).get(`/v1/bulk/${jobId}/download`).set(bearer(token));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toContain(`mailcheck-${jobId}.csv`);
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('email,result,reason,score,syntax,disposable,mx,role,smtp,catch_all,error');
    expect(lines).toHaveLength(5);
    expect(csv.text).toContain('jane@example.com,deliverable');
    expect(csv.text).toContain('ghost@example.com,undeliverable');

    // 3 conclusive verdicts charged, the "unknown" one is free; 4 usage rows
    expect(await credits(user.id)).toBe(97);
    expect(await usageCount()).toBe(4);
  });

  it('accepts a CSV upload (header column picked by name, other columns ignored)', async () => {
    const { token } = await registerUser(ctx);
    const csv = 'name,Email,notes\r\nAda,ada@example.com,"hello, world"\r\nBob,bob@example.com,x\r\n';
    const res = await request(ctx.app).post('/v1/bulk').set(bearer(token)).attach('file', Buffer.from(csv), 'contacts.csv');
    expect(res.status).toBe(202);
    expect(res.body.progress.total).toBe(2);
  });

  it('parses CSV variants: BOM, no header, unnamed header', () => {
    expect(emailsFromCsv('﻿email\na@x.com\nb@x.com')).toEqual(['a@x.com', 'b@x.com']);
    expect(emailsFromCsv('a@x.com\nb@x.com')).toEqual(['a@x.com', 'b@x.com']);
    expect(emailsFromCsv('Contacts\na@x.com')).toEqual(['a@x.com']);
    expect(emailsFromCsv('')).toEqual([]);
  });

  it('rejects empty input, missing file, and non-array JSON', async () => {
    const { token } = await registerUser(ctx);
    expect((await submit(token, [])).status).toBe(400);
    expect((await submit(token, ['', '  '])).status).toBe(400);
    expect((await request(ctx.app).post('/v1/bulk').set(bearer(token)).send({ emails: 'a@b.co' })).status).toBe(400);
    expect((await request(ctx.app).post('/v1/bulk').set(bearer(token)).field('x', 'y')).status).toBe(400);
  });

  it('enforces the configurable max rows with 413', async () => {
    const { token } = await registerUser(ctx);
    const res = await submit(token, Array.from({ length: 101 }, (_, i) => `u${i}@example.com`));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatchObject({ code: 'too_many_rows', details: { count: 101, max: 100 } });
  });

  it('402 up front when the balance cannot cover the list; nothing is queued', async () => {
    const { token, user } = await registerUser(ctx);
    await ctx.db.query('UPDATE users SET credits = 2 WHERE id = ?', [user.id]);
    const res = await submit(token, ['a@example.com', 'b@example.com', 'c@example.com']);
    expect(res.status).toBe(402);
    expect(res.body.error.details).toEqual({ required: 3, available: 2 });
    expect(await itemRows()).toHaveLength(0);
  });

  it("hides other users' jobs (404) and validates the id (400)", async () => {
    const alice = await registerUser(ctx);
    const bob = await registerUser(ctx);
    const { jobId } = (await submit(alice.token, ['a@example.com'])).body;
    expect((await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(bob.token))).status).toBe(404);
    expect((await request(ctx.app).get(`/v1/bulk/${jobId}/download`).set(bearer(bob.token))).status).toBe(404);
    expect((await request(ctx.app).get('/v1/bulk/not-a-uuid').set(bearer(alice.token))).status).toBe(400);
    expect((await request(ctx.app).get(`/v1/bulk/${jobId}`)).status).toBe(401);
  });

  it('survives an API restart: the job lives in MySQL, a brand-new app + worker finish it', async () => {
    const { token } = await registerUser(ctx);
    const { jobId } = (await submit(token, ['a@example.com', 'b@example.com', 'c@example.com'])).body;

    // "restart": drop everything in-process and bring up a fresh app on a fresh pool
    const restarted = createCtx({ RATE_LIMIT_MAX: '1000', WORKER_CONCURRENCY: '3' });
    extraPools.push(restarted);
    await workerFor(restarted).runUntilIdle();

    const res = await request(restarted.app).get(`/v1/bulk/${jobId}`).set(bearer(token));
    expect(res.body).toMatchObject({ status: 'completed', progress: { processed: 3, total: 3 } });
  });

  it('two workers running in parallel process every item exactly once (SKIP LOCKED)', async () => {
    const { token, user } = await registerUser(ctx);
    const emails = Array.from({ length: 60 }, (_, i) => `person${i}@example.com`);
    await submit(token, emails);

    const calls = new Map<string, number>();
    const counting: Verifier = {
      verify: async (email) => {
        calls.set(email, (calls.get(email) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 5));
        return fakeResult(email);
      },
    };
    const other = createCtx({ WORKER_CONCURRENCY: '3' });
    extraPools.push(other);
    await warmPool(other.db, 6);
    await Promise.all([workerFor(ctx, counting).runUntilIdle(), workerFor(other, counting).runUntilIdle()]);

    expect(calls.size).toBe(60);
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
    expect(await usageCount()).toBe(60);
    expect(await credits(user.id)).toBe(40);
    expect((await itemRows()).every((r) => r.status === 'done' && r.attempts === 1)).toBe(true);
  });

  it('never exceeds the worker concurrency limit', async () => {
    const { token } = await registerUser(ctx);
    await submit(token, Array.from({ length: 15 }, (_, i) => `p${i}@example.com`));
    let active = 0;
    let peak = 0;
    const slow: Verifier = {
      verify: async (email) => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return fakeResult(email);
      },
    };
    await workerFor(ctx, slow).runUntilIdle();
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('retries failed items up to 3 attempts; a flaky item recovers, a broken one fails permanently', async () => {
    const { token, user } = await registerUser(ctx);
    const { jobId } = (await submit(token, ['flaky@example.com', 'broken@example.com', 'fine@example.com'])).body;
    const attempts = new Map<string, number>();
    const unreliable: Verifier = {
      verify: async (email) => {
        const n = (attempts.get(email) ?? 0) + 1;
        attempts.set(email, n);
        if (email.startsWith('broken') || (email.startsWith('flaky') && n < 3)) throw new Error(`boom #${n}`);
        return fakeResult(email);
      },
    };
    await workerFor(ctx, unreliable).runUntilIdle();

    expect(attempts.get('flaky@example.com')).toBe(3);
    expect(attempts.get('broken@example.com')).toBe(3); // capped at max attempts, not more
    const rows = Object.fromEntries((await itemRows()).map((r) => [r.email, r]));
    expect(rows['flaky@example.com']).toMatchObject({ status: 'done', attempts: 3 });
    expect(rows['broken@example.com']).toMatchObject({ status: 'failed', attempts: 3, error: 'boom #3' });

    const job = (await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(token))).body;
    expect(job).toMatchObject({ status: 'completed', counts: { deliverable: 2, failed: 1 } });
    expect(await credits(user.id)).toBe(98); // failed item is not billed

    const csv = (await request(ctx.app).get(`/v1/bulk/${jobId}/download`).set(bearer(token))).text;
    expect(csv).toContain('broken@example.com,failed,,,,,,,,,boom #3');
  });

  it('recovers items stranded by a crashed worker (expired lease)', async () => {
    const { token } = await registerUser(ctx);
    const { jobId } = (await submit(token, ['a@example.com', 'b@example.com'])).body;
    // simulate a worker that claimed an item and died
    await ctx.db.query("UPDATE bulk_items SET status = 'processing', attempts = 1, locked_until = NOW(3) - INTERVAL 5 SECOND WHERE email = 'a@example.com'");
    // a live lease must NOT be stolen
    await ctx.db.query("UPDATE bulk_items SET status = 'processing', attempts = 1, locked_until = NOW(3) + INTERVAL 60 SECOND WHERE email = 'b@example.com'");

    await workerFor(ctx).runUntilIdle();
    const rows = Object.fromEntries((await itemRows()).map((r) => [r.email, r]));
    expect(rows['a@example.com']).toMatchObject({ status: 'done', attempts: 2 });
    expect(rows['b@example.com']).toMatchObject({ status: 'processing', attempts: 1 });
    const job = (await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(token))).body;
    expect(job.progress.processed).toBe(1);
  });

  it('a worker that lost its lease cannot double-charge or overwrite the result', async () => {
    const { token, user } = await registerUser(ctx);
    await submit(token, ['slow@example.com']);
    const stolen: Verifier = {
      verify: async (email) => {
        // while this worker is "stuck", the lease expires and another claim bumps the attempt
        await ctx.db.query("UPDATE bulk_items SET attempts = attempts + 1 WHERE email = 'slow@example.com'");
        return fakeResult(email);
      },
    };
    await workerFor(ctx, stolen).runUntilIdle();
    expect(await usageCount()).toBe(0);
    expect(await credits(user.id)).toBe(100);
  });

  it('runs out of credits mid-job: paid items finish, the rest fail with insufficient_credits, job still completes', async () => {
    const { token, user } = await registerUser(ctx);
    const { jobId } = (await submit(token, ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'])).body;
    await ctx.db.query('UPDATE users SET credits = 2 WHERE id = ?', [user.id]); // spent elsewhere after queueing
    await workerFor(ctx, testVerifier()).runUntilIdle();
    const job = (await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(token))).body;
    expect(job).toMatchObject({ status: 'completed', counts: { deliverable: 2, failed: 2 } });
    expect(await credits(user.id)).toBe(0);
    expect((await itemRows()).filter((r) => r.error === 'insufficient_credits')).toHaveLength(2);
  });

  it('start()/stop() drains gracefully', async () => {
    const { token } = await registerUser(ctx);
    const { jobId } = (await submit(token, ['a@example.com', 'b@example.com'])).body;
    const worker = workerFor(ctx);
    const running = worker.start();
    for (let i = 0; i < 400; i++) {
      const s = (await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(token))).body.status;
      if (s === 'completed') break;
      await new Promise((r) => setTimeout(r, 30));
    }
    await worker.stop();
    await running;
    expect((await request(ctx.app).get(`/v1/bulk/${jobId}`).set(bearer(token))).body.status).toBe('completed');
  });
});

describe('DomainThrottle', () => {
  it('spaces work for the same domain but not across domains', async () => {
    const t = new DomainThrottle(40);
    const starts: Record<string, number[]> = { a: [], b: [] };
    const t0 = Date.now();
    await Promise.all([
      ...[0, 1, 2].map(() => t.run('a.com', async () => void starts.a!.push(Date.now() - t0))),
      t.run('b.com', async () => void starts.b!.push(Date.now() - t0)),
    ]);
    const a = starts.a!.sort((x, y) => x - y);
    expect(a[1]! - a[0]!).toBeGreaterThanOrEqual(30);
    expect(a[2]! - a[1]!).toBeGreaterThanOrEqual(30);
    // b.com is independent: it starts before a.com's throttled 3rd call (ordering, not wall-clock, so it holds under load)
    expect(starts.b![0]).toBeLessThan(a[2]!);
  });

  it('is a no-op when the gap is 0', async () => {
    const t = new DomainThrottle(0);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => t.run('a.com', async () => undefined)));
    expect(Date.now() - t0).toBeLessThan(1000); // with no gap configured nothing may sleep
  });
});

describe('csvCell', () => {
  it('quotes when needed and defuses spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1@x.com')).toBe("'+1@x.com");
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });
});
