import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { createPool, type Db } from '../../src/db/pool';
import { createVerifier, type Verifier } from '../../src/verifier';
import type { MxLookup } from '../../src/verifier/types';
import { FakeSmtpClient, reply } from './fakeSmtp';

/** Mocked DNS: every domain has an MX except ones starting with "nomx". No network. */
export const fakeMx: MxLookup = async (domain) =>
  domain.startsWith('nomx')
    ? { status: 'none' }
    : { status: 'ok', records: [{ exchange: `mx.${domain}`, priority: 10 }] };

/** Mailbox "ghost" bounces, "greylist" gets a 4xx, random probes bounce, everything else exists. */
export function fakeSmtp(): FakeSmtpClient {
  return new FakeSmtpClient({
    rcpt: (addr) => {
      const local = addr.split('@')[0] ?? '';
      if (local.startsWith('mc-') || local === 'ghost') return reply(550, 'no such user');
      if (local === 'greylist') return reply(451, 'try again later');
      return reply(250);
    },
  });
}

export function testVerifier(opts: { smtpEnabled?: boolean } = {}): Verifier {
  return createVerifier({
    disposableDomains: new Set(['mailinator.com']),
    lookupMx: fakeMx,
    smtpClient: fakeSmtp(),
    smtpEnabled: opts.smtpEnabled ?? true,
    smtpTimeoutMs: 1000,
    heloDomain: 'test.local',
    mailFrom: 'verify@test.local',
  });
}

export interface TestCtx {
  db: Db;
  config: Config;
  app: Express;
  verifier: Verifier;
}

export function createCtx(env: Record<string, string> = {}, verifier: Verifier = testVerifier()): TestCtx {
  const config = loadConfig({ ...process.env, ...env });
  const db = createPool(config.DATABASE_URL, 20);
  const app = createApp({ db, config, verifier });
  return { db, config, app, verifier };
}

export async function resetDb(db: Db): Promise<void> {
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['bulk_items', 'bulk_jobs', 'usage_events', 'rate_limits', 'api_keys', 'users']) {
    await db.query(`TRUNCATE TABLE ${t}`);
  }
  await db.query('SET FOREIGN_KEY_CHECKS = 1');
}

let counter = 0;
export async function registerUser(ctx: TestCtx, email = `user${Date.now()}${counter++}@example.com`) {
  const res = await request(ctx.app).post('/v1/auth/register').send({ email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user as { id: number; email: string; credits: number } };
}

export async function createKey(ctx: TestCtx, token: string, name = 'test key') {
  const res = await request(ctx.app).post('/v1/keys').set('Authorization', `Bearer ${token}`).send({ name });
  if (res.status !== 201) throw new Error(`create key failed: ${res.status}`);
  return { key: res.body.key as string, id: res.body.apiKey.id as number };
}
