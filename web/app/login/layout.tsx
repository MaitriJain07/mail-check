import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';

export const metadata = { title: 'Log in' };

export default function Layout({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
