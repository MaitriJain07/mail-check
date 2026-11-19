export const ROLE_LOCAL_PARTS: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'abuse', 'accounts', 'accounting', 'billing', 'careers', 'contact',
  'customerservice', 'devnull', 'dns', 'ftp', 'help', 'hello', 'hostmaster', 'hr', 'info',
  'jobs', 'legal', 'mail', 'mailer-daemon', 'marketing', 'media', 'news', 'newsletter',
  'noc', 'no-reply', 'noreply', 'donotreply', 'do-not-reply', 'office', 'orders', 'payments',
  'postmaster', 'press', 'privacy', 'recruitment', 'root', 'sales', 'security', 'service',
  'spam', 'support', 'team', 'usenet', 'uucp', 'webmaster', 'www',
]);

/** Role accounts are shared inboxes (admin@, info@, ...). A +tag suffix is ignored. */
export function isRoleAccount(local: string, roles: ReadonlySet<string> = ROLE_LOCAL_PARTS): boolean {
  const base = local.toLowerCase().split('+')[0] ?? '';
  return roles.has(base);
}
