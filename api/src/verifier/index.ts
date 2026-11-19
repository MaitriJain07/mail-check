import { detectCatchAll, randomLocalPart } from './catchAll';
import { isDisposable } from './disposable';
import { isRoleAccount } from './role';
import { computeScore } from './score';
import { probeRecipient, quit } from './smtp';
import { checkSyntax } from './syntax';
import type {
  CheckOutcome,
  MxLookup,
  SmtpClient,
  VerificationChecks,
  VerificationResult,
  VerificationResultKind,
} from './types';

export interface VerifierDeps {
  disposableDomains: ReadonlySet<string>;
  lookupMx: MxLookup;
  smtpClient: SmtpClient;
  smtpEnabled: boolean;
  smtpTimeoutMs: number;
  heloDomain: string;
  mailFrom: string;
  /** Injectable for deterministic tests. */
  randomLocal?: () => string;
  now?: () => number;
}

export interface Verifier {
  verify(email: string): Promise<VerificationResult>;
}

const skipped = (): CheckOutcome => ({ status: 'skipped' });

/**
 * Runs the six steps in order and stops at the first decisive failure.
 * Never throws for bad input or network trouble: those become verdicts.
 */
export function createVerifier(deps: VerifierDeps): Verifier {
  const now = deps.now ?? Date.now;
  const randomLocal = deps.randomLocal ?? randomLocalPart;

  async function verify(raw: string): Promise<VerificationResult> {
    const started = now();
    const checks: VerificationChecks = {
      syntax: skipped(),
      disposable: skipped(),
      mx: skipped(),
      role: skipped(),
      smtp: skipped(),
      catchAll: skipped(),
    };
    let email = String(raw ?? '').trim().toLowerCase();

    const done = (result: VerificationResultKind, reason: string): VerificationResult => ({
      email,
      result,
      reason,
      checks,
      score: computeScore(checks, result),
      durationMs: now() - started,
    });

    // 1. Syntax
    const syntax = checkSyntax(raw);
    email = syntax.email;
    if (!syntax.ok) {
      checks.syntax = { status: 'fail', detail: syntax.reason };
      return done('undeliverable', syntax.reason);
    }
    checks.syntax = { status: 'pass' };
    const { local, domain } = syntax;

    // 2. Disposable
    if (isDisposable(domain, deps.disposableDomains)) {
      checks.disposable = { status: 'fail', detail: `${domain} is a disposable email provider` };
      return done('risky', 'Disposable email domain');
    }
    checks.disposable = { status: 'pass' };

    // 3. MX
    const mx = await deps.lookupMx(domain);
    if (mx.status === 'none') {
      checks.mx = { status: 'fail', detail: 'No MX records' };
      return done('undeliverable', 'Domain has no MX records and cannot receive email');
    }
    if (mx.status === 'error') {
      checks.mx = { status: 'unknown', detail: mx.message };
      return done('unknown', `DNS lookup failed: ${mx.message}`);
    }
    const host = mx.records[0]!.exchange; // lowest preference value = primary MX
    checks.mx = { status: 'pass', detail: host };

    // 4. Role account (flagged, not terminal: the mailbox may still exist)
    const isRole = isRoleAccount(local);
    checks.role = isRole
      ? { status: 'fail', detail: `"${local}" is a shared role address` }
      : { status: 'pass' };

    // 5. SMTP handshake
    if (!deps.smtpEnabled) {
      checks.smtp = { status: 'skipped', detail: 'SMTP check disabled (SMTP_CHECK_ENABLED=false)' };
      return done(
        'unknown',
        isRole
          ? 'SMTP check disabled; role account'
          : 'SMTP check disabled; syntax, disposable and MX checks passed',
      );
    }

    let conn;
    try {
      conn = await deps.smtpClient.connect(host, 25, deps.smtpTimeoutMs);
    } catch (err) {
      const msg = (err as Error).message;
      checks.smtp = { status: 'unknown', detail: `Could not connect to ${host}:25: ${msg}` };
      return done('unknown', `SMTP connection failed: ${msg}`);
    }

    try {
      const probe = await probeRecipient(conn, {
        heloDomain: deps.heloDomain,
        mailFrom: deps.mailFrom,
        rcpt: email,
      });
      const detail = `${probe.code} ${probe.message}`.trim();

      if (probe.status === 'undeliverable') {
        checks.smtp = { status: 'fail', detail };
        return done('undeliverable', 'Mailbox does not exist (SMTP rejected the recipient)');
      }
      if (probe.status === 'unknown') {
        checks.smtp = { status: 'unknown', detail };
        const greylisted = probe.code >= 400 && probe.code < 500;
        return done(
          'unknown',
          greylisted
            ? `Temporary SMTP response (${probe.code}); server may be greylisting`
            : `Inconclusive SMTP response (${probe.code})`,
        );
      }
      checks.smtp = { status: 'pass', detail };

      // 6. Catch-all (same session, MAIL FROM already accepted)
      const catchAll = await detectCatchAll(conn, domain, randomLocal());
      if (catchAll.status === 'catch-all') {
        checks.catchAll = { status: 'fail', detail: 'Server accepted a random nonexistent mailbox' };
        return done('risky', 'Domain accepts all addresses (catch-all), so the mailbox cannot be confirmed');
      }
      checks.catchAll =
        catchAll.status === 'not-catch-all'
          ? { status: 'pass' }
          : { status: 'unknown', detail: `Inconclusive response (${catchAll.code})` };

      if (isRole) return done('risky', 'Role account (shared inbox) that accepts mail');
      return done('deliverable', 'Mailbox exists and accepts mail');
    } catch (err) {
      const msg = (err as Error).message;
      checks.smtp = { status: 'unknown', detail: msg };
      return done('unknown', `SMTP session failed: ${msg}`);
    } finally {
      await quit(conn);
    }
  }

  return { verify };
}

export * from './types';
