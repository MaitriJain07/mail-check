import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { AuthProvider } from '@/lib/auth';

export const metadata = { title: 'Dashboard' };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShell>{children}</DashboardShell>
    </AuthProvider>
  );
}
