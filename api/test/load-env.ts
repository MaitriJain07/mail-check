import path from 'node:path';

/** Environment for the test run: points at the dedicated test database. */
export function loadTestEnv(): Record<string, string> {
  try {
    process.loadEnvFile(path.resolve(__dirname, '..', '..', '.env'));
  } catch {
    /* CI sets variables directly */
  }
  return {
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ?? 'mysql://mailcheck:mailcheck@localhost:3307/mailcheck_test',
    JWT_SECRET: 'test-secret-test-secret-test-secret',
    BCRYPT_ROUNDS: '4',
    SMTP_CHECK_ENABLED: 'false',
    FREE_CREDITS: '100',
    RATE_LIMIT_MAX: '60',
    DOMAIN_THROTTLE_MS: '0',
    WORKER_POLL_INTERVAL_MS: '20',
  };
}
