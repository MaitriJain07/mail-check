'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { btnPrimary, ErrorNote, inputClass, Logo, Spinner } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const { status, login, register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  useEffect(() => {
    if (status === 'authed') router.replace('/dashboard');
  }, [status, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (isLogin ? login : register)(email.trim(), password);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8"><Logo /></div>
      <h1 className="text-3xl font-semibold tracking-tight">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mt-1.5 text-muted">{isLogin ? 'Log in to manage keys and bulk jobs.' : 'You get 100 free credits. No card needed.'}</p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            required
            minLength={isLogin ? 1 : 8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {!isLogin && <p className="mt-1.5 text-xs text-muted">At least 8 characters.</p>}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy && <Spinner />}
          {isLogin ? 'Log in' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {isLogin ? 'New here? ' : 'Already registered? '}
        <Link href={isLogin ? '/register' : '/login'} className="font-semibold text-brand underline underline-offset-2">
          {isLogin ? 'Create an account' : 'Log in'}
        </Link>
      </p>
    </main>
  );
}
