import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import type { AppDeps } from '../http/types';
import { parse } from '../http/validate';
import { chargeCredits, getCredits } from '../services/credits';

const emailField = z.string().min(1, 'email is required').max(512);
const bodySchema = z.object({ email: emailField });
const querySchema = z.object({ email: emailField });

export function verifyRoutes(deps: AppDeps, authenticate: RequestHandler, limit: RequestHandler): Router {
  const r = Router();

  async function verifyAndCharge(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], email: string) {
    const { userId, apiKeyId } = req.auth!;
    // Cheap pre-check so out-of-credit users do not cost us DNS/SMTP work.
    if ((await getCredits(deps.db, userId)) <= 0) throw Errors.paymentRequired();
    const result = await deps.verifier.verify(email);
    const { remaining } = await chargeCredits(deps.db, { userId, apiKeyId, email: result.email, result: result.result });
    res.setHeader('X-Credits-Remaining', String(remaining));
    res.json(result);
  }

  r.post('/verify', authenticate, limit, (req, res) => verifyAndCharge(req, res, parse(bodySchema, req.body).email));
  r.get('/verify', authenticate, limit, (req, res) => verifyAndCharge(req, res, parse(querySchema, req.query).email));

  return r;
}

/** Public, IP-limited endpoint behind the landing-page "try it" box. Free: no credits, no usage rows. */
export function demoRoutes(deps: AppDeps, limit: RequestHandler): Router {
  const r = Router();
  r.post('/verify', limit, async (req, res) => {
    const { email } = parse(bodySchema, req.body);
    res.json(await deps.verifier.verify(email));
  });
  return r;
}
