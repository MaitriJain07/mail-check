import { describe, expect, it, vi } from 'vitest';
import { createVerifier, type VerifierDeps } from '../../src/verifier';
import type { MxLookup } from '../../src/verifier/types';
import { FakeSmtpClient, reply, type Script } from '../helpers/fakeSmtp';

const goodMx: MxLookup = async () => ({
  status: 'ok',
  records: [
    { exchange: 'mx-primary.example.com', priority: 5 },
    { exchange: 'mx-backup.example.com', priority: 50 },
  ],
});

const rejectRandom: Script = { rcpt: (a) => (a.startsWith('random') ? reply(550) : reply(250)) };

function build(over: Partial<VerifierDeps> = {}, script: Script = {}) {
  const smtp = (over.smtpClient as FakeSmtpClient | undefined) ?? new FakeSmtpClient(script);
  const lookupMx = vi.fn(over.lookupMx ?? goodMx);
  const verifier = createVerifier({
    disposableDomains: new Set(['mailinator.com']),
    smtpEnabled: true,
    smtpTimeoutMs: 8000,
    heloDomain: 'me.test',
    mailFrom: 'v@me.test',
    randomLocal: () => 'random123',
    ...over,
    smtpClient: smtp,
    lookupMx,
  });
  return { verifier, smtp, lookupMx };
}

describe('verification pipeline', () => {
  it('deliverable: all checks pass, uses lowest-priority MX on port 25, QUITs without DATA', async () => {
    const { verifier, smtp } = build({}, rejectRandom);
    const r = await verifier.verify('  Jane@Example.com ');
    expect(r).toMatchObject({ email: 'jane@example.com', result: 'deliverable', score: 100 });
    expect(Object.values(r.checks).map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(smtp.connectCalls).toEqual([{ host: 'mx-primary.example.com', port: 25, timeoutMs: 8000 }]);
    expect(smtp.commands).toEqual([
      'EHLO me.test',
      'MAIL FROM:<v@me.test>',
      'RCPT TO:<jane@example.com>',
      'RCPT TO:<random123@example.com>',
      'QUIT',
    ]);
    expect(smtp.commands.some((c) => c.startsWith('DATA'))).toBe(false);
    expect(smtp.closed).toBe(true);
    expect(typeof r.durationMs).toBe('number');
  });

  it('short-circuits on bad syntax: nothing else runs', async () => {
    const { verifier, lookupMx, smtp } = build();
    const r = await verifier.verify('not-an-email');
    expect(r.result).toBe('undeliverable');
    expect(r.checks.syntax.status).toBe('fail');
    expect(r.checks.mx.status).toBe('skipped');
    expect(lookupMx).not.toHaveBeenCalled();
    expect(smtp.connectCalls).toHaveLength(0);
  });

  it('short-circuits on disposable domains (risky), before DNS', async () => {
    const { verifier, lookupMx } = build();
    const r = await verifier.verify('x@mailinator.com');
    expect(r).toMatchObject({ result: 'risky', reason: 'Disposable email domain' });
    expect(r.checks.disposable.status).toBe('fail');
    expect(r.checks.mx.status).toBe('skipped');
    expect(lookupMx).not.toHaveBeenCalled();
  });

  it('undeliverable when the domain has no MX', async () => {
    const { verifier, smtp } = build({ lookupMx: async () => ({ status: 'none' }) });
    const r = await verifier.verify('a@nomx.example');
    expect(r.result).toBe('undeliverable');
    expect(r.checks.mx.status).toBe('fail');
    expect(smtp.connectCalls).toHaveLength(0);
  });

  it('unknown (not an error) when DNS fails', async () => {
    const { verifier } = build({ lookupMx: async () => ({ status: 'error', message: 'timed out' }) });
    const r = await verifier.verify('a@example.com');
    expect(r.result).toBe('unknown');
    expect(r.reason).toContain('timed out');
    expect(r.checks.mx.status).toBe('unknown');
  });

  it('unknown with a reason when SMTP is disabled; SMTP never touched', async () => {
    const { verifier, smtp } = build({ smtpEnabled: false });
    const r = await verifier.verify('jane@example.com');
    expect(r.result).toBe('unknown');
    expect(r.reason).toMatch(/SMTP check disabled/);
    expect(r.checks.smtp.status).toBe('skipped');
    expect(r.checks.mx.status).toBe('pass');
    expect(smtp.connectCalls).toHaveLength(0);
    expect(r.score).toBeLessThanOrEqual(65);
  });

  it('unknown with a reason when the SMTP connection fails', async () => {
    const { verifier } = build({ smtpClient: new FakeSmtpClient({}, new Error('connect ETIMEDOUT')) });
    const r = await verifier.verify('jane@example.com');
    expect(r.result).toBe('unknown');
    expect(r.reason).toContain('SMTP connection failed');
    expect(r.checks.smtp.status).toBe('unknown');
  });

  it('undeliverable on 550', async () => {
    const { verifier } = build({}, { rcpt: reply(550, '5.1.1 user unknown') });
    const r = await verifier.verify('ghost@example.com');
    expect(r.result).toBe('undeliverable');
    expect(r.checks.smtp.status).toBe('fail');
    expect(r.checks.catchAll.status).toBe('skipped');
  });

  it('unknown on 4xx greylisting, and still QUITs', async () => {
    const { verifier, smtp } = build({}, { rcpt: reply(451, 'greylisted') });
    const r = await verifier.verify('jane@example.com');
    expect(r.result).toBe('unknown');
    expect(r.reason).toMatch(/greylist/i);
    expect(smtp.commands.at(-1)).toBe('QUIT');
  });

  it('risky on catch-all domains', async () => {
    const { verifier } = build({}, { rcpt: reply(250) });
    const r = await verifier.verify('jane@example.com');
    expect(r.result).toBe('risky');
    expect(r.checks.catchAll.status).toBe('fail');
    expect(r.score).toBeLessThanOrEqual(70);
  });

  it('role accounts are flagged and downgraded from deliverable to risky', async () => {
    const { verifier } = build({}, rejectRandom);
    const r = await verifier.verify('info@example.com');
    expect(r.checks.role.status).toBe('fail');
    expect(r.result).toBe('risky');
    expect(r.reason).toMatch(/role/i);
  });

  it('survives a session error mid-handshake as unknown', async () => {
    const smtpClient = new FakeSmtpClient();
    const orig = smtpClient.connect.bind(smtpClient);
    smtpClient.connect = async (...a) => {
      const c = await orig(...a);
      return {
        greeting: c.greeting,
        close: c.close,
        send: async (cmd: string) => {
          if (cmd.startsWith('MAIL')) throw new Error('socket reset');
          return c.send(cmd);
        },
      };
    };
    const { verifier } = build({ smtpClient });
    const r = await verifier.verify('jane@example.com');
    expect(r.result).toBe('unknown');
    expect(r.reason).toContain('socket reset');
  });
});
