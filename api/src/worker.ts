import { config } from './config';
import { createPool } from './db/pool';
import { logger } from './logger';
import { createDefaultVerifier } from './verifier/default';
import { createWorker } from './worker/runner';

// Separate entry point: `npm run worker`. Shares nothing with the API process except MySQL,
// so either can restart (or scale) independently and queued jobs survive both.
const db = createPool();
const worker = createWorker({ db, config, verifier: createDefaultVerifier(config), log: logger });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker draining in-flight items');
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  await worker.stop();
  await db.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.start().catch((err) => {
  logger.error({ err }, 'worker crashed');
  process.exit(1);
});
