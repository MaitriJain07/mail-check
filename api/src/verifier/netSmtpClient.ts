import dns from 'node:dns';
import net from 'node:net';
import { isPrivateAddress } from './netGuard';
import type { SmtpClient, SmtpConnection, SmtpReply } from './types';

/**
 * Minimal SMTP client over `net`. One overall deadline (timeoutMs) covers connect
 * plus every command, so a tarpitting server can never hold a verification open.
 */
class NetSmtpConnection implements SmtpConnection {
  greeting: SmtpReply = { code: 0, message: '' };
  private buffer = '';
  private lines: string[] = [];
  private waiter: { resolve: (r: SmtpReply) => void; reject: (e: Error) => void } | null = null;
  private error: Error | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        this.lines.push(this.buffer.slice(0, idx).replace(/\r$/, ''));
        this.buffer = this.buffer.slice(idx + 1);
      }
      this.flush();
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('Connection closed by server')));
  }

  private fail(err: Error): void {
    this.error ??= err;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.reject(this.error);
    }
  }

  /** Reply is complete at the first line shaped "NNN text" (a "-" after the code means more follow). */
  private flush(): void {
    if (!this.waiter) return;
    const end = this.lines.findIndex((l) => /^\d{3}(?: |$)/.test(l));
    if (end === -1) return;
    const block = this.lines.splice(0, end + 1);
    const w = this.waiter;
    this.waiter = null;
    w.resolve({
      code: Number.parseInt(block[end]!.slice(0, 3), 10),
      message: block.map((l) => l.slice(4)).join('\n'),
    });
  }

  readReply(): Promise<SmtpReply> {
    if (this.error && this.lines.length === 0) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.flush();
    });
  }

  send(command: string): Promise<SmtpReply> {
    if (this.error) return Promise.reject(this.error);
    const reply = this.readReply();
    this.socket.write(`${command}\r\n`);
    return reply;
  }

  close(): void {
    this.socket.destroy();
  }
}

export interface NetSmtpClientOptions {
  /** Tests talk to a fake server on 127.0.0.1; production must leave this false. */
  allowPrivateAddresses?: boolean;
}

export class NetSmtpClient implements SmtpClient {
  constructor(private readonly options: NetSmtpClientOptions = {}) {}

  /** DNS lookup that refuses private targets, so a hostile MX record cannot aim us at internal services. */
  private guardedLookup: net.LookupFunction = (hostname, opts, callback) => {
    dns.lookup(hostname, opts, (err, address, family) => {
      if (err) return callback(err, address as never, family as never);
      const list = Array.isArray(address) ? address.map((a) => a.address) : [address as string];
      if (list.some(isPrivateAddress)) {
        return callback(Object.assign(new Error('Refusing to connect to a private or reserved address'), { code: 'EBLOCKED' }), '', 4);
      }
      callback(null, address as never, family as never);
    });
  };

  connect(host: string, port: number, timeoutMs: number): Promise<SmtpConnection> {
    return new Promise((resolve, reject) => {
      // IP literals skip DNS entirely, so they are checked directly.
      if (!this.options.allowPrivateAddresses && net.isIP(host) && isPrivateAddress(host)) {
        return reject(Object.assign(new Error('Refusing to connect to a private or reserved address'), { code: 'EBLOCKED' }));
      }
      const socket = net.createConnection({ host, port, ...(this.options.allowPrivateAddresses ? {} : { lookup: this.guardedLookup }) });
      const deadline = setTimeout(() => {
        socket.destroy(new Error(`SMTP timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.once('close', () => clearTimeout(deadline));

      const conn = new NetSmtpConnection(socket);
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.off('error', reject);
        conn
          .readReply()
          .then((greeting) => {
            conn.greeting = greeting;
            resolve(conn);
          })
          .catch((err: Error) => {
            socket.destroy();
            reject(err);
          });
      });
    });
  }
}
