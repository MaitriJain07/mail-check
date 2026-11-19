import { loadTestEnv } from './load-env';
import { runMigrations } from '../src/db/migrate';

export default async function setup(): Promise<void> {
  const env = loadTestEnv();
  await runMigrations(env.DATABASE_URL as string);
}
