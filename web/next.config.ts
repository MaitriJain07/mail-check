import path from 'node:path';
import type { NextConfig } from 'next';

// One .env at the repo root serves both api and web (NEXT_PUBLIC_API_URL lives there).
try {
  process.loadEnvFile(path.resolve(process.cwd(), '..', '.env'));
} catch {
  /* no root .env (e.g. on Vercel): rely on real environment variables */
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
