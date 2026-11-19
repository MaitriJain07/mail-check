import type { RequestHandler } from 'express';
import type { Config } from '../config';
import type { Db } from '../db/pool';
import { Errors } from '../errors';
import { authenticateApiKey, isApiKeyFormat } from '../services/apiKeys';
import { getUserById, verifyToken } from '../services/users';

function extractToken(headers: { authorization?: string; 'x-api-key'?: string | string[] }): string | null {
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) return apiKey.trim();
  const auth = headers.authorization;
  if (auth && /^Bearer\s+\S+$/i.test(auth)) return auth.replace(/^Bearer\s+/i, '');
  return null;
}

/** Accepts either `X-API-Key: mc_live_...` / `Authorization: Bearer mc_live_...` or a dashboard JWT. */
export function authenticate(db: Db, config: Config): RequestHandler {
  return async (req, _res, next) => {
    const token = extractToken(req.headers);
    if (!token) throw Errors.unauthorized('Missing credentials. Send an API key in X-API-Key or a Bearer token.');

    if (isApiKeyFormat(token)) {
      const found = await authenticateApiKey(db, token);
      if (!found) throw Errors.unauthorized('Invalid or revoked API key');
      req.auth = { userId: found.userId, apiKeyId: found.apiKeyId, via: 'apikey' };
      return next();
    }

    const userId = verifyToken(config, token);
    if (!userId || !(await getUserById(db, userId))) throw Errors.unauthorized('Invalid or expired token');
    req.auth = { userId, apiKeyId: null, via: 'jwt' };
    next();
  };
}

/** Key management is dashboard-only: an API key must not be able to mint or revoke keys. */
export const requireJwt: RequestHandler = (req, _res, next) => {
  if (req.auth?.via !== 'jwt') throw Errors.forbidden('This endpoint requires a dashboard login token, not an API key');
  next();
};
