import { describe, expect, it, vi } from 'vitest';
import { createMxLookup } from '../../src/verifier/mx';

const records = [
  { exchange: 'mx2.example.com', priority: 20 },
  { exchange: 'mx1.example.com', priority: 10 },
];

describe('createMxLookup', () => {
  it('returns records sorted by priority', async () => {
    const lookup = createMxLookup({ resolver: async () => records, timeoutMs: 100, ttlMs: 1000 });
    const r = await lookup('example.com');
    expect(r.status === 'ok' && r.records.map((x) => x.exchange)).toEqual(['mx1.example.com', 'mx2.example.com']);
  });

  it('treats ENOTFOUND / ENODATA as "none"', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      const lookup = createMxLookup({
        resolver: async () => {
          throw Object.assign(new Error(code), { code });
        },
        timeoutMs: 100,
        ttlMs: 1000,
      });
      expect(await lookup('nope.example')).toEqual({ status: 'none' });
    }
  });

  it('treats a null MX (".") as none', async () => {
    const lookup = createMxLookup({ resolver: async () => [{ exchange: '.', priority: 0 }], timeoutMs: 100, ttlMs: 1000 });
    expect(await lookup('example.com')).toEqual({ status: 'none' });
  });

  it('reports other errors and does not cache them', async () => {
    const resolver = vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
    const lookup = createMxLookup({ resolver, timeoutMs: 100, ttlMs: 1000 });
    expect(await lookup('example.com')).toEqual({ status: 'error', message: 'refused' });
    await lookup('example.com');
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('times out slow resolvers', async () => {
    const lookup = createMxLookup({ resolver: () => new Promise(() => undefined), timeoutMs: 20, ttlMs: 1000 });
    const r = await lookup('slow.example');
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/timed out/);
  });

  it('caches per domain until the TTL expires', async () => {
    let t = 1000;
    const resolver = vi.fn().mockResolvedValue(records);
    const lookup = createMxLookup({ resolver, timeoutMs: 100, ttlMs: 500, now: () => t });
    await lookup('a.com');
    await lookup('A.com');
    expect(resolver).toHaveBeenCalledTimes(1);
    await lookup('b.com');
    expect(resolver).toHaveBeenCalledTimes(2);
    t += 501;
    await lookup('a.com');
    expect(resolver).toHaveBeenCalledTimes(3);
  });

  it('caches negative answers too', async () => {
    const resolver = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOTFOUND' }));
    const lookup = createMxLookup({ resolver, timeoutMs: 100, ttlMs: 1000 });
    await lookup('gone.example');
    await lookup('gone.example');
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
