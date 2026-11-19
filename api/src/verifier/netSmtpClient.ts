import net from 'node:net';
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

export class NetSmtpClient implements SmtpClient {
  connect(host: string, port: number, timeoutMs: number): Promise<SmtpConnection> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
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
