# ReorderIQ backend

The backend runs **inside the Next.js application**: route handlers under
`app/api/**` are the HTTP surface, `lib/services/**` holds the business logic and
`lib/db/**` owns PostgreSQL access. There is no second server to deploy, and no
HTTP hop between the UI and the data layer.

## Principles

1. **Typed everywhere.** Drizzle infers row types from `lib/db/schema.ts`, Zod
   validates every request, and DTOs in `lib/api/dto.ts` are the only shapes that
   cross the network. `pnpm build` fails on type errors.
2. **Deny by default.** Every route declares an auth mode and (usually) a
   capability. Nothing is readable or writable unless a role explicitly allows it.
3. **Tenant isolation in the query, not the handler.** Every tenant query filters
   by `organizationId` taken from the session; identifiers from the client are
   never trusted as a tenant boundary.
4. **Validate, then normalise, then persist.** Strict schemas reject unknown keys,
   lengths are bounded, strings are trimmed, money is a bounded number.
5. **Server owns money and state transitions.** Prices, totals, opportunity
   scores, plan pricing, campaign statuses and references are computed server-side.
6. **Fail fast, fail closed.** `lib/env.ts` validates configuration at boot;
   errors leave as a stable JSON envelope without leaking internals.

## Layout

```
app/api/
  auth/[...all]/route.ts        better-auth HTTP surface (sign-up, sign-in, sign-out, session)
  contact/route.ts              public contact form
  v1/**/route.ts                versioned product API (see endpoint table)
lib/api/                        transport concerns shared by every route
  route.ts                      createRoute(): auth -> authz -> rate limit -> validation -> handler
  context.ts                    session + membership + capability resolution
  capabilities.ts               role -> capability matrix
  contracts.ts                  Zod request schemas
  dto.ts                        JSON transport types
  errors.ts                     ApiError + Postgres error mapping
  response.ts                   response envelope, pagination cursors
  origin.ts                     CSRF/cross-site guard
  rate-limit.ts                 durable fixed-window limiter
  validation.ts                 body/query/param parsing with size caps
  audit.ts                      append-only audit trail writer
  request-identity.ts           client IP extraction + hashing
lib/connectors/                 data connectors: spec, mapping engine, SSRF-safe fetch, secret sealing
lib/services/                   business logic (customers, orders, insights, campaigns, sync, ...)
lib/db/                         schema, pool, mappers, query helpers
lib/reorder/                    isomorphic prediction engine (used by UI and API)
proxy.ts                        security headers + CSP (Next 16 middleware)
drizzle/                        generated SQL migrations
scripts/                        checks, smoke suite
```

## Request pipeline

`createRoute()` executes, in order:

1. **Request id** — `crypto.randomUUID()`, echoed as `X-Request-Id` and in errors.
2. **Origin guard** — mutations from an untrusted `Origin` are rejected (403).
   Cookie-authenticated routes require a trustworthy origin signal (`Origin`
   match, or `Sec-Fetch-Site: same-origin`).
3. **Authentication** — `resolveSession()` reads the better-auth session cookie.
4. **Authorization** — membership + capability check; a missing organization
   yields `403 { reason: 'organization_required' }`, a missing/wrong role `403`.
5. **Rate limiting** — per user when signed in, otherwise per hashed IP.
6. **Validation** — body (`application/json`, byte-capped), query, path params.
7. **Handler** — service call; responses are `{ data }`, `{ data, pagination }`,
   `{ error, requestId }` or `204`.
8. **Error normalisation** — `ApiError`, Postgres constraint violations
   (unique → 409, FK/check → 422) and unexpected errors (500) are mapped, logged
   with the request id, and never expose stack traces or SQL.

Auth modes: `required` (session + organization), `session` (session only, used by
onboarding and the platform surface), `optional` (anonymous allowed), `public`
(no session handling).

`platformAdmin: true` restricts a route to ReorderIQ staff: the signed-in email
must appear in `PLATFORM_ADMIN_EMAILS`. It is checked before rate limiting and
validation, and such routes deliberately declare **no** capability — tenant roles
must never be able to reach platform data. An empty allowlist fails closed.

`cronSecret: true` marks a machine-triggered route (the scheduled-sync entrypoint).
The `x-cron-secret` header is compared in constant time against `SYNC_CRON_SECRET`
and an unset secret disables the route, so a deployment that never configures a
scheduler exposes nothing. It is paired with `auth: 'public'` because a scheduler
has no session, and public routes skip the cookie-origin guard.

