import { Router } from 'express';
import { z } from 'zod';
import type { RequestHandler } from 'express';
import { parse } from '../http/validate';
import type { AppDeps } from '../http/types';
import { loginUser, registerUser, signToken } from '../services/users';
import { getUserById } from '../services/users';
import { Errors } from '../errors';

const credentials = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254).pipe(z.email()),
  // bcrypt only reads the first 72 bytes, so longer passwords would silently be truncated.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

export function authRoutes(deps: AppDeps, authenticate: RequestHandler, limit: RequestHandler): Router {
  const r = Router();
  const view = (u: { id: number; email: string; credits: number }) => ({ id: u.id, email: u.email, credits: u.credits });

  r.post('/register', limit, async (req, res) => {
    const { email, password } = parse(credentials, req.body);
    const user = await registerUser(deps.db, deps.config, email, password);
    res.status(201).json({ token: signToken(deps.config, user.id), user: view(user) });
  });

  r.post('/login', limit, async (req, res) => {
    const { email, password } = parse(credentials.pick({ email: true }).extend({ password: z.string().min(1).max(200) }), req.body);
    const user = await loginUser(deps.db, email, password);
    res.json({ token: signToken(deps.config, user.id), user: view(user) });
  });

  r.get('/me', authenticate, async (req, res) => {
    const user = await getUserById(deps.db, req.auth!.userId);
    if (!user) throw Errors.unauthorized();
    res.json({ user: view(user) });
  });

  return r;
}
