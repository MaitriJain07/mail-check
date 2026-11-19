'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError, errorMessage } from './api';
import { useAuth } from './auth';

interface Settled<T> {
  /** Which request (path + reload counter) this result belongs to. */
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * GET a protected endpoint with loading/error state. Pass path=null to skip.
 * `loading` is derived (a result for the current request has not landed yet), and the
 * previous data stays visible while a reload or the next page is in flight.
 */
export function useApi<T>(path: string | null) {
  const { token, logout } = useAuth();
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = path ? `${path}#${nonce}` : null;

  useEffect(() => {
    if (!path || !token || !key) return;
    const controller = new AbortController();
    api<T>(path, { token, signal: controller.signal })
      .then((data) => setSettled({ key, data, error: null }))
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        if (err instanceof ApiClientError && err.status === 401) logout();
        setSettled((prev) => ({ key, data: prev?.data ?? null, error: errorMessage(err) }));
      });
    return () => controller.abort();
  }, [path, token, key, logout]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    data: settled?.data ?? null,
    error: settled?.key === key ? settled.error : null,
    loading: key !== null && settled?.key !== key,
    reload,
  };
}
