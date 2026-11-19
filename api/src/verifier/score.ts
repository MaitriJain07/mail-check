import type { VerificationChecks, VerificationResultKind } from './types';

const WEIGHTS: Record<keyof VerificationChecks, number> = {
  syntax: 20,
  disposable: 15,
  mx: 20,
  role: 10,
  smtp: 25,
  catchAll: 10,
};

/** Hard ceilings per verdict so a verdict and its score never contradict each other. */
const CEILING: Record<VerificationResultKind, number> = {
  undeliverable: 10,
  risky: 70,
  unknown: 65,
  deliverable: 100,
};

/** 0-100: sum of passed-check weights, capped by the final verdict. */
export function computeScore(checks: VerificationChecks, result: VerificationResultKind): number {
  let total = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof VerificationChecks)[]) {
    if (checks[key].status === 'pass') total += WEIGHTS[key];
  }
  return Math.max(0, Math.min(total, CEILING[result]));
}
