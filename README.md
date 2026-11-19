# MailCheck

MailCheck is an email verification API with a dashboard. Send it an address and it runs six checks in order (syntax, disposable domain, MX records, role account, an SMTP mailbox handshake, and catch-all detection), then returns a verdict (`deliverable`, `undeliverable`, `risky` or `unknown`), a 0-100 score and the result of every individual check. Around that sit the pieces a real service needs: API keys stored only as hashes, MySQL-backed rate limiting, an atomic credit ledger, and a bulk-verification queue that survives restarts. The whole thing runs on Node.js, TypeScript and MySQL, with a Next.js dashboard, and needs no Redis or other infrastructure.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    W["Next.js dashboard<br/>(App Router, Tailwind)"]
  end
  subgraph API["API process (Express)"]
    R["Routes + Zod validation"]
    A["Auth: JWT / API key"]
    RL["Rate limiter"]
    C["Credit ledger"]
    V["Verifier pipeline"]
  end
  subgraph Worker["Worker process"]
    Q["Claim loop<br/>FOR UPDATE SKIP LOCKED"]
    T["Concurrency cap +<br/>per-domain throttle"]
    V2["Verifier pipeline"]
  end
  DB[("MySQL<br/>users, api_keys, usage_events,<br/>rate_limits, bulk_jobs, bulk_items")]
  DNS(("DNS"))
  MX(("Recipient<br/>mail server :25"))

  W -- "HTTPS / JSON" --> R
  R --> A --> RL --> V
  RL <--> DB
  A <--> DB
  C <--> DB
  R --> C
  V --> DNS
  V -. "optional SMTP_CHECK_ENABLED" .-> MX
  R -- "enqueue job + items" --> DB
  Q <-- "claim / complete" --> DB
  Q --> T --> V2
  V2 --> DNS
  V2 -. optional .-> MX
```

The API and the worker share nothing except MySQL, so either can be restarted or scaled on its own.

### The verification pipeline

Every step is a small module in [api/src/verifier](api/src/verifier) with unit tests, and the pipeline stops at the first decisive failure.

| # | Step | Outcome |
|---|------|---------|
| 1 | Syntax: trim, lowercase, RFC-reasonable pattern, length limits | invalid → `undeliverable` |
| 2 | Disposable: bundled list of 640+ domains loaded into a `Set` (subdomains match) | listed → `risky` |
| 3 | MX: `dns.promises.resolveMx` with a timeout and an in-memory TTL cache per domain | none → `undeliverable`; DNS error → `unknown` |
| 4 | Role account (`admin@`, `info@`, `support@`, ...) | flagged; downgrades a `deliverable` to `risky` |
| 5 | SMTP: connect to the lowest-preference MX on port 25, `EHLO`, `MAIL FROM`, `RCPT TO`, `QUIT` (never `DATA`) | 250 `deliverable`, 550/551/553 `undeliverable`, 4xx or anything else `unknown` |
| 6 | Catch-all: `RCPT TO` a random nonexistent mailbox on the same session | accepted → `risky` |

The SMTP client is an interface (`SmtpClient`), so tests use a scripted fake and never touch the network.

## Features

- Single verification: `POST /v1/verify`, `GET /v1/verify?email=`
- Bulk verification: JSON array or CSV upload, live progress, CSV download of results
- Accounts (bcrypt + JWT) and API keys (create, list, revoke; shown once, stored as SHA-256)
- Per-key rate limiting with `429`, `Retry-After` and `X-RateLimit-*` headers
- Credits: 100 free on signup, atomic decrement, `402` when exhausted
- Usage ledger with a 7-day series, result breakdown and paginated history
- Swagger UI at `/docs`, generated from an OpenAPI 3 spec served at `/openapi.json`
- Consistent `{ error: { code, message, details } }` errors, request IDs, helmet, CORS, graceful shutdown
- Dashboard: landing page with a live "try it" box, register/login, overview with chart, API keys, bulk upload, usage history

## Setup (4 commands)

Requires Node 20.19+ and Docker.

```bash
cp .env.example .env     # then set JWT_SECRET to something long and random
docker compose up -d --wait
npm install
npm run dev              # migrates, then runs API :4000, worker, and web :3000
```

Then open <http://localhost:3000> (dashboard) and <http://localhost:4000/docs> (API docs).

Optional: `npm run seed` creates `demo@mailcheck.dev` / `demo-password-123` with a week of usage, three keys and a finished bulk job.

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run migrate`, `npm run db:down`. In `api/`: `npm run worker` runs the compiled worker on its own (use `npm run worker:dev` while developing).

