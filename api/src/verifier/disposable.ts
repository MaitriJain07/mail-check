import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DISPOSABLE_FILE = path.join(__dirname, 'data', 'disposable-domains.txt');

/** Parse list text: one domain per line, `#` comments and blank lines ignored. */
export function parseDomainList(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const d = line.split('#')[0]?.trim().toLowerCase();
    if (d) out.add(d);
  }
  return out;
}

export function loadDisposableDomains(file: string = DEFAULT_DISPOSABLE_FILE): Set<string> {
  return parseDomainList(fs.readFileSync(file, 'utf8'));
}

/** True if the domain, or any parent domain (sub.mailinator.com), is listed. */
export function isDisposable(domain: string, list: ReadonlySet<string>): boolean {
  const labels = domain.toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (list.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}
