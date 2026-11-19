import type { Request, RequestHandler } from 'express';
import { Errors } from '../errors';
import type { RateLimiter } from '../services/rateLimiter';

interface Options {
  limiter: RateLimiter;
  limit: number;
  windowSeconds: number;
  bucket: (req: Request) => string;
}

/** Sets X-RateLimit-* on every response; answers 429 + Retry-After once the window is spent. */
export function rateLimit({ limiter, limit, windowSeconds, bucket }: Options): RequestHandler {
  return async (req, res, next) => {
    const r = await limiter.hit(bucket(req), limit, windowSeconds);
    const headers = {
      'X-RateLimit-Limit': String(r.limit),
      'X-RateLimit-Remaining': String(r.remaining),
      'X-RateLimit-Reset': String(r.resetAt),
    };
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    if (!r.allowed) throw Errors.tooMany(r.retryAfter, headers);
    next();
  };
}

/** Per API key; dashboard (JWT) callers are limited per user instead. */
export const bucketForAuth = (req: Request): string =>
  req.auth?.apiKeyId ? `key:${req.auth.apiKeyId}` : `user:${req.auth?.userId ?? 0}`;

export const bucketForIp = (prefix: string) => (req: Request): string => `${prefix}:${req.ip ?? 'unknown'}`;
