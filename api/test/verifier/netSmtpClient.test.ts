import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { NetSmtpClient } from '../../src/verifier/netSmtpClient';
import { probeRecipient, quit } from '../../src/verifier/smtp';

let server: net.Server | undefined;
afterEach(
  () =>
    new Promise<void>((r) => {
      if (!server) return r();
      server.close(() => r());
      server = undefined;
    }),
);

function listen(handler: (s: net.Socket) => void): Promise<number> {
  return new Promise((resolve) => {
    server = net.createServer(handler).listen(0, '127.0.0.1', () => resolve((server!.address() as net.AddressInfo).port));
  });
}

describe('NetSmtpClient (local fake server, no external network)', () => {
  it('speaks SMTP incl. multi-line EHLO replies', async () => {
    const seen: string[] = [];
    const port = await listen((s) => {
      s.write('220 test ESMTP\r\n');
      s.on('data', (d) => {
        for (const line of d.toString().split('\r\n').filter(Boolean)) {
          seen.push(line);
          if (line.startsWith('EHLO')) s.write('250-test\r\n250-SIZE 100\r\n250 8BITMIME\r\n');
          else if (line.startsWith('MAIL')) s.write('250 sender ok\r\n');
          else if (line.startsWith('RCPT')) s.write('550 5.1.1 no such user\r\n');
          else if (line === 'QUIT') s.end('221 bye\r\n');
        }
      });
    });
    const conn = await new NetSmtpClient().connect('127.0.0.1', port, 2000);
    expect(conn.greeting).toEqual({ code: 220, message: 'test ESMTP' });
    const out = await probeRecipient(conn, { heloDomain: 'me.test', mailFrom: 'v@me.test', rcpt: 'x@example.com' });
    expect(out).toMatchObject({ status: 'undeliverable', code: 550 });
    await quit(conn);
    expect(seen).toEqual(['EHLO me.test', 'MAIL FROM:<v@me.test>', 'RCPT TO:<x@example.com>', 'QUIT']);
  });

  it('times out when the server never sends a banner', async () => {
    const port = await listen(() => undefined);
    await expect(new NetSmtpClient().connect('127.0.0.1', port, 150)).rejects.toThrow();
  });

  it('rejects when nothing is listening', async () => {
    const port = await listen(() => undefined);
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await expect(new NetSmtpClient().connect('127.0.0.1', port, 1000)).rejects.toThrow();
  });
});
