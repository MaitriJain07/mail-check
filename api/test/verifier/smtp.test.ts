import { describe, expect, it } from 'vitest';
import { classifyRcpt, probeRecipient, quit } from '../../src/verifier/smtp';
import { FakeSmtpClient, reply, type Script } from '../helpers/fakeSmtp';

const opts = { heloDomain: 'me.test', mailFrom: 'v@me.test', rcpt: 'jane@example.com' };

async function probe(script: Script) {
  const client = new FakeSmtpClient(script);
  const conn = await client.connect('mx.example.com', 25, 8000);
  return { out: await probeRecipient(conn, opts), client };
}

describe('classifyRcpt', () => {
  it.each([
    [250, 'deliverable'],
    [251, 'deliverable'],
    [550, 'undeliverable'],
    [551, 'undeliverable'],
    [553, 'undeliverable'],
    [450, 'unknown'],
    [451, 'unknown'],
    [452, 'unknown'],
    [552, 'unknown'],
    [554, 'unknown'],
  ])('%i -> %s', (code, expected) => expect(classifyRcpt(reply(code))).toBe(expected));
});

describe('probeRecipient', () => {
  it('runs EHLO, MAIL FROM, RCPT TO in order and never sends DATA', async () => {
    const { out, client } = await probe({});
    expect(out.status).toBe('deliverable');
    expect(client.commands).toEqual(['EHLO me.test', 'MAIL FROM:<v@me.test>', 'RCPT TO:<jane@example.com>']);
  });

  it('maps 550 to undeliverable', async () => {
    expect((await probe({ rcpt: reply(550, 'no such user') })).out).toMatchObject({ status: 'undeliverable', code: 550 });
  });

  it('maps 4xx to unknown (greylisting)', async () => {
    expect((await probe({ rcpt: reply(451, 'try later') })).out).toMatchObject({ status: 'unknown', code: 451 });
  });

  it('is unknown when the banner is not 220', async () => {
    const { out, client } = await probe({ greeting: reply(554, 'no service') });
    expect(out.status).toBe('unknown');
    expect(client.commands).toEqual([]);
  });

  it('falls back to HELO when EHLO is refused', async () => {
    const client = new FakeSmtpClient({});
    const conn = await client.connect('mx', 25, 1);
    const wrapped = {
      greeting: conn.greeting,
      close: conn.close,
      send: async (c: string) => (c.startsWith('EHLO') ? (client.commands.push(c), reply(502, 'not implemented')) : conn.send(c)),
    };
    const out = await probeRecipient(wrapped, opts);
    expect(out.status).toBe('deliverable');
    expect(client.commands.slice(0, 2)).toEqual(['EHLO me.test', 'HELO me.test']);
  });

  it('is unknown when MAIL FROM is rejected', async () => {
    expect((await probe({ mailFrom: reply(530, 'auth required') })).out.status).toBe('unknown');
  });
});

describe('quit', () => {
  it('sends QUIT and closes, even if QUIT throws', async () => {
    const client = new FakeSmtpClient();
    const conn = await client.connect('mx', 25, 1);
    await quit(conn);
    expect(client.commands).toEqual(['QUIT']);
    expect(client.closed).toBe(true);

    let closed = false;
    await quit({
      greeting: reply(220),
      send: async () => {
        throw new Error('boom');
      },
      close: () => {
        closed = true;
      },
    });
    expect(closed).toBe(true);
  });
});
