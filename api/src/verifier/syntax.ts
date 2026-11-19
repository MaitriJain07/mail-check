export type SyntaxResult =
  | { ok: true; email: string; local: string; domain: string }
  | { ok: false; reason: string; email: string };

const MAX_TOTAL = 254;
const MAX_LOCAL = 64;
const MAX_DOMAIN = 253;
const MAX_LABEL = 63;

// RFC 5322 "atext" without quoted strings or comments: what real mailboxes use.
const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Trim, lowercase, then validate. Pure: no I/O. */
export function checkSyntax(raw: string): SyntaxResult {
  const email = String(raw ?? '').trim().toLowerCase();
  const fail = (reason: string): SyntaxResult => ({ ok: false, reason, email });

  if (email.length === 0) return fail('Email is empty');
  if (email.length > MAX_TOTAL) return fail(`Email exceeds ${MAX_TOTAL} characters`);
  if (/\s/.test(email)) return fail('Email contains whitespace');

  const at = email.lastIndexOf('@');
  if (at === -1) return fail('Email is missing "@"');
  if (email.indexOf('@') !== at) return fail('Email contains more than one "@"');

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length === 0) return fail('Local part is empty');
  if (local.length > MAX_LOCAL) return fail(`Local part exceeds ${MAX_LOCAL} characters`);
  if (!LOCAL_RE.test(local)) return fail('Local part contains invalid characters or dots');

  if (domain.length === 0) return fail('Domain is empty');
  if (domain.length > MAX_DOMAIN) return fail(`Domain exceeds ${MAX_DOMAIN} characters`);
  const labels = domain.split('.');
  if (labels.length < 2) return fail('Domain must contain a dot');
  for (const label of labels) {
    if (label.length === 0) return fail('Domain contains an empty label');
    if (label.length > MAX_LABEL) return fail(`Domain label exceeds ${MAX_LABEL} characters`);
    if (!LABEL_RE.test(label)) return fail('Domain contains invalid characters');
  }
  if (!TLD_RE.test(labels[labels.length - 1] as string)) return fail('Domain has an invalid top-level domain');

  return { ok: true, email, local, domain };
}
