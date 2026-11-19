import { describe, expect, it } from 'vitest';
import { isDisposable, loadDisposableDomains, parseDomainList } from '../../src/verifier/disposable';

describe('disposable domains', () => {
  it('parses comments, blanks, case and whitespace', () => {
    const set = parseDomainList('# header\n\nMailinator.com  # trailing\r\n  yopmail.com\n');
    expect([...set].sort()).toEqual(['mailinator.com', 'yopmail.com']);
  });

  it('bundled list has a few hundred entries', () => {
    const set = loadDisposableDomains();
    expect(set.size).toBeGreaterThanOrEqual(300);
    expect(set.has('mailinator.com')).toBe(true);
  });

  it('matches exact and subdomains, not lookalikes', () => {
    const set = new Set(['mailinator.com']);
    expect(isDisposable('mailinator.com', set)).toBe(true);
    expect(isDisposable('MAILINATOR.com', set)).toBe(true);
    expect(isDisposable('foo.mailinator.com', set)).toBe(true);
    expect(isDisposable('notmailinator.com', set)).toBe(false);
    expect(isDisposable('mailinator.com.evil.org', set)).toBe(false);
    expect(isDisposable('gmail.com', set)).toBe(false);
  });
});
