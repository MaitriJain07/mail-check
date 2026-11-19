import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './test/load-env';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: loadTestEnv(),
    // Integration tests share one MySQL database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
