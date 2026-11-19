import { describe, expect, it } from 'vitest';
import { checkSyntax } from '../../src/verifier/syntax';

describe('checkSyntax', () => {
  it('accepts normal addresses and normalises case and whitespace', () => {
    const r = checkSyntax('  Jane.Doe+news@Example.COM ');
    expect(r).toEqual({ ok: true, email: 'jane.doe+news@example.com', local: 'jane.doe+news', domain: 'example.com' });
  });

  it.each(['a@b.co', "o'brien@example.org", 'user_name@sub.example.co.uk', 'x@xn--bcher-kva.example'])(
    'accepts %s',
    (e) => expect(checkSyntax(e).ok).toBe(true),
  );

  it.each([
    ['', 'empty'],
    ['plainaddress', '@'],
    ['two@@example.com', 'more than one'],
    ['a@b@example.com', 'more than one'],
    ['@example.com', 'Local part is empty'],
    ['user@', 'Domain is empty'],
    ['user@localhost', 'dot'],
    ['.user@example.com', 'invalid'],
    ['user.@example.com', 'invalid'],
    ['us..er@example.com', 'invalid'],
    ['us er@example.com', 'whitespace'],
    ['user@-example.com', 'invalid'],
    ['user@example-.com', 'invalid'],
    ['user@exa_mple.com', 'invalid'],
    ['user@example..com', 'empty label'],
    ['user@example.c', 'top-level'],
    ['user@example.123', 'top-level'],
  ])('rejects %j', (e, fragment) => {
    const r = checkSyntax(e);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toContain(fragment.toLowerCase());
  });

  it('enforces length limits', () => {
    expect(checkSyntax(`${'a'.repeat(64)}@example.com`).ok).toBe(true);
    expect(checkSyntax(`${'a'.repeat(65)}@example.com`).ok).toBe(false);
    expect(checkSyntax(`a@${'b'.repeat(64)}.com`).ok).toBe(false);
    expect(checkSyntax(`a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(60)}.com`).ok).toBe(false);
  });

  it('handles non-string input without throwing', () => {
    expect(checkSyntax(undefined as unknown as string).ok).toBe(false);
  });
});
