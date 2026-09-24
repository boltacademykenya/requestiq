# ReorderIQ

Repeat-revenue intelligence for B2B food and distribution businesses: it turns
customer order history into reorder predictions, opportunities, campaigns and
dashboard reporting.

Full-stack **Next.js 16 (App Router)** application with an embedded backend —
no separate API server, service or process to deploy. Data lives in
**PostgreSQL** and every layer is typed end to end (TypeScript + Drizzle + Zod).

- Backend architecture, security model and API reference: [`docs/BACKEND.md`](docs/BACKEND.md)
- Marketing site, auth pages, workspace and billing UI are in `app/` and `components/`.

## Stack

| Concern      | Choice                                                     |
| ------------ | ---------------------------------------------------------- |
| Runtime      | Next.js 16.3 (App Router, route handlers, `proxy.ts`)       |
| Language     | TypeScript (strict, `noEmit` typecheck in CI-style scripts) |
| Database     | PostgreSQL + Drizzle ORM (`pg` pool)                        |
| Auth         | better-auth (email + password, scrypt, DB-backed sessions)  |
| Validation   | Zod 4 (strict objects, no unknown keys)                     |
| UI           | React 19, Tailwind CSS 4, Recharts, lucide icons            |

## Quickstart

Prerequisites: Node 22+, pnpm 10+, PostgreSQL 14+ running locally.

```bash
# 1. dependencies
pnpm install

# 2. environment
cp .env.example .env.local
#   DATABASE_URL=postgres://postgres:1234@localhost:5432/reorderiq
#   BETTER_AUTH_SECRET=<32+ random bytes: openssl rand -base64 32>

# 3. create the database (only needed once)
psql "postgres://postgres:1234@localhost:5432/postgres" -c 'CREATE DATABASE reorderiq;'

# 4. apply the schema
pnpm db:migrate

# 5. run
pnpm dev            # http://localhost:3000
```

Then:

- `/` marketing site, `/pricing`, `/contact` (submissions are stored in PostgreSQL)
- `/sign-up` creates a better-auth account and, immediately after, a tenant/workspace
- `/workspace` signs out from the account menu in the header: the session row is deleted server-side and the browser returns to `/sign-in`
- `/api/v1/health` readiness probe (verifies database connectivity)

## Scripts

| Script              | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `pnpm dev`          | Next.js dev server on `0.0.0.0:3000`                          |
| `pnpm build`        | Production build (fails on type errors)                       |
| `pnpm start`        | Production server                                             |
| `pnpm typecheck`    | `tsc --noEmit` across the project                             |
| `pnpm db:generate`  | Generate a SQL migration from `lib/db/schema.ts`              |
| `pnpm db:migrate`   | Apply pending migrations                                      |
| `pnpm db:migrate:deploy` | Apply migrations ahead of a deploy (production only, lock-guarded) |
| `pnpm db:push`      | Push the schema directly (prototyping only)                   |
| `pnpm db:studio`    | Drizzle Studio data browser                                   |
| `pnpm db:check`     | Connectivity + table + row-count check                        |
| `pnpm ui:check`     | Server-renders the connector UI (catches render-time breakage) |
| `pnpm discovery:check` | Asserts API-structure import (sample, OpenAPI, connector export) |
| `pnpm guard:check`  | Asserts the connector SSRF guard refuses private/metadata addresses |
| `bash scripts/smoke.sh` | End-to-end API test suite (assertions against a running server) |
| `pnpm connector:check` | Live end-to-end connector ingest from a public API         |
| `pnpm connector:tester` | Live credential/error-body check against the local business tester |

## Migrations at startup

Migrations run automatically when a server instance boots — the way a
single-process server migrates in `main()` before it accepts traffic.
`instrumentation.ts` exports `register()`, which Next.js calls once per server
instance and requires to finish before that instance serves a request; it
delegates to `lib/db/migrate.ts`.

So production heals itself: a deployment whose database is missing the schema
creates it at boot instead of serving 500s, and `pnpm dev` migrates the local
database too.

Three deliberate properties in `lib/db/migrate.ts`:

- **Production only.** It gates on `VERCEL_ENV` (absent off Vercel), so a preview
  deployment never migrates. Previews usually share the production connection
  string, and a branch push must not be able to mutate the production schema —
  give preview deployments their own Neon branch to change that.
- **Serialised.** Drizzle reads its bookkeeping row *outside* the DDL transaction,
  so two instances booting together would both replay the same statements and the
  loser would fail on `relation already exists`. A Postgres advisory lock makes
  the second caller wait. This matters because every cold start runs the hook.
- **Idempotent.** Applied migrations are skipped, so the usual cost is a single
  `select` against `drizzle.__drizzle_migrations`.

Connection string preference: `MIGRATION_DATABASE_URL`, `DATABASE_URL_UNPOOLED`
(provisioned by the Neon Vercel integration), `DIRECT_URL`, then `DATABASE_URL`.
An unpooled URL is preferable for DDL, which is why the Neon one comes first.

`next.config.mjs` sets `outputFileTracingIncludes` so the SQL under `drizzle/`
ships inside the function bundles. The output tracer cannot see files read
through `fs`, so without that the boot hook fails on
`Can't find meta/_journal.json file`.

Keep migrations additive (expand/contract): during a rolling deploy the old
instances keep serving against the newly migrated schema until they drain.

For a heavy migration — a large backfill, or an index on a big table — apply it
ahead of the deploy so the cost is not paid by the first request:

```bash
DATABASE_URL="<Neon DIRECT URL>" pnpm db:migrate:deploy
```

## Verifying a deployment

```bash
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm db:check
BASE=http://localhost:3000 bash scripts/smoke.sh   # expects a reachable server
pnpm ui:check                                      # no server needed
pnpm discovery:check                               # no server needed
pnpm guard:check                                   # no server, DB or network needed
BASE=http://localhost:3000 pnpm connector:check    # needs outbound internet
BASE=http://localhost:3000 pnpm connector:tester   # needs the local business tester
```

The smoke suite covers public endpoints, the contact form (honeypot, duplicate
suppression, rate limiting), sign-up → onboarding, tenant CRUD, role-based access
control (owner vs analyst), cross-tenant isolation (404s), server-side pricing,
the CSRF/origin guard, the staff-only platform surface (a tenant owner is rejected
from inbound leads), and connector configuration — including the SSRF guard and
the scheduled-sync entrypoint.

`connector:check` is the live one: it points a connector at a real public JSON API
and asserts the whole import path (connection probe, preview with the raw response,
mapping, rejected-row reporting, idempotent re-run, and the intelligence consuming
the result). It skips itself when the network is unavailable.
`connector:tester` is the credential-shaped half: against the local third-party
tester it asserts that a bad key comes back as the provider's own 401 body, that a
missing credential fails closed, and that a preview of the tester's store reports
its phone-less row as rejected. It skips itself when the tester is not running.
