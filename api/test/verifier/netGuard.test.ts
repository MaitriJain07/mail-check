import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../../src/verifier/netGuard';
import { NetSmtpClient } from '../../src/verifier/netSmtpClient';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd12:3456::1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '142.250.80.5', '2607:f8b0:4004:c07::1a', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('NetSmtpClient SSRF guard', () => {
  it('refuses private IP literals and "localhost" by default, without opening a socket', async () => {
    const server = net.createServer((s) => s.end('220 should never be reached\r\n'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    let connections = 0;
    server.on('connection', () => connections++);
    const client = new NetSmtpClient();
    await expect(client.connect('127.0.0.1', port, 1000)).rejects.toThrow(/private or reserved/);
    await expect(client.connect('localhost', port, 1000)).rejects.toThrow(/private or reserved/);
    await expect(client.connect('169.254.169.254', 80, 1000)).rejects.toThrow(/private or reserved/);
    expect(connections).toBe(0);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
