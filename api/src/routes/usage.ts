import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../http/types';
import { parse } from '../http/validate';
import { getUsage } from '../services/usage';

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export function usageRoutes(deps: AppDeps, authenticate: RequestHandler): Router {
  const r = Router();
  r.get('/', authenticate, async (req, res) => {
    const { page, pageSize } = parse(query, req.query);
    res.json(await getUsage(deps.db, req.auth!.userId, page, pageSize));
  });
  return r;
}