## Authentication and authorization

- **Identity** is owned by better-auth and stored in `user`, `session`, `account`,
  `verification`. Passwords use better-auth's scrypt implementation (min length
  10). Sessions expire after 7 days and roll after 24 hours; a signed cookie cache
  (5 min) avoids a database read on every request.
- **Sign-out** (`POST /api/auth/sign-out`) deletes the session row and expires the
  session token *and* the cookie cache; the UI then replaces the history entry
  with `/sign-in` so the workspace cannot be reopened from the back button.
  Because the cookie cache answers `getSession` without reading the database for
  up to 5 minutes, a cookie pair *copied* before revocation stays accepted for
  that window — turn `session.cookieCache` off if revocation must be immediate
  even for copied cookies.
- **Cookies** are `httpOnly`, `SameSite=Lax`, `Path=/` and `Secure` whenever
  `BETTER_AUTH_URL` is `https://…`. (`Secure` is impossible over plain HTTP, so
  the flag follows the configured scheme and production warns when it is missing.)
- **Trusted origins** come from `BETTER_AUTH_URL` + `AUTH_TRUSTED_ORIGINS`
  (+ `http://localhost:3000` outside production).
- **Tenancy** is created by `POST /api/v1/organizations/onboard`, which is
  idempotent and only needs a session. It creates the organization, the OWNER
  membership and a trial subscription in a single transaction.
- **Capabilities** (`lib/api/capabilities.ts`):

| Capability                             | OWNER | ADMIN | ANALYST | SALES |
| -------------------------------------- | :---: | :---: | :-----: | :---: |
| `org:read`, `member:read`, `*:read`    |   ✔   |   ✔   |    ✔    |   ✔   |
| `org:update`, `member:manage`          |   ✔   |   ✔   |    –    |   –   |
| `integration:manage`, `billing:manage` |   ✔   |   ✔   |    –    |   –   |
| `audit:read`                           |   ✔   |   ✔   |    –    |   –   |
| `customer:write`, `order:write`        |   ✔   |   ✔   |    –    |   ✔   |
| `opportunity:write`, `message:write`   |   ✔   |   ✔   |    –    |   ✔   |
| `campaign:write`                       |   ✔   |   ✔   |    ✔    |   ✔   |

Ownership rules are enforced in the service layer too: the last owner cannot be
removed or demoted, and nobody can remove their own membership.

### Platform (staff) surface

Inbound contact-form submissions are **not tenant data**. The public form is
anonymous, so a submission cannot be attributed to an organization and none is
expected (see `lib/services/leads.ts`). Exposing them through a tenant route
would hand every workspace owner ReorderIQ's own sales inbox, so they live on a
separate surface instead:

| Surface                    | Guard                                      |
| -------------------------- | ------------------------------------------ |
| `/api/v1/platform/leads`   | `auth: 'session'` + `platformAdmin: true`  |
| `/admin/leads` (page)      | server-side session + allowlist, else 404  |

Attribution to a tenant would be the only way to make these tenant-scoped, which
requires capturing the organization at submission time. Until then, keep any new
endpoint for them on the platform surface.

## Data model

`lib/db/schema.ts` defines 20 tables with enum domains, checks and indexes:

| Area           | Tables                                                     |
| -------------- | ---------------------------------------------------------- |
| Identity       | `user`, `session`, `account`, `verification`               |
| Tenancy        | `organizations`, `members`, `subscriptions`                |
| Catalogue      | `products`                                                 |
| CRM + orders   | `customers`, `customer_sources`, `orders`, `order_items`   |
| Intelligence   | `opportunities`                                            |
| Outreach       | `campaigns`, `campaign_recipients`, `messages`             |
| Connectors     | `integrations`, `sync_runs`                                |
| Growth + audit | `contact_submissions`, `audit_logs`, `rate_limit_counters` |

Notable guarantees:

- every tenant table cascades from `organizations` and carries an
  `organization_id` index used by the isolation filters;
- unique constraints are tenant-scoped: `(organization_id, lower(name))` for
  products, `(organization_id, reference)` for orders, partial unique indexes for
  customer emails and product SKUs, `(campaign_id, customer_id)` for recipients;
- money is `numeric(14,2)` with non-negative checks; quantities are bounded;
  reorder score/probability are 0–100;
- `rate_limit_counters` is keyed by `(bucket, window_start)`, so window
  increments are atomic under concurrency;
