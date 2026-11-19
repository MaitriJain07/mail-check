import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import type { AppDeps } from '../http/types';
import { idParam, parse } from '../http/validate';
import { requireJwt } from '../middleware/auth';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/apiKeys';

const createBody = z.object({ name: z.string().trim().min(1, 'Name is required').max(100) });

export function keyRoutes(deps: AppDeps, authenticate: RequestHandler): Router {
  const r = Router();
  r.use(authenticate, requireJwt);

  r.post('/', async (req, res) => {
    const { name } = parse(createBody, req.body);
    const { key, info } = await createApiKey(deps.db, req.auth!.userId, name);
    // The only time the full key is ever returned.
    res.status(201).json({ key, apiKey: info });
  });

  r.get('/', async (req, res) => {
    res.json({ keys: await listApiKeys(deps.db, req.auth!.userId) });
  });

  r.delete('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    if (!(await revokeApiKey(deps.db, req.auth!.userId, id))) throw Errors.notFound('API key not found or already revoked');
    res.status(204).end();
  });

  return r;
}
