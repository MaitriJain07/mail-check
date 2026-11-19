export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'skipped';

export interface CheckOutcome {
  status: CheckStatus;
  detail?: string;
}

export type VerificationResultKind = 'deliverable' | 'undeliverable' | 'risky' | 'unknown';

export interface VerificationChecks {
  syntax: CheckOutcome;
  disposable: CheckOutcome;
  mx: CheckOutcome;
  role: CheckOutcome;
  smtp: CheckOutcome;
  catchAll: CheckOutcome;
}

export interface VerificationResult {
  email: string;
  result: VerificationResultKind;
  reason: string;
  checks: VerificationChecks;
  score: number;
  durationMs: number;
}

// ---- MX ----
export interface MxRecord {
  exchange: string;
  priority: number;
}

export type MxLookupResult =
  | { status: 'ok'; records: MxRecord[] }
  | { status: 'none' }
  | { status: 'error'; message: string };

export type MxLookup = (domain: string) => Promise<MxLookupResult>;

// ---- SMTP (behind an interface so tests can use a fake) ----
export interface SmtpReply {
  code: number;
  message: string;
}

export interface SmtpConnection {
  /** The 220 banner received on connect. */
  readonly greeting: SmtpReply;
  /** Send one command line (without CRLF) and wait for the full reply. */
  send(command: string): Promise<SmtpReply>;
  close(): void;
}

export interface SmtpClient {
  /** Rejects on connect failure or timeout. */
  connect(host: string, port: number, timeoutMs: number): Promise<SmtpConnection>;
}