- imported rows carry `(organization_id, external_source, external_id)` as a
  partial unique index, which is what makes a re-sync an update instead of a
  duplicate, and `sync_runs` records what every attempt read and wrote. For
  customers the namespace is the **connection id**, not the provider, so two
  stores on one provider cannot collide;
- `customer_sources (organization_id, integration_id, external_id)` is the
  customer-to-connection alias table: a customer is one identity with many
  aliases, and this is what makes "which platform is this customer from",
  connection-scoped matching and per-customer refresh possible. `integrations`
  is unique on `(organization_id, provider, external_account_id)`, not
  `(organization_id, provider)`, so a tenant can connect two stores;
- hard deletes are limited to join rows: customers and products are soft-deleted
  (`is_active = false`) so order history stays intact for reporting.

## Prediction engine

`lib/reorder/analytics.ts` is isomorphic (no Node APIs) and used by both the UI
and the API:

1. order intervals are derived per customer (cancelled orders are excluded);
2. the next order date is predicted from a 30/70 blend of the historical and
   recent median interval;
3. confidence falls with interval variance and rises with order count;
4. the reorder score weights consistency (30%), recency (35%), frequency (20%)
   and average order value (15%);
5. status (`DUE_TODAY`, `DUE_SOON`, `OVERDUE`, `AT_RISK`, `DORMANT`, `NEW`,
   `ACTIVE`) drives the recommended action;
6. `syncOpportunities()` persists the result as rows, so campaigns and dashboards
   read a stable table instead of recomputing per request.

Reads are bounded: at most 500 customers per request and 60 orders per customer
(window function), so a long-lived tenant cannot exhaust memory.

## Data connectors

Order history arrives through **connectors**: a declarative spec (endpoints, field
mapping, paging style) interpreted as data by `lib/connectors/**`, so a provider is
configuration rather than code. See `docs/INTEGRATIONS.md` for the full guide.

- `lib/connectors/config.ts` — the spec and the canonical field list the API, the
  database and the UI all share.
- `lib/connectors/fetch.ts` — the only module allowed to make an outbound call on a
  tenant's behalf. It resolves the host, refuses private/link-local/metadata
  addresses, pins the socket to the validated address, re-validates every redirect,
  and caps time and size.
- `lib/services/sync.ts` — preview (dry run), run, scheduler claim, run history.
- `lib/services/ingest.ts` — idempotent upserts matched on this connection's
  alias, falling back to email/phone, SKU or name. Re-running a sync updates; it
  never duplicates. An alias is inserted once and never repointed, and a natural
  key that resolves to more than one customer is **rejected for review** rather
  than guessed at — attaching an order to the wrong buyer silently corrupts the
  intervals everything else is built on.
- Imported rows land in the normal tenant tables, so the prediction engine, the
  dashboards and campaigns need to know nothing about connectors. Orders are
  written with `source = 'API'` and keep the source's own amounts and timestamps.

The scheduler is an HTTP entrypoint (`POST /api/v1/integrations/sync-due`, guarded
by `SYNC_CRON_SECRET`) rather than an in-process timer, so the same code runs on a
single VPS and on serverless. A due connection is claimed with a conditional update
before its work starts, so overlapping scheduler runs cannot double-sync a tenant,
and a failed run retries in 15 minutes. A tick that finds a connection's run slot
already held by a manual run counts it as `skipped`, not `failed`.

A connection runs at most one sync at a time, enforced by a partial unique index
(`sync_runs (integration_id) WHERE status = 'RUNNING'`) so concurrent starters are
decided by the database; the loser gets 409. This prevents two runs rewriting the
same order's line items at once, which can duplicate them under `READ COMMITTED`.
A `RUNNING` row older than 30 minutes is retired as `FAILED` so a dead process
does not block a connection permanently.

A connection whose `auth.type` is `none` is never decrypted, so a rotated
`INTEGRATION_SECRET_KEY` cannot break a source that carries no credential.

Configuration: `INTEGRATION_SECRET_KEY` (32+ chars) seals tenant credentials and
**fails closed** when unset; `INTEGRATION_ALLOW_PRIVATE_NETWORKS=true` is the
explicit opt-in for an on-premise source; `SYNC_CRON_SECRET` enables the scheduler
endpoint.

## Endpoint reference

All product endpoints live under `/api/v1`, return JSON, and set
`Cache-Control: no-store` (tenant data must never be cached by shared caches).

