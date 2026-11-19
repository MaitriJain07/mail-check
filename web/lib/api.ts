export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface Options {
  method?: string;
  body?: unknown;
  formData?: FormData;
  token?: string | null;
  signal?: AbortSignal;
}

async function send(path: string, opts: Options): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // the browser sets the multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiClientError(0, 'network_error', 'Cannot reach the MailCheck API. Check that it is running.');
  }
}

async function toError(res: Response): Promise<ApiClientError> {
  const data = await res.json().catch(() => null);
  return new ApiClientError(
    res.status,
    data?.error?.code ?? 'error',
    data?.error?.message ?? res.statusText ?? 'Request failed',
    data?.error?.details,
    Number(res.headers.get('retry-after')) || undefined,
  );
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const res = await send(path, opts);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetch a protected file and hand it to the browser as a download. */
export async function downloadFile(path: string, token: string, filename: string): Promise<void> {
  const res = await send(path, { token });
  if (!res.ok) throw await toError(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 429) return `Too many requests. Try again in ${err.retryAfter ?? 'a few'} seconds.`;
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
