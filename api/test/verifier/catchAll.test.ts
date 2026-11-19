import { describe, expect, it } from 'vitest';
import { detectCatchAll, randomLocalPart } from '../../src/verifier/catchAll';
import { FakeSmtpClient, reply } from '../helpers/fakeSmtp';

async function run(rcpt: ReturnType<typeof reply>) {
  const client = new FakeSmtpClient({ rcpt });
  const conn = await client.connect('mx', 25, 1);
  return { out: await detectCatchAll(conn, 'example.com', 'zzz-random'), client };
}

describe('detectCatchAll', () => {
  it('flags catch-all when a random mailbox is accepted', async () => {
    const { out, client } = await run(reply(250));
    expect(out.status).toBe('catch-all');
    expect(client.commands).toEqual(['RCPT TO:<zzz-random@example.com>']);
  });
  it('not catch-all when a random mailbox is rejected', async () => {
    expect((await run(reply(550))).out.status).toBe('not-catch-all');
  });
  it('unknown on 4xx', async () => {
    expect((await run(reply(450))).out.status).toBe('unknown');
  });
  it('generates distinct random local parts', () => {
    expect(randomLocalPart()).not.toBe(randomLocalPart());
    expect(randomLocalPart()).toMatch(/^mc-[0-9a-f]{16}$/);
  });
});
