import dns from 'node:dns';
import type { MxLookup, MxLookupResult, MxRecord } from './types';

export type MxResolver = (domain: string) => Promise<MxRecord[]>;

export interface MxLookupOptions {
  resolver?: MxResolver;
  timeoutMs: number;
  ttlMs: number;
  now?: () => number;
}

const MAX_CACHE_ENTRIES = 10_000;
const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

const defaultResolver: MxResolver = (domain) => dns.promises.resolveMx(domain);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`DNS lookup timed out after ${ms}ms`), { code: 'ETIMEOUT' })), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * MX lookup with a timeout and an in-memory TTL cache per domain.
 * Definitive answers (records, or "no MX") are cached; transient errors are not.
 */
export function createMxLookup(opts: MxLookupOptions): MxLookup {
  const resolver = opts.resolver ?? defaultResolver;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { value: MxLookupResult; expires: number }>();

  return async (domain: string): Promise<MxLookupResult> => {
    const key = domain.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (hit) cache.delete(key);

    let value: MxLookupResult;
    try {
      const records = await withTimeout(resolver(key), opts.timeoutMs);
      // A single "." exchange is the RFC 7505 "null MX": domain accepts no mail.
      const usable = records
        .filter((r) => r.exchange && r.exchange !== '.')
        .sort((a, b) => a.priority - b.priority);
      value = usable.length > 0 ? { status: 'ok', records: usable } : { status: 'none' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && NOT_FOUND_CODES.has(code)) value = { status: 'none' };
      else return { status: 'error', message: (err as Error).message };
    }

    if (opts.ttlMs > 0) {
      // Bounded: attacker-chosen domains must not be able to grow memory without limit.
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(key, { value, expires: now() + opts.ttlMs });
    }
    return value;
  };
}
