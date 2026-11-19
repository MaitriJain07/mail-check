import { describe, expect, it } from 'vitest';
import { isRoleAccount } from '../../src/verifier/role';

describe('isRoleAccount', () => {
  it.each(['admin', 'info', 'support', 'Postmaster', 'no-reply', 'sales+promo'])('flags %s', (l) =>
    expect(isRoleAccount(l)).toBe(true),
  );
  it.each(['jane', 'john.doe', 'administrator1', 'infoseeker'])('does not flag %s', (l) =>
    expect(isRoleAccount(l)).toBe(false),
  );
});