| Method           | Path                                      | Auth     | Capability            |
| ---------------- | ----------------------------------------- | -------- | --------------------- |
| GET              | `/api/v1/health`                          | public   | –                     |
| POST             | `/api/contact`                            | public   | – (rate limited)      |
| GET              | `/api/v1/session`                         | optional | –                     |
| POST             | `/api/v1/organizations/onboard`           | session  | –                     |
| GET / PATCH      | `/api/v1/organization`                    | required | `org:read/update`     |
| GET / POST       | `/api/v1/team`                            | required | `member:read/manage`  |
| PATCH / DELETE   | `/api/v1/team/{memberId}`                 | required | `member:manage`       |
| GET / POST       | `/api/v1/customers`                       | required | `customer:read/write` |
| GET/PATCH/DELETE | `/api/v1/customers/{customerId}`          | required | `customer:read/write` |
| POST             | `/api/v1/customers/{customerId}/merge`    | required | `customer:write`      |
| POST             | `/api/v1/customers/{customerId}/refresh`  | required | `integration:manage` (rate limited) |
| GET / POST       | `/api/v1/products`                        | required | `product:read/write`  |
| GET/PATCH/DELETE | `/api/v1/products/{productId}`            | required | `product:read/write`  |
| GET / POST       | `/api/v1/orders`                          | required | `order:read/write`    |
| GET / PATCH      | `/api/v1/orders/{orderId}`                | required | `order:read/write`    |
| GET              | `/api/v1/opportunities`                   | required | `opportunity:read`    |
| PATCH            | `/api/v1/opportunities/{opportunityId}`   | required | `opportunity:write`   |
| POST             | `/api/v1/opportunities/recompute`         | required | `opportunity:read`    |
| GET              | `/api/v1/insights/overview`               | required | `customer:read`       |
| GET / POST       | `/api/v1/campaigns`                       | required | `campaign:read/write` |
| PATCH            | `/api/v1/campaigns/{campaignId}`          | required | `campaign:write`      |
| POST             | `/api/v1/campaigns/{campaignId}/dispatch` | required | `campaign:write`      |
| GET / POST       | `/api/v1/messages`                        | required | `message:read/write`  |
| GET / POST       | `/api/v1/integrations`                    | required | `integration:*`       |
| GET              | `/api/v1/integrations/presets`            | required | `integration:read`    |
| POST             | `/api/v1/integrations/sync-due`           | machine  | `x-cron-secret`       |
| PATCH / DELETE   | `/api/v1/integrations/{integrationId}`    | required | `integration:manage`  |
| POST             | `/api/v1/integrations/{id}/credential`    | required | `integration:manage`  |
| POST             | `/api/v1/integrations/{id}/preview`       | required | `integration:manage`  |
| POST             | `/api/v1/integrations/{id}/sync`          | required | `integration:manage`  |
| GET              | `/api/v1/integrations/{id}/runs`          | required | `integration:read`    |
| GET / PATCH      | `/api/v1/billing/subscription`            | required | `billing:read/manage` |
| GET              | `/api/v1/audit`                           | required | `audit:read`          |
| GET              | `/api/v1/platform/leads`                  | staff    | – (allowlist)         |
| PATCH            | `/api/v1/platform/leads/{leadId}`         | staff    | – (allowlist)         |
| ANY              | `/api/auth/[...all]`                      | public   | better-auth routes    |

Response shapes:

```jsonc
// single resource
{ "data": { "id": "…" } }
// collection (+ opaque cursor pagination where supported)
{ "data": [ /* … */ ], "pagination": { "limit": 25, "cursor": null, "nextCursor": "eyJ…", "total": 124 } }
// error
{
  "error": { "code": "unprocessable_entity", "message": "…", "details": [{ "path": "phone", "message": "…" }] },
  "requestId": "9f0c…"
}
```

Status codes used: `200`, `201`, `204`, `400` (malformed request), `401`, `403`
(role, missing organization, untrusted origin), `404`, `405`, `409` (duplicate),
`413`, `415`, `422` (validation/integrity), `429` (+ `Retry-After`), `500`, `503`.

## Security controls

