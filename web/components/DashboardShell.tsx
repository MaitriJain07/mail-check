'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Logo, Skeleton } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/keys', label: 'API keys' },
  { href: '/dashboard/bulk', label: 'Bulk verify' },
  { href: '/dashboard/usage', label: 'Usage' },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anon') router.replace('/login');
  }, [status, router]);

  if (status !== 'authed') {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-white/60 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3.5 lg:block lg:px-5 lg:py-6">
          <Logo href="/dashboard" />
          <button onClick={() => { logout(); router.replace('/'); }} className="text-sm font-medium text-muted hover:text-ink lg:hidden">Log out</button>
        </div>

        <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0">
          {NAV.map((item) => {
            const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-[15px] font-medium transition ${active ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-paper hover:text-ink'}`}
              >
                {item.label}
              </Link>
            );
          })}
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-lg px-3 py-2 text-[15px] font-medium text-muted hover:bg-paper hover:text-ink">
            API docs <span aria-hidden>↗</span>
          </a>
        </nav>

        <div className="hidden px-5 pb-6 lg:absolute lg:bottom-0 lg:left-0 lg:block lg:w-full">
          <p className="truncate text-sm text-muted" title={user?.email}>{user?.email}</p>
          <button onClick={() => { logout(); router.replace('/'); }} className="mt-1 text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-brand">Log out</button>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-9">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