> **Tests need MySQL** (the docker-compose one is fine). They use a separate `mailcheck_test` database, so your dev data is never touched. DNS and SMTP are mocked, so no outbound network access is needed.

## Environment variables

All of them live in [.env.example](.env.example). One `.env` at the repo root serves both `api/` and `web/`.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `4000` | API port |
| `LOG_LEVEL` | `info` | pino level |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed browser origins |
| `TRUST_PROXY` | `0` | Reverse proxies in front of the API (set `1` on Render/Railway so rate limits see client IPs) |
| `DATABASE_URL` | `mysql://mailcheck:mailcheck@localhost:3307/mailcheck` | MySQL connection string |
| `TEST_DATABASE_URL` | `...:3307/mailcheck_test` | Used only by `npm test` |
| `DB_POOL_SIZE` | `10` | Connection pool size |
| `JWT_SECRET` | *(required)* | Signs dashboard tokens; 16+ chars |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `BCRYPT_ROUNDS` | `10` | bcrypt cost |
| `FREE_CREDITS` | `100` | Credits granted at signup |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window |
| `RATE_LIMIT_MAX` | `60` | Requests per window per API key |
| `DEMO_RATE_LIMIT_MAX` | `10` | Requests per window per IP on the public demo endpoint |
| `SMTP_CHECK_ENABLED` | `false` | Turn on the SMTP + catch-all steps (needs outbound port 25) |
| `SMTP_TIMEOUT_MS` | `8000` | Overall SMTP session timeout |
| `SMTP_HELO_DOMAIN` | `mailcheck.local` | Name used in `EHLO` |
| `SMTP_MAIL_FROM` | `verify@mailcheck.local` | Envelope sender used in `MAIL FROM` |
| `DNS_TIMEOUT_MS` | `5000` | MX lookup timeout |
| `MX_CACHE_TTL_SECONDS` | `300` | Per-domain MX cache lifetime |
| `EMBED_WORKER` | `false` | Run the bulk worker inside the API process (single-service hosting) |
| `BULK_MAX_ROWS` | `1000` | Max rows per bulk job |
| `WORKER_CONCURRENCY` | `10` | Items verified in parallel per worker |
| `WORKER_POLL_INTERVAL_MS` | `1000` | Idle poll interval |
| `DOMAIN_THROTTLE_MS` | `250` | Minimum gap between checks against one domain |
| `WORKER_LOCK_SECONDS` | `60` | Lease before a claimed item is handed to someone else |
| `BULK_MAX_ATTEMPTS` | `3` | Attempts per item before it is marked failed |
| `BULK_RETRY_DELAY_SECONDS` | `2` | Retry delay (multiplied by the attempt number) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | API base URL for the dashboard |

## API examples

```bash
API=http://localhost:4000

# Register (100 free credits) and keep the dashboard token
TOKEN=$(curl -s $API/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-password"}' | jq -r .token)

# Create an API key (the full key is returned only this once)
KEY=$(curl -s $API/v1/keys -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"my backend"}' | jq -r .key)

# Verify one address
curl -s "$API/v1/verify?email=jane@example.com" -H "X-API-Key: $KEY"
curl -s $API/v1/verify -H "X-API-Key: $KEY" -H 'content-type: application/json' \
  -d '{"email":"jane@example.com"}'

# Bulk: JSON...
JOB=$(curl -s $API/v1/bulk -H "X-API-Key: $KEY" -H 'content-type: application/json' \
  -d '{"emails":["a@example.com","b@example.org"]}' | jq -r .jobId)
# ...or a CSV (uses the "email" column, else the first column)
JOB=$(curl -s $API/v1/bulk -H "X-API-Key: $KEY" -F file=@contacts.csv | jq -r .jobId)

# Poll progress, then download
curl -s $API/v1/bulk/$JOB -H "X-API-Key: $KEY"
curl -s $API/v1/bulk/$JOB/download -H "X-API-Key: $KEY" -o results.csv

# Credits, 7-day series, breakdown, paginated history
curl -s "$API/v1/usage?page=1&pageSize=10" -H "X-API-Key: $KEY"

# Revoke a key
curl -s -X DELETE $API/v1/keys/1 -H "authorization: Bearer $TOKEN"
```

