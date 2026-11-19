import { createApp } from './app';
import { config } from './config';
import { createPool } from './db/pool';
import { logger } from './logger';
import { createDefaultVerifier } from './verifier/default';

const db = createPool();
const app = createApp({ db, config, verifier: createDefaultVerifier(config) });

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, smtpCheck: config.SMTP_CHECK_ENABLED },
    `MailCheck API listening on http://localhost:${config.PORT}`,
  );
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down: draining connections');
  // Hard stop if something hangs (e.g. a stuck keep-alive socket).
  const force = setTimeout(() => {
    logger.error('forced exit after 10s');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    await db.end().catch(() => undefined);
    logger.info('bye');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
