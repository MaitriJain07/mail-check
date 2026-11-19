import path from 'node:path';
import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '.env'));
} catch {
  /* CI sets variables directly */
}

// Shared with globalSetup (runs in this same process) so migrations hit the test DB.
const testDb =
  process.env.TEST_DATABASE_URL ?? 'mysql://mailcheck:mailcheck@localhost:3307/mailcheck_test';
process.env.TEST_DATABASE_URL = testDb;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      JWT_SECRET: 'test-secret-test-secret-test-secret',
      BCRYPT_ROUNDS: '4',
      SMTP_CHECK_ENABLED: 'false',
      FREE_CREDITS: '100',
      RATE_LIMIT_MAX: '60',
      DOMAIN_THROTTLE_MS: '0',
      WORKER_POLL_INTERVAL_MS: '20',
    },
    // Integration tests share one MySQL database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
