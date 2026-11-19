import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { createPool, type ResultSetHeader } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { createApiKey } from '../services/apiKeys';
import { creditCost } from '../services/credits';
import type { CheckOutcome, VerificationResult, VerificationResultKind } from '../verifier';

export const DEMO_EMAIL = 'demo@mailcheck.dev';
export const DEMO_PASSWORD = 'demo-password-123';

// Tiny deterministic PRNG so every seed run produces the same demo data.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const SAMPLES: { email: string; result: VerificationResultKind; reason: string }[] = [
  { email: 'maria.lopez@acme.io', result: 'deliverable', reason: 'Mailbox exists and accepts mail' },
  { email: 'devon.park@northwind.com', result: 'deliverable', reason: 'Mailbox exists and accepts mail' },
  { email: 'priya@lumen.studio', result: 'deliverable', reason: 'Mailbox exists and accepts mail' },
  { email: 'tom.becker@globex.de', result: 'deliverable', reason: 'Mailbox exists and accepts mail' },
  { email: 'ghost.user@acme.io', result: 'undeliverable', reason: 'Mailbox does not exist (SMTP rejected the recipient)' },
  { email: 'someone@no-such-domain-42.com', result: 'undeliverable', reason: 'Domain has no MX records and cannot receive email' },
  { email: 'not-an-email', result: 'undeliverable', reason: 'Email is missing "@"' },
  { email: 'info@northwind.com', result: 'risky', reason: 'Role account (shared inbox) that accepts mail' },
  { email: 'trial123@mailinator.com', result: 'risky', reason: 'Disposable email domain' },
  { email: 'anyone@catchall.example', result: 'risky', reason: 'Domain accepts all addresses (catch-all), so the mailbox cannot be confirmed' },
  { email: 'sam@greylisting.example', result: 'unknown', reason: 'Temporary SMTP response (451); server may be greylisting' },
];

const pass = (detail?: string): CheckOutcome => (detail ? { status: 'pass', detail } : { status: 'pass' });
const skipped = (): CheckOutcome => ({ status: 'skipped' });

function resultFor(s: (typeof SAMPLES)[number]): VerificationResult {
  const checks: VerificationResult['checks'] = {
    syntax: pass(), disposable: pass(), mx: pass('mx.example.com'), role: pass(), smtp: pass('250 OK'), catchAll: pass(),
  };
  let score = 100;
  if (s.email === 'not-an-email') {
    Object.assign(checks, { syntax: { status: 'fail', detail: s.reason }, disposable: skipped(), mx: skipped(), role: skipped(), smtp: skipped(), catchAll: skipped() });
    score = 0;
  } else if (s.email.includes('no-such-domain')) {
    Object.assign(checks, { mx: { status: 'fail', detail: 'No MX records' }, role: skipped(), smtp: skipped(), catchAll: skipped() });
    score = 10;
  } else if (s.email.includes('mailinator')) {
    Object.assign(checks, { disposable: { status: 'fail' }, mx: skipped(), role: skipped(), smtp: skipped(), catchAll: skipped() });
    score = 20;
  } else if (s.email.startsWith('ghost')) {
    Object.assign(checks, { smtp: { status: 'fail', detail: '550 5.1.1 user unknown' }, catchAll: skipped() });
    score = 10;
  } else if (s.email.startsWith('info@')) {
    Object.assign(checks, { role: { status: 'fail' } });
    score = 70;
  } else if (s.email.includes('catchall')) {
    Object.assign(checks, { catchAll: { status: 'fail' } });
    score = 70;
  } else if (s.result === 'unknown') {
    Object.assign(checks, { smtp: { status: 'unknown', detail: '451 try again later' }, catchAll: skipped() });
    score = 55;
  }
  return { email: s.email, result: s.result, reason: s.reason, checks, score, durationMs: 120, };
}

async function main(): Promise<void> {
  await runMigrations(config.DATABASE_URL);
  const db = createPool();
  const rand = rng(42);

  // Idempotent: rebuild the demo account from scratch (FKs cascade to keys, usage, jobs).
  await db.query('DELETE FROM users WHERE email = ?', [DEMO_EMAIL]);
  const [u] = await db.query<ResultSetHeader>('INSERT INTO users (email, password_hash, credits) VALUES (?, ?, ?)', [
    DEMO_EMAIL,
    await bcrypt.hash(DEMO_PASSWORD, config.BCRYPT_ROUNDS),
    config.FREE_CREDITS,
  ]);
  const userId = u.insertId;

  const live = await createApiKey(db, userId, 'Production backend');
  const staging = await createApiKey(db, userId, 'Staging');
  const old = await createApiKey(db, userId, 'Old key (revoked)');
  await db.query('UPDATE api_keys SET revoked_at = NOW(3) WHERE id = ?', [old.info.id]);

  // ~45 verifications spread over the last 7 days, newest days busiest.
  let spent = 0;
  const rows: unknown[][] = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const perDay = 2 + Math.floor(rand() * 4) + (daysAgo < 3 ? 4 : 0);
    for (let i = 0; i < perDay; i++) {
      const s = SAMPLES[Math.floor(rand() * SAMPLES.length)]!;
      const cost = creditCost(s.result);
      spent += cost;
      const at = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(rand() * 40_000_000));
      rows.push([userId, rand() > 0.3 ? live.info.id : staging.info.id, s.email, s.result, cost, at]);
    }
  }
  await db.query('INSERT INTO usage_events (user_id, api_key_id, email, result, credits_used, created_at) VALUES ?', [rows]);

  // One finished bulk job so the CSV download has something to show.
  const jobId = randomUUID();
  const items = SAMPLES.map(resultFor);
  const counts = { deliverable: 0, undeliverable: 0, risky: 0, unknown: 0 };
  for (const r of items) counts[r.result]++;
  await db.query(
    `INSERT INTO bulk_jobs (id, user_id, api_key_id, status, total, processed, deliverable, undeliverable, risky, unknown_count, finished_at)
     VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, NOW(3))`,
    [jobId, userId, live.info.id, items.length, items.length, counts.deliverable, counts.undeliverable, counts.risky, counts.unknown],
  );
  await db.query("INSERT INTO bulk_items (job_id, email, status, attempts, result) VALUES ?", [
    items.map((r) => [jobId, r.email, 'done', 1, JSON.stringify(r)]),
  ]);

  await db.query('UPDATE users SET credits = ? WHERE id = ?', [Math.max(0, config.FREE_CREDITS - spent), userId]);
  await db.end();

  console.log('\nSeeded demo data\n');
  console.log(`  Login     ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  API key   ${live.key}   (shown only now)`);
  console.log(`  Credits   ${Math.max(0, config.FREE_CREDITS - spent)} left, ${rows.length} verifications, 1 bulk job (${jobId})\n`);
}

main().catch((err) => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});
