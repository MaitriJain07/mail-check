import type { Config } from '../config';
import { loadDisposableDomains } from './disposable';
import { createVerifier, type Verifier } from './index';
import { createMxLookup } from './mx';
import { NetSmtpClient } from './netSmtpClient';

/** Production wiring: real DNS, real sockets, bundled disposable list. */
export function createDefaultVerifier(config: Config): Verifier {
  return createVerifier({
    disposableDomains: loadDisposableDomains(),
    lookupMx: createMxLookup({
      timeoutMs: config.DNS_TIMEOUT_MS,
      ttlMs: config.MX_CACHE_TTL_SECONDS * 1000,
    }),
    smtpClient: new NetSmtpClient(),
    smtpEnabled: config.SMTP_CHECK_ENABLED,
    smtpTimeoutMs: config.SMTP_TIMEOUT_MS,
    heloDomain: config.SMTP_HELO_DOMAIN,
    mailFrom: config.SMTP_MAIL_FROM,
  });
}
