'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiClientError } from './api';
import type { User } from './types';

const TOKEN_KEY = 'mailcheck.token';

interface AuthValue {
  status: 'loading' | 'anon' | 'authed';
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-read credits etc. after an action that spends them. */
  refresh: () => Promise<void>;
}

type AuthState = Pick<AuthValue, 'status' | 'token' | 'user'>;

const AuthContext = createContext<AuthValue | null>(null);

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session just will not persist */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', token: null, user: null });

  useEffect(() => {
    // localStorage only exists in the browser, so the saved session is read after mount.
    const token = readToken();
    const restore = token
      ? api<{ user: User }>('/v1/auth/me', { token }).then(
          ({ user }): AuthState => ({ status: 'authed', token, user }),
          (err): AuthState => {
            // Only a rejected token ends the session; an unreachable API should not log people out.
            if (err instanceof ApiClientError && err.status === 401) {
              writeToken(null);
              return { status: 'anon', token: null, user: null };
            }
            return { status: 'authed', token, user: null };
          },
        )
      : Promise.resolve<AuthState>({ status: 'anon', token: null, user: null });
    void restore.then(setState);
  }, []);

  const complete = useCallback((token: string, user: User) => {
    writeToken(token);
    setState({ status: 'authed', token, user });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ...state,
      login: async (email, password) => {
        const r = await api<{ token: string; user: User }>('/v1/auth/login', { method: 'POST', body: { email, password } });
        complete(r.token, r.user);
      },
      register: async (email, password) => {
        const r = await api<{ token: string; user: User }>('/v1/auth/register', { method: 'POST', body: { email, password } });
        complete(r.token, r.user);
      },
      logout: () => {
        writeToken(null);
        setState({ status: 'anon', token: null, user: null });
      },
      refresh: async () => {
        if (!state.token) return;
        try {
          const { user } = await api<{ user: User }>('/v1/auth/me', { token: state.token });
          setState((s) => ({ ...s, user }));
        } catch {
          /* non-fatal */
        }
      },
    }),
    [state, complete],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