A verification response:

```json
{
  "email": "jane@example.com",
  "result": "unknown",
  "reason": "SMTP check disabled; syntax, disposable and MX checks passed",
  "checks": {
    "syntax":     { "status": "pass" },
    "disposable": { "status": "pass" },
    "mx":         { "status": "pass", "detail": "mx.example.com" },
    "role":       { "status": "pass" },
    "smtp":       { "status": "skipped", "detail": "SMTP check disabled (SMTP_CHECK_ENABLED=false)" },
    "catchAll":   { "status": "skipped" }
  },
  "score": 65,
  "durationMs": 38
}
```

Rate-limited requests get `429` with `Retry-After`, and every verification response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and `X-Credits-Remaining`. Credits: each `deliverable`, `undeliverable` or `risky` result costs 1; `unknown` is free (we could not tell you anything useful).

## Design decisions

**Why a MySQL queue instead of Redis or a broker?** The spec asked for infrastructure limited to MySQL, and for this workload that is also the right call. Jobs and their items must be durable, queryable (progress is just `COUNT`s on rows I already have) and transactional with the credit ledger. A broker would add a second system to deploy and a second place for state to disagree with the database. The cost is polling latency and lower peak throughput than a purpose-built queue, which is irrelevant when each item spends hundreds of milliseconds on DNS and SMTP anyway.

**Why `SELECT ... FOR UPDATE SKIP LOCKED`?** With several workers pulling from one table, a plain `FOR UPDATE` makes them queue behind each other's locks. `SKIP LOCKED` lets each worker take whatever rows nobody else holds, so there is no blocking and no item can be handed to two workers. On top of the claim: leases expire (`WORKER_LOCK_SECONDS`) so work stranded by a crashed worker is recovered, and finishing an item is a single transaction fenced on the attempt number (mark done, charge the credit, write the usage row, bump job counters). A worker that stalls past its lease therefore cannot double-charge or overwrite a newer result. This is covered by tests that run two workers in parallel and verify every item is processed exactly once.

**Why are API keys hashed?** Same reason passwords are. If the database leaks, stored keys must not be usable. Keys carry 192 bits of randomness, so a fast SHA-256 is sufficient (there is nothing to brute-force, which is what bcrypt-style slowness protects against) and keeps the per-request lookup to a single indexed query. A visible prefix (`mc_live_AbCd`) lets people recognise a key in the UI. The full key is returned exactly once at creation.

**Why is SMTP optional?** Many cloud hosts and consumer ISPs block outbound port 25, and some mail providers treat unsolicited probes as abuse. So it is off by default (`SMTP_CHECK_ENABLED=false`). When it is off, or when the connection times out or is refused, the result is `unknown` with an explanatory `reason`, never a 500. Syntax, disposable and MX checks still run, so obviously bad addresses are still caught.

**Other trade-offs** (simpler option chosen):

- `mysql2` with plain SQL migrations rather than Prisma: fewer moving parts, and `SKIP LOCKED` and explicit transactions are first-class.
- `bcryptjs` (bcrypt algorithm, pure JS) instead of native `bcrypt`, to avoid native build failures on free hosts and Windows.
- Fixed-window rate limiting (one row per key per window) instead of a sliding window.
- CommonJS output, no bundler: `tsc` to `dist/`.
- Credits are charged per result after verification, not reserved up front. A cheap pre-check avoids doing work for users at zero, and the guarded `UPDATE` makes overspending impossible.
- `unknown` results are free, and bulk uploads are de-duplicated before charging.
- Rate limits apply to the verification endpoints (`/v1/verify`, `POST /v1/bulk`), not to polling or dashboard reads, so progress polling never trips a limit.
- The landing page's "try it" box calls a small public `POST /v1/demo/verify` that is IP-rate-limited, free and writes no usage rows.
- The dashboard stores its JWT in `localStorage` (simple; see limitations).
- `EMBED_WORKER=true` lets the API process host the worker, for hosts that only give you one free service. The separate `npm run worker` entry remains the proper way to run it.

## Testing

139 tests in Vitest: unit tests for every verifier step (with the fake SMTP client, plus the real `net` client against a local fake server) and integration tests for auth, API keys, rate limiting, credit decrement under concurrency (including 40 simultaneous charges against 5 credits), and the whole bulk lifecycle (restart survival, parallel workers, retries, lease recovery, running out of credits mid-job). GitHub Actions runs install, lint, typecheck, test and build on every push, with a MySQL service container and no outbound network.

