/** Hand-written OpenAPI 3.0 spec, served at /openapi.json and rendered by Swagger UI at /docs. */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});
const json = (schema: object) => ({ 'application/json': { schema } });
const standardErrors = {
  '400': errorResponse('Validation failed'),
  '401': errorResponse('Missing or invalid credentials'),
};
const apiAuth = [{ ApiKeyAuth: [] }, { BearerAuth: [] }];
const rateLimitHeaders = {
  'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed per window' },
  'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests left in this window' },
  'X-RateLimit-Reset': { schema: { type: 'integer' }, description: 'Unix time (seconds) when the window resets' },
};

const checkStatus = { type: 'string', enum: ['pass', 'fail', 'unknown', 'skipped'] };
const check = {
  type: 'object',
  required: ['status'],
  properties: { status: checkStatus, detail: { type: 'string' } },
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'MailCheck API',
    version: '1.0.0',
    description: [
      'Email verification: syntax, disposable domain, MX, role account, SMTP mailbox and catch-all checks.',
      '',
      '**Authentication.** Send an API key in `X-API-Key` (or `Authorization: Bearer mc_live_...`). ',
      'Dashboard endpoints use the JWT returned by `/v1/auth/login` as `Authorization: Bearer <jwt>`.',
      '',
      '**Credits.** Each conclusive verdict (`deliverable`, `undeliverable`, `risky`) costs 1 credit; `unknown` is free. Out of credits returns `402`.',
      '',
      '**Rate limits.** Verification endpoints are limited per API key. Every response carries `X-RateLimit-*`; exceeding the limit returns `429` with `Retry-After`.',
      '',
      '**Errors** always look like `{ "error": { "code", "message", "details" } }`. Every response has an `X-Request-Id` header.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Verify' },
    { name: 'Bulk' },
    { name: 'Account' },
    { name: 'API keys' },
    { name: 'System' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      BearerAuth: { type: 'http', scheme: 'bearer', description: 'Dashboard JWT, or an API key.' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'details'],
            properties: {
              code: { type: 'string', example: 'validation_error' },
              message: { type: 'string' },
              details: { nullable: true, description: 'Extra context, e.g. per-field validation issues.' },
            },
          },
        },
      },
      Check: check,
      VerificationResult: {
        type: 'object',
        required: ['email', 'result', 'reason', 'checks', 'score', 'durationMs'],
        properties: {
          email: { type: 'string', example: 'jane@example.com', description: 'Normalised (trimmed, lowercased).' },
          result: { type: 'string', enum: ['deliverable', 'undeliverable', 'risky', 'unknown'] },
          reason: { type: 'string', example: 'Mailbox exists and accepts mail' },
          checks: {
            type: 'object',
            required: ['syntax', 'disposable', 'mx', 'role', 'smtp', 'catchAll'],
            properties: {
              syntax: ref('Check'),
              disposable: ref('Check'),
              mx: ref('Check'),
              role: ref('Check'),
              smtp: ref('Check'),
              catchAll: ref('Check'),
            },
          },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          durationMs: { type: 'integer' },
        },
      },
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, email: { type: 'string' }, credits: { type: 'integer' } },
      },
      AuthResponse: {
        type: 'object',
        properties: { token: { type: 'string', description: 'JWT for dashboard calls' }, user: ref('User') },
      },
      Credentials: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8, maxLength: 72 },
        },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          prefix: { type: 'string', example: 'mc_live_AbCd', description: 'First characters of the key, for recognition.' },
          createdAt: { type: 'string', format: 'date-time' },
          lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
          revokedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      BulkJob: {
        type: 'object',
        properties: {
          jobId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['queued', 'processing', 'completed'] },
          progress: {
            type: 'object',
            properties: { total: { type: 'integer' }, processed: { type: 'integer' }, percent: { type: 'integer' } },
          },
          counts: {
            type: 'object',
            properties: {
              deliverable: { type: 'integer' },
              undeliverable: { type: 'integer' },
              risky: { type: 'integer' },
              unknown: { type: 'integer' },
              failed: { type: 'integer', description: 'Items that could not be processed after 3 attempts' },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          finishedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Usage: {
        type: 'object',
        properties: {
          credits: { type: 'integer' },
          totals: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              deliverable: { type: 'integer' },
              undeliverable: { type: 'integer' },
              risky: { type: 'integer' },
              unknown: { type: 'integer' },
            },
          },
          last7Days: {
            type: 'array',
            items: { type: 'object', properties: { date: { type: 'string', format: 'date' }, count: { type: 'integer' } } },
          },
          history: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    email: { type: 'string' },
                    result: { type: 'string' },
                    creditsUsed: { type: 'integer' },
                    apiKeyPrefix: { type: 'string', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/v1/verify': {
      post: {
        tags: ['Verify'],
        summary: 'Verify one email',
        security: apiAuth,
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', example: 'jane@example.com' } },
          }),
        },
        responses: {
          '200': {
            description: 'Verification result',
            headers: { ...rateLimitHeaders, 'X-Credits-Remaining': { schema: { type: 'integer' } } },
            content: json(ref('VerificationResult')),
          },
          ...standardErrors,
          '402': errorResponse('Out of credits'),
          '429': errorResponse('Rate limit exceeded (see Retry-After)'),
        },
      },
      get: {
        tags: ['Verify'],
        summary: 'Verify one email (query string)',
        security: apiAuth,
        parameters: [{ name: 'email', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Verification result',
            headers: { ...rateLimitHeaders, 'X-Credits-Remaining': { schema: { type: 'integer' } } },
            content: json(ref('VerificationResult')),
          },
          ...standardErrors,
          '402': errorResponse('Out of credits'),
          '429': errorResponse('Rate limit exceeded (see Retry-After)'),
        },
      },
    },
    '/v1/demo/verify': {
      post: {
        tags: ['Verify'],
        summary: 'Public demo verification',
        description: 'Used by the landing-page "try it" box. No auth, free, limited per IP.',
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string' } } }),
        },
        responses: {
          '200': { description: 'Verification result', content: json(ref('VerificationResult')) },
          '400': errorResponse('Validation failed'),
          '429': errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/v1/bulk': {
      post: {
        tags: ['Bulk'],
        summary: 'Create a bulk verification job',
        description:
          'Send a JSON array (or `{ "emails": [...] }`), or upload a CSV as multipart field `file` (uses the column headed `email`, else the first column). Duplicates are removed. Maximum rows is configurable (`BULK_MAX_ROWS`). Processing happens in a separate worker; poll the job for progress.',
        security: apiAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { type: 'array', items: { type: 'string' } },
                  { type: 'object', required: ['emails'], properties: { emails: { type: 'array', items: { type: 'string' } } } },
                ],
              },
              example: { emails: ['jane@example.com', 'info@example.org'] },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary', description: 'CSV file, max 5 MB' } },
              },
            },
          },
        },
        responses: {
          '202': { description: 'Job queued', content: json(ref('BulkJob')) },
          ...standardErrors,
          '402': errorResponse('Not enough credits to cover the list'),
          '413': errorResponse('Too many rows or file too large'),
          '429': errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/v1/bulk/{jobId}': {
      get: {
        tags: ['Bulk'],
        summary: 'Bulk job status and progress',
        security: apiAuth,
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Job status', content: json(ref('BulkJob')) },
          '400': errorResponse('Invalid job id'),
          '401': errorResponse('Unauthorised'),
          '404': errorResponse('No such job'),
        },
      },
    },
    '/v1/bulk/{jobId}/download': {
      get: {
        tags: ['Bulk'],
        summary: 'Download results as CSV',
        description: 'Available once the job is `completed`.',
        security: apiAuth,
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } },
          '404': errorResponse('No such job'),
          '409': errorResponse('Job not finished yet'),
        },
      },
    },
    '/v1/usage': {
      get: {
        tags: ['Account'],
        summary: 'Credits, totals, 7-day series and paginated history',
        security: apiAuth,
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
        ],
        responses: { '200': { description: 'Usage', content: json(ref('Usage')) }, ...standardErrors },
      },
    },
    '/v1/auth/register': {
      post: {
        tags: ['Account'],
        summary: 'Create an account (100 free credits)',
        requestBody: { required: true, content: json(ref('Credentials')) },
        responses: {
          '201': { description: 'Account created', content: json(ref('AuthResponse')) },
          '400': errorResponse('Validation failed'),
          '409': errorResponse('Email already registered'),
        },
      },
    },
    '/v1/auth/login': {
      post: {
        tags: ['Account'],
        summary: 'Log in and receive a dashboard JWT',
        requestBody: { required: true, content: json(ref('Credentials')) },
        responses: {
          '200': { description: 'Logged in', content: json(ref('AuthResponse')) },
          '400': errorResponse('Validation failed'),
          '401': errorResponse('Invalid email or password'),
        },
      },
    },
    '/v1/auth/me': {
      get: {
        tags: ['Account'],
        summary: 'Current user',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'User', content: json({ type: 'object', properties: { user: ref('User') } }) },
          '401': errorResponse('Unauthorised'),
        },
      },
    },
    '/v1/keys': {
      get: {
        tags: ['API keys'],
        summary: 'List API keys (prefix only)',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Keys',
            content: json({ type: 'object', properties: { keys: { type: 'array', items: ref('ApiKey') } } }),
          },
          '401': errorResponse('Unauthorised'),
          '403': errorResponse('API keys cannot manage keys'),
        },
      },
      post: {
        tags: ['API keys'],
        summary: 'Create an API key',
        description: 'The full key is returned **once**. Only its SHA-256 hash is stored.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 } } }),
        },
        responses: {
          '201': {
            description: 'Key created',
            content: json({ type: 'object', properties: { key: { type: 'string', example: 'mc_live_...' }, apiKey: ref('ApiKey') } }),
          },
          '400': errorResponse('Validation failed'),
          '401': errorResponse('Unauthorised'),
          '403': errorResponse('API keys cannot manage keys'),
        },
      },
    },
    '/v1/keys/{id}': {
      delete: {
        tags: ['API keys'],
        summary: 'Revoke an API key',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '204': { description: 'Revoked' },
          '401': errorResponse('Unauthorised'),
          '404': errorResponse('Not found or already revoked'),
        },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness and database check',
        responses: {
          '200': { description: 'Healthy', content: json({ type: 'object', properties: { status: { type: 'string' }, db: { type: 'string' } } }) },
          '503': { description: 'Database unreachable' },
        },
      },
    },
  },
} as const;