| Threat                         | Control                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| SQL injection                  | Drizzle parameterised queries only; no string-built SQL; identifiers come from the schema    |
| Broken object level auth       | Every tenant query filters `organization_id` from the session; foreign ids resolve to 404     |
| Privilege escalation           | Capability matrix + ownership invariants (last owner, self-removal) enforced in services      |
| CSRF                           | `SameSite=Lax` cookies + origin / Sec-Fetch-Site guard on cookie-authenticated mutations      |
| XSS                            | React escaping, no `dangerouslySetInnerHTML`, strict CSP on dynamic routes, `nosniff`         |
| Clickjacking                   | `frame-ancestors 'none'` + `X-Frame-Options: DENY`                                           |
| Credential stuffing            | scrypt hashing, min password length, better-auth limits, DB-backed API limits                 |
| Spam / bot form abuse          | Honeypot field, duplicate suppression window, per-IP limits                                  |
| Mass assignment                | Strict Zod objects reject unknown keys; mappers whitelist every field                        |
| Secret leakage                 | Credential-like config keys are rejected (`api_key`, `token`, …); DB stores `secret_ref` only |
| PII exposure                   | Client IPs are stored as salted hashes; responses never spread raw rows                      |
| Tenant data in shared caches   | `Cache-Control: no-store` on every API response                                              |
| Information disclosure         | Generic 5xx messages + request id for correlation; stack traces stay in server logs           |
| Transport                      | HSTS, `upgrade-insecure-requests`, `Secure` cookies on HTTPS deployments                     |

Rate limit policies (`lib/api/rate-limit.ts`): authenticated reads 300/min,
authenticated writes 60/min, contact form 5 per 10 min per IP, onboarding 10/h
per user, campaign dispatch 10 per 5 min, opportunity recompute 6 per 5 min,
connector sync 6 per 5 min, connector preview 30 per 5 min. Counters live in `rate_limit_counters`, so
limits hold across processes and restarts. `x-forwarded-for` is only trustworthy
behind a proxy that overwrites it — see `lib/api/request-identity.ts`.

## Operations

```bash
pnpm db:generate      # schema change -> drizzle/NNNN_*.sql (review before applying)
pnpm db:migrate       # apply pending migrations (idempotent, tracked in drizzle.__drizzle_migrations)
pnpm db:push          # prototyping only: skips migration history
pnpm db:check         # connectivity, table list, row counts
pnpm ui:check         # server-renders the connector UI (no browser needed)
pnpm discovery:check  # API-structure import (samples, OpenAPI, connector exports)
pnpm guard:check      # the connector fetch guard, offline: no server, DB or network
BASE=http://localhost:3000 bash scripts/smoke.sh        # API assertions (hermetic)
BASE=http://localhost:3000 pnpm connector:check         # live ingest from a public API
BASE=http://localhost:3000 pnpm connector:tester        # live credential/error-body check
```

Adding a field or table: edit `lib/db/schema.ts` → `pnpm db:generate` → review the
SQL → `pnpm db:migrate` → expose it through a service + DTO + Zod schema → add a
route with `createRoute`. `pnpm typecheck` keeps the chain honest.

## Known limitations / next steps

- **Message delivery** is intentionally a stub: campaigns and messages are stored
  with the `DEMO` provider. A worker (queue + WhatsApp/SMS adapter) should pick
  up `QUEUED` rows; `messages.provider` is already an enum ready for that.
- **Payments** are not charged: plan changes update the subscription row and are
  audited, but Paystack/M-Pesa collection is out of scope. `subscriptions` keeps
  `external_reference` for a PSP reference.
- **Email invitations** need a mail provider; `POST /api/v1/team` currently adds
  existing ReorderIQ accounts only.
- **List pagination** is cursor-based and in-memory for computed lists (customers
  by score/spend) because insight sorting cannot be expressed in SQL; the cap is
  500 customers per request.
- **CSP** is strict (nonce + `strict-dynamic`) on dynamically rendered pages.
  Prerendered marketing pages get `'unsafe-inline'` for scripts because their
  hydration payload is built ahead of time; marking those routes dynamic enables
  the strict policy everywhere.
- **Connector auth is a pasted credential, not OAuth.** Zoho's token expires
  hourly and must be re-entered; a refresh-token flow is the natural next step.
  Credentials are sealed with AES-256-GCM (`lib/connectors/secret.ts`), and
  `secret_ref` remains for deployments fronting a managed secret store.
- **A customer needs a phone number** (`customers.phone` is `not null`), so an
  email-only source row is rejected with a reason instead of imported.
- **Connector syncs are synchronous** inside the request (`maxDuration = 300`);
  a large first backfill should be run in slices with `maxRecords`.
- **No delta deletes**: a record removed at the source is never removed here.