## Known limitations

- **The real SMTP handshake has only been exercised against local fake servers.** My development network blocks port 25, so I could confirm the failure path (clean `unknown` with a reason) but not live mailbox verification against real providers. Large providers also often accept everything or throttle probes, which is why `catch-all` and `unknown` exist.
- Catch-all detection uses a single random probe; some servers answer inconsistently.
- Greylisted mailboxes (4xx) are reported as `unknown`; they are not retried later.
- No fallback to A/AAAA records when a domain has no MX (RFC 5321 implicit MX), and no internationalised (IDN/UTF-8) local parts.
- The disposable and role lists are static files and go stale; update `api/src/verifier/data/disposable-domains.txt`.
- The MX cache and per-domain throttle are in-process, so they are per API/worker instance, not global.
- Fixed-window rate limiting allows up to 2x the limit in a burst across a window boundary.
- JWT in `localStorage` is exposed to XSS; httpOnly cookies would be stronger but need CSRF handling and same-site hosting.
- No email confirmation, password reset, billing or top-ups: credits are a counter only.
- Bulk jobs are capped (`BULK_MAX_ROWS`, 1000 by default) and run one result at a time per item; there is no job list or cancel.
- Lighthouse (production build, local): mobile performance 93 under simulated throttling, 100 on desktop; accessibility, best practices and SEO 100. Numbers will vary by machine.

## What I'd do next

1. Run it somewhere with port 25 open and measure real accuracy per provider; add provider-specific rules (for example Microsoft and Yahoo behaviour) and retry greylisted results.
2. Make the throttle and MX cache shared via MySQL so limits are global across workers, and add a sliding-window limiter.
3. Move auth to httpOnly cookies, add email verification and password reset.
4. A real billing path (Stripe, credit packs), plus webhooks for bulk-job completion.
5. Job list, cancel and resume in the dashboard; stream CSV uploads for larger files.
6. Metrics (Prometheus) and structured tracing keyed on the request ID; an alert on queue depth and oldest-pending-item age.
7. Refresh the disposable-domain list automatically from a maintained source in CI.

## Deploying for free

Free-tier terms change often and I have not re-verified them: check each provider's current limits before relying on this. Two things to know up front: free web services usually sleep when idle (the first request after a pause is slow), and a free always-on *background worker* is often not offered, which is what `EMBED_WORKER=true` is for.

- [ ] **MySQL.** Create a free MySQL database on Aiven or TiDB Cloud. Copy its connection string (add `?ssl=...` options if the provider requires TLS) and create an empty database for MailCheck.
- [ ] **Migrations.** Run automatically by the start command below (they are idempotent). To seed demo data from your machine: `DATABASE_URL="<hosted url>" npm run seed`.
- [ ] **API on Render or Railway.** Leave the root directory at the repo root. Build command: `npm ci --include=dev && npm run build -w api` (`--include=dev` because `tsc` is a dev dependency). Start command: `npm run migrate:prod -w api && npm start -w api`. Health check path: `/health`.
- [ ] **API environment.** `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (long random), `CORS_ORIGINS=https://<your-vercel-app>.vercel.app`, `TRUST_PROXY=1`, `SMTP_CHECK_ENABLED=false` (hosts block port 25).
- [ ] **Worker.** Either a second service with start command `npm run worker -w api`, or set `EMBED_WORKER=true` on the API service so one free service does both.
- [ ] **Web on Vercel.** Import the repo, set the root directory to `web`, and set `NEXT_PUBLIC_API_URL=https://<your-api-host>`. Redeploy after changing it (it is inlined at build time).
- [ ] **Smoke test.** Open `<api>/health`, `<api>/docs`, register on the web app, create a key, verify an address, upload a small CSV and confirm the job completes.

## Project layout

```
api/
  migrations/            plain SQL, applied in order and recorded in schema_migrations
  src/verifier/          the six steps + orchestrator + score (pure, unit-tested)
  src/routes/            auth, keys, verify, bulk, usage
  src/services/          users, apiKeys, credits, rateLimiter, bulkJobs, usage
  src/worker/            queue (claim/complete/retry), throttle, runner
  src/server.ts          API entry        src/worker.ts   worker entry
  test/                  Vitest unit + integration tests
web/
  app/                   landing, login, register, dashboard/*
  components/            result card, chart (lazy), breakdown, shell, forms
```
