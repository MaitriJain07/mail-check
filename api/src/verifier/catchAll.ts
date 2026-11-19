import { randomBytes } from 'node:crypto';
import { classifyRcpt } from './smtp';
import type { SmtpConnection } from './types';

export type CatchAllOutcome =
  | { status: 'catch-all'; code: number }
  | { status: 'not-catch-all'; code: number }
  | { status: 'unknown'; code: number };

export function randomLocalPart(): string {
  return `mc-${randomBytes(8).toString('hex')}`;
}

/**
 * Must run on a session where MAIL FROM was already accepted (see probeRecipient).
 * Asks the server to accept a mailbox that cannot exist: if it does, every address
 * "passes", so a 250 for the real address tells us nothing.
 */
export async function detectCatchAll(
  conn: SmtpConnection,
  domain: string,
  local: string = randomLocalPart(),
): Promise<CatchAllOutcome> {
  const reply = await conn.send(`RCPT TO:<${local}@${domain}>`);
  const kind = classifyRcpt(reply);
  if (kind === 'deliverable') return { status: 'catch-all', code: reply.code };
  if (kind === 'undeliverable') return { status: 'not-catch-all', code: reply.code };
  return { status: 'unknown', code: reply.code };
}
