import type { Config } from '../config';
import type { Db } from '../db/pool';
import type { Verifier } from '../verifier';
import { claimItems, completeItem, failItemPermanently, recoverStaleItems, retryOrFail, type ClaimedItem } from './queue';
import { DomainThrottle } from './throttle';

interface Logger {
  info: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
}

export interface Worker {
  /** Run until stop() is called. */
  start(): Promise<void>;
  /** Stop claiming, wait for in-flight items, resolve start(). */
  stop(): Promise<void>;
  /** Process everything currently due, then return (used by tests). */
  runUntilIdle(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createWorker(opts: { db: Db; config: Config; verifier: Verifier; log: Logger }): Worker {
  const { db, config, verifier, log } = opts;
  const throttle = new DomainThrottle(config.DOMAIN_THROTTLE_MS);
  const inflight = new Set<Promise<void>>();
  let running = false;
  let loop: Promise<void> | null = null;

  async function processItem(item: ClaimedItem): Promise<void> {
    if (item.attempts > config.BULK_MAX_ATTEMPTS) {
      // Claimed again after repeated crashes/lease expiries: stop retrying.
      return failItemPermanently(db, item, 'Exceeded maximum attempts');
    }
    const retry = { maxAttempts: config.BULK_MAX_ATTEMPTS, retryDelaySeconds: config.BULK_RETRY_DELAY_SECONDS };
    try {
      const domain = item.email.slice(item.email.lastIndexOf('@') + 1);
      const result = await throttle.run(domain, () => verifier.verify(item.email));
      await completeItem(db, item, result);
    } catch (err) {
      const outcome = await retryOrFail(db, item, (err as Error).message ?? 'Unknown error', retry);
      log.error({ err, itemId: item.id, attempt: item.attempts, outcome }, 'bulk item failed');
    }
  }

  /** Top up in-flight work to the concurrency limit. Returns how many items were claimed. */
  async function fill(): Promise<number> {
    const free = config.WORKER_CONCURRENCY - inflight.size;
    if (free <= 0) return 0;
    await recoverStaleItems(db);
    const items = await claimItems(db, free, config.WORKER_LOCK_SECONDS);
    for (const item of items) {
      const p: Promise<void> = processItem(item)
        .catch((err) => log.error({ err, itemId: item.id }, 'unrecoverable item error; lease will expire and retry'))
        .finally(() => inflight.delete(p));
      inflight.add(p);
    }
    return items.length;
  }

  async function mainLoop(): Promise<void> {
    while (running) {
      let claimed = 0;
      try {
        claimed = await fill();
      } catch (err) {
        log.error({ err }, 'claim failed');
      }
      if (claimed === 0) await sleep(config.WORKER_POLL_INTERVAL_MS);
      else if (inflight.size >= config.WORKER_CONCURRENCY) await Promise.race(inflight);
    }
  }

  return {
    start() {
      running = true;
      log.info({ concurrency: config.WORKER_CONCURRENCY, domainThrottleMs: config.DOMAIN_THROTTLE_MS }, 'worker started');
      loop = mainLoop();
      return loop;
    },
    async stop() {
      running = false;
      await loop;
      await Promise.allSettled([...inflight]);
    },
    async runUntilIdle() {
      for (;;) {
        const claimed = await fill();
        if (claimed === 0 && inflight.size === 0) return;
        await Promise.allSettled([...inflight]);
      }
    },
  };
}
