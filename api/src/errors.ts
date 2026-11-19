/** Every error response uses { error: { code, message, details } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new ApiError(400, 'bad_request', message, details),
  validation: (details: unknown) => new ApiError(400, 'validation_error', 'Request validation failed', details),
  unauthorized: (message = 'Authentication required') => new ApiError(401, 'unauthorized', message),
  paymentRequired: (message = 'Out of credits', details?: unknown) =>
    new ApiError(402, 'insufficient_credits', message, details ?? null),
  tooManyRows: (count: number, max: number) =>
    new ApiError(413, 'too_many_rows', 'Too many rows: ' + count + ' (max ' + max + ')', { count, max }),
  forbidden: (message = 'Forbidden') => new ApiError(403, 'forbidden', message),
  notFound: (message = 'Not found') => new ApiError(404, 'not_found', message),
  conflict: (message: string) => new ApiError(409, 'conflict', message),
  tooMany: (retryAfter: number, headers: Record<string, string>) =>
    new ApiError(429, 'rate_limited', 'Too many requests', { retryAfterSeconds: retryAfter }, {
      'Retry-After': String(retryAfter),
      ...headers,
    }),
};
