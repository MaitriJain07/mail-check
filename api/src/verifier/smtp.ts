import type { SmtpConnection, SmtpReply } from './types';

export interface ProbeOptions {
  heloDomain: string;
  mailFrom: string;
  rcpt: string;
}

export type ProbeOutcome =
  | { status: 'deliverable'; code: number; message: string }
  | { status: 'undeliverable'; code: number; message: string }
  | { status: 'unknown'; code: number; message: string };

/** 550/551/553 mean "this mailbox does not exist / is not allowed". */
const HARD_BOUNCE = new Set([550, 551, 553]);

export function classifyRcpt(reply: SmtpReply): ProbeOutcome['status'] {
  if (reply.code === 250 || reply.code === 251) return 'deliverable';
  if (HARD_BOUNCE.has(reply.code)) return 'undeliverable';
  // 4xx (greylisting, throttling), 552/554 (policy blocks) and anything odd: cannot tell.
  return 'unknown';
}

const outcome = (status: ProbeOutcome['status'], r: SmtpReply): ProbeOutcome => ({
  status,
  code: r.code,
  message: r.message,
});

/** Open a transaction on an already-connected session: EHLO, MAIL FROM, RCPT TO. */
export async function probeRecipient(conn: SmtpConnection, opts: ProbeOptions): Promise<ProbeOutcome> {
  if (conn.greeting.code !== 220) return outcome('unknown', conn.greeting);

  let hello = await conn.send(`EHLO ${opts.heloDomain}`);
  if (hello.code !== 250) hello = await conn.send(`HELO ${opts.heloDomain}`);
  if (hello.code !== 250) return outcome('unknown', hello);

  const from = await conn.send(`MAIL FROM:<${opts.mailFrom}>`);
  if (from.code !== 250) return outcome('unknown', from);

  const rcpt = await conn.send(`RCPT TO:<${opts.rcpt}>`);
  return outcome(classifyRcpt(rcpt), rcpt);
}

/** Politely end the session without sending DATA. Never throws. */
export async function quit(conn: SmtpConnection): Promise<void> {
  try {
    await conn.send('QUIT');
  } catch {
    /* ignore: we are leaving anyway */
  } finally {
    conn.close();
  }
}
