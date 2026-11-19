import type { SmtpClient, SmtpConnection, SmtpReply } from '../../src/verifier/types';

export type Script = Partial<{
  greeting: SmtpReply;
  ehlo: SmtpReply;
  mailFrom: SmtpReply;
  /** Reply for RCPT TO; may be a function of the address. */
  rcpt: SmtpReply | ((addr: string) => SmtpReply);
}>;

const ok = (code: number, message = 'ok'): SmtpReply => ({ code, message });

/** Scripted SMTP server stand-in. Records every command it receives. */
export class FakeSmtpClient implements SmtpClient {
  commands: string[] = [];
  connectCalls: { host: string; port: number; timeoutMs: number }[] = [];
  closed = false;

  constructor(
    private readonly script: Script = {},
    private readonly connectError?: Error,
  ) {}

  async connect(host: string, port: number, timeoutMs: number): Promise<SmtpConnection> {
    this.connectCalls.push({ host, port, timeoutMs });
    if (this.connectError) throw this.connectError;
    const s = this.script;
    return {
      greeting: s.greeting ?? ok(220, 'fake ESMTP'),
      send: async (command: string) => {
        this.commands.push(command);
        if (command.startsWith('EHLO') || command.startsWith('HELO')) return s.ehlo ?? ok(250);
        if (command.startsWith('MAIL FROM')) return s.mailFrom ?? ok(250);
        if (command.startsWith('RCPT TO')) {
          const addr = /<(.*)>/.exec(command)![1]!;
          const r = s.rcpt ?? ok(250);
          return typeof r === 'function' ? r(addr) : r;
        }
        if (command === 'QUIT') return ok(221, 'bye');
        return ok(500, 'unknown command');
      },
      close: () => {
        this.closed = true;
      },
    };
  }
}

export const reply = ok;
