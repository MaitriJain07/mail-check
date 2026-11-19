import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';

export const metadata = { title: 'Create account' };

export default function Layout({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
