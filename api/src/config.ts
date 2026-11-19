import path from 'node:path';
import { z } from 'zod';

// Load the repo-root .env (no-op if missing; real env vars always win).
try {
  process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env'));
} catch {
  /* no .env file, rely on process env */
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  // Number of reverse proxies in front of the API (Render/Railway = 1), so req.ip is the real client.
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(0),
  DATABASE_URL: z.string().default('mysql://mailcheck:mailcheck@localhost:3307/mailcheck'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  FREE_CREDITS: z.coerce.number().int().nonnegative().default(100),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  DEMO_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  SMTP_CHECK_ENABLED: bool.default(false),
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  SMTP_HELO_DOMAIN: z.string().default('mailcheck.local'),
  SMTP_MAIL_FROM: z.string().default('verify@mailcheck.local'),
  DNS_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MX_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),
  BULK_MAX_ROWS: z.coerce.number().int().positive().default(1000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  DOMAIN_THROTTLE_MS: z.coerce.number().int().nonnegative().default(250),
  WORKER_LOCK_SECONDS: z.coerce.number().int().positive().default(60),
  BULK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config: Config = loadConfig();
