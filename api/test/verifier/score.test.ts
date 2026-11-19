import { describe, expect, it } from 'vitest';
import { computeScore } from '../../src/verifier/score';
import type { CheckStatus, VerificationChecks } from '../../src/verifier/types';

const make = (s: Partial<Record<keyof VerificationChecks, CheckStatus>>): VerificationChecks => {
  const base: Record<keyof VerificationChecks, CheckStatus> = {
    syntax: 'skipped',
    disposable: 'skipped',
    mx: 'skipped',
    role: 'skipped',
    smtp: 'skipped',
    catchAll: 'skipped',
    ...s,
  };
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { status: v }])) as unknown as VerificationChecks;
};

const allPass = make({ syntax: 'pass', disposable: 'pass', mx: 'pass', role: 'pass', smtp: 'pass', catchAll: 'pass' });

describe('computeScore', () => {
  it('gives 100 when everything passes', () => {
    expect(computeScore(allPass, 'deliverable')).toBe(100);
  });
  it('caps by verdict', () => {
    expect(computeScore(allPass, 'undeliverable')).toBe(10);
    expect(computeScore(allPass, 'risky')).toBe(70);
    expect(computeScore(allPass, 'unknown')).toBe(65);
  });
  it('is 0 for nothing passed and sums partial passes', () => {
    expect(computeScore(make({}), 'undeliverable')).toBe(0);
    expect(computeScore(make({ syntax: 'pass', mx: 'pass' }), 'unknown')).toBe(40);
  });
});
