# ReorderIQ — software limitations review

An evidence-based audit of the current implementation: what the software does not
do, what it does only partially, and where it will break under real load. Every
claim carries a `file:line` reference so it can be re-checked against the code.

- **Reviewed:** 22 September 2026, revision `6e396f2` (`main`)
- **Scope:** `app/`, `components/`, `lib/`, `scripts/`, `drizzle/`, configuration
- **Not in scope:** product/market fit, pricing strategy, UI visual design

## How this review was verified

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | Passes, 0 errors |
| Database | `pnpm db:check` | Connects; 20 tables; orgs 39, customers 230, orders 819, order items 1501 |
| Test runner | — | **None installed** (no Vitest/Jest/Playwright; no `*.test.*` or `*.spec.*`) |
| CI | — | **Absent** (no `.github/`) |
| Lint / format | — | **Absent** (no ESLint, Prettier or editorconfig) |
| Automated verification | `scripts/smoke.sh`, `scripts/connector-check.sh` | 72 assertions needing a live server + database; `connector:check` also needs the public internet |

So: the code typechecks and the schema is coherent. What is missing is
*behavioural* verification — nothing in the repository executes the prediction
engine, the ingest mapper, the SSRF guard or the money rounding in isolation.

## Severity summary

| # | Limitation | Severity |
| --- | --- | --- |
| 1 | Message delivery is a stub; campaigns report success without sending | Critical |
| 2 | Dashboard KPIs and campaign audiences silently truncated at 500 customers | Critical |
| 3 | No password reset and no email verification | Critical |
| 4 | No plan, seat or feature enforcement; no payment collection | High |
| 5 | Zero domain tests and no CI | High |
| 6 | Opt-out is not honoured by default | High |
| 7 | Scheduled campaigns never execute | High |
| 8 | No conversion or revenue attribution | Medium |
| 9 | Prediction/forecast heuristics with inconsistent headline numbers | Medium |
| 10 | Syncs are synchronous in-request, with an N+1 rebuild and no deletes | Medium |
| 11 | In-memory pagination; the UI cannot page past the first 25–50 rows | Medium |
| 12 | No observability, retention policy or API specification | Medium |
| 13 | Timezone-unaware, non-injectable time in the prediction engine | Low |
| 14 | Loose packaging: `my-project`, no `engines`, duplicated plan prices | Low |

## 1. Delivery is a stub — nothing reaches a customer

The largest gap between what the UI implies and what the system does.

| Finding | Evidence | Impact |
| --- | --- | --- |
| Dispatch writes `SENT` without any outbound call | `lib/services/campaigns.ts:166-210` (`status: 'SENT'`, `provider: 'DEMO'`); provider enum at `lib/db/schema.ts:90-95` | Message history and campaign metrics are fiction |
| The campaign is marked `COMPLETED` in the same request | `lib/services/campaigns.ts:212-216` | No `RUNNING` phase to observe, retry or reconcile |
| No worker, queue, retry or webhook; `DELIVERED` / `FAILED` / `RECEIVED` are never written by anything | Only `createMessage` (`campaigns.ts:289-303`) and dispatch write statuses | Provider failures are unrepresentable; `providerMessageId` (`lib/db/schema.ts:520`) is never populated |
| `SCHEDULED` campaigns never run | `scheduledAt` is stored (`campaigns.ts:87-88`, `schema.ts:464`) but nothing reads it — the only machine entrypoint is connector sync-due (`app/api/v1/integrations/sync-due/route.ts`) | A "scheduled" campaign sits forever; `RUNNING` is reachable only by hand via PATCH |
| No attribution | `revenueAttributed` appears only in `lib/db/schema.ts:493` — never written | Campaign ROI is unmeasurable; opportunity `CONVERTED` / `ORDER_CREATED` are manual-only (`app/api/v1/opportunities/[opportunityId]/route.ts:18-34`) |
| Providers advertised in `.env.example` are dead configuration | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`, `ZOHO_ORGANIZATION_ID`, `WHATSAPP_API_TOKEN`, `SMS_API_KEY` have **zero references** in `lib/`, `app/`, `components/`, `scripts/` | Operators configure variables that nothing consumes |

The design intent is documented (`docs/BACKEND.md:338-340`: "a worker (queue +
WhatsApp/SMS adapter) should pick up `QUEUED` rows"). What is missing is that
worker, plus the delivery-receipt path that would make `SENT` meaningful.

## 2. Analytics and audiences are silently capped

`lib/services/insights.ts:16-17` sets `MAX_CUSTOMERS = 500` and
`MAX_ORDERS_PER_CUSTOMER = 60`, and the load is ordered by `customers.name`
ascending (`insights.ts:59-64`). Every downstream number inherits the cap:

- dashboard KPIs, status distribution, revenue forecast and interval buckets
  (`insights.ts:214-236`);
- the opportunities written by `syncOpportunities` (`insights.ts:152-190`);
- **campaign audiences** — `resolveAudience` (`insights.ts:239-255`) is capped the
  same way, and dispatch slices further to `limit ≤ 500`
  (`lib/api/contracts.ts:230`).

A tenant with 5,000 customers therefore sees analytics computed from the first
500 alphabetically, and cannot run a campaign covering the rest. Nothing in the
API response or the UI signals that a cap was applied, so the numbers are not
merely partial — they are confidently wrong. `LARGE` plan copy promises "larger
data capacity" (`lib/services/plans.ts:41`) with no code path that grants it.

## 3. Account lifecycle: no password reset, no email verification

- **Email verification is never enforced.** `emailAndPassword` is configured with
  only length limits (`lib/auth.ts:40-44`); `requireEmailVerification` is absent
  and `user.emailVerified` (`lib/db/schema.ts:138`) is never written or checked.
  Anyone can register an address they do not own.
- **Password reset does not exist.** `sendResetPassword`, a mail transport and an
  email provider are absent from the entire repository. A user who forgets their
  password is locked out permanently without direct database intervention.
- The same missing mail provider is why `addMember` can only add existing
  ReorderIQ accounts (`lib/services/organizations.ts:190-208`, acknowledged at
  `docs/BACKEND.md:344-345`).

Both flows are table stakes for a paying B2B tenant, and both share one root
cause: no outbound email capability.

## 4. Money does not move, and plans are decorative

- **No payment collection.** `lib/services/billing.ts:59-104` only mutates the
  subscription row; `MPESA` / `PAYSTACK` / `INVOICE` are labels and
  `external_reference` is unused (acknowledged at `docs/BACKEND.md:341-343`).
- **No plan enforcement anywhere.** `lib/services/plans.ts:18-51` defines seats
  (3 / 8 / 25 / 50) and feature lists, but `addMember`
  (`lib/services/organizations.ts:195-239`) performs no seat check, no feature
  gate and no usage limit, and `CUSTOM` is priced 0. Verified by search: `seats`
  appears only in contracts, DTO, schema, mapper and the organisation bootstrap.
- **Duplicated price catalogue.** `lib/services/plans.ts:6` states the prices
  "mirror `lib/pricing.ts`" — two hand-synchronised sources of truth with no test
  asserting they agree.
- **No invoicing, dunning or tax handling.** `currentPeriodEnd` is written once at
  onboarding (`organizations.ts:93-103`) and never advanced; nothing expires or
  suspends a `TRIALING` tenant.

So the pricing page describes a business model the software cannot charge for or
enforce.

## 5. Prediction quality and analytics correctness

- **Hard-coded heuristics, no learning.** Score weights 0.3 / 0.35 / 0.2 / 0.15
  (`lib/reorder/analytics.ts:40`); confidence `92 − 2.4σ + 1.2·min(orders,8)`
  clamped to 34–98 (`:19-24`); status thresholds 60 / 8 / 1 / 0 / −3 days
  (`:43-53`); prediction = last order + (0.3·median(all) + 0.7·median(last 5))
  (`:69-71`). No seasonality, trend, product mix, returns/refunds, or backtested
  accuracy.
- **The consistency metric is anchor-dependent.** `analytics.ts:32-36` measures
  variance against `intervals[0]` instead of the mean, so the same purchase
  history scores differently depending on which interval happened to come first.
- **`probability` is not a probability.** `analytics.ts:211-213` is a linear blend
  (`score·0.6 + confidence·0.4`), yet it weights the forecast and ranks the
  pipeline.
- **The forecast and the headline KPI cannot be reconciled.**
  `computeRevenueForecast` counts a customer only when the predicted date lands
  inside the next 14 days (`analytics.ts:165-178`), while
  `computeKpis.predictedRevenue` sums AOV × confidence for *every* customer with
  no horizon at all (`:191-195`). Overdue customers are excluded from the chart
  but included in the number beside it. `expectedValue` persisted on opportunities
  is simply average order value (`lib/services/insights.ts:164`).
- **No product-level prediction.** `recommendedProducts` is a top-3 raw purchase
  count (`analytics.ts:74-80`) — no SKU-level interval or value model, no basket
  analysis, and the campaign template interpolates only `recommendedProducts[0]`
  (`lib/services/campaigns.ts:201-204`).
- **Status transitions are not derived from outcomes.** Nothing closes an
  opportunity when an order arrives; `deriveOpportunityStatus`
  (`insights.ts:132-146`) only maps customer status, and `CONVERTED` /
  `ORDER_CREATED` are manual edits.
- **Timezone-unaware, non-injectable time.** `new Date()` is evaluated at call
  time inside status, prediction and forecast logic
  (`analytics.ts:37, 46-47, 166`) and the calendar-day maths uses the *server's*
  timezone. `organizations.timezone` (`lib/db/schema.ts:221`) is stored but never
  read, so `DUE_TODAY` can flip relative to the tenant's local day, and no clock
  can be injected for deterministic tests.
- **Multi-currency totals are mixed.** Each order stores its own `currency`
  (`schema.ts:352`) but the dashboard formats everything with `formatKes`
  (`lib/pricing.ts`, used by `components/workspace/overview-tab.tsx:52-129`) as
  `KSh`, while the orders table renders each row's own currency
  (`orders-tab.tsx:232`). There is no FX rate, so any tenant transacting in more
  than one currency gets meaningless sums.

## 6. Data plumbing limits

- **Syncs run inline in the HTTP request.** `maxDuration = 300` on both the manual
  and scheduled entrypoints (`app/api/v1/integrations/[integrationId]/sync/route.ts:11`,
  `app/api/v1/integrations/sync-due/route.ts:9`). A large first backfill occupies a
  web worker and must be sliced by hand with `maxRecords`
  (acknowledged at `docs/BACKEND.md:359-360`).
- **N+1 post-sync rebuild.** `applyLastOrderAt` issues one `max()` query plus one
  update *per affected customer* (`lib/services/ingest.ts:511-536`), and
  `syncOpportunities` then recomputes full insights for those customers
  (`lib/services/insights.ts:152-190`) — all serial inside the request.
- **No delta deletes or tombstones.** A record deleted at the source is never
  removed here (`docs/BACKEND.md:361`); totals and statuses drift until the source
  reports a status change. There is no reconciliation pass or `deleted_at`.
- ~~**One credential per provider per organisation.**~~ **Addressed since this
  review.** The `(organization_id, provider)` unique index is gone; connections
  are unique on `(organization_id, provider, external_account_id)` and external
  ids are namespaced per connection, so multi-store connections now work
  (`docs/INTEGRATIONS.md`, "Provenance: where a customer came from").
- **Pasted credentials, no OAuth refresh.** A Zoho token expires hourly and must be
  re-entered; rotating `INTEGRATION_SECRET_KEY` invalidates every stored credential
  (`lib/connectors/secret.ts:20-22`).
- **Rejections are only summarised.** A run keeps counts plus at most 25 distinct
  reasons (`lib/services/ingest.ts:47-52`, stored in `sync_runs.counts`,
  `schema.ts:592-595`) — there is no per-row rejection report to hand an operator.
- **Customers must have a phone.** `customers.phone` is `not null`
  (`schema.ts:304`), so an email-only source row is rejected rather than imported
  (acknowledged at `docs/BACKEND.md:357-358`).
- **Source-side field ownership is opt-in.** A connection marked
  `config.masterCustomer` owns the contact fields and other sources can no longer
  overwrite them, but with no master nominated the newest sync still wins — so a
  hand-corrected name on such a customer is reverted by the next run. Field-level
  survivorship (per field, per source) is still absent.

## 7. Performance and scale

- **Insights are recomputed from raw rows on every request.** `loadCustomerInsights`
  runs per customers list, per dashboard load and per recompute; there is no
  materialised rollup or cache. `loadOverview` may additionally trigger a whole-org
  `syncOpportunities` on first load (`lib/services/insights.ts:218-222`).
- **Customer pagination is in-memory.** `lib/services/customers.ts:53-75` loads up
  to 500 insights, sorts in JavaScript and resolves the cursor with `findIndex` —
  pages can skip or repeat under concurrent writes, and past page 20 the data is
  unreachable regardless of cursor.
- **The UI cannot page at all.** No component reads `nextCursor` (no references in
  `components/`); each tab renders the first page plus "Showing X of Y"
  (`components/workspace/ui.tsx:165-172`), so lists are effectively frozen at the
  25–50 rows the tabs request.
- **Rate limiting costs a database write per request.** `enforceRateLimit` performs
  an upsert on every call (`lib/api/rate-limit.ts:46-53`) and performs a
  full-table `DELETE` with 1% probability *on the request path* (`:58-63`) → hot-row
  contention and latency outliers. Fixed windows also allow a 2× burst at
  boundaries.
- **Pool ceiling versus sync budget.** `max: 10` connections with a 15s
  `statement_timeout` / `query_timeout` (`lib/db/client.ts`) while a sync is allowed
  300s: a long-running write can be killed mid-run, leaving a `RUNNING` row that the
  partial unique index then refuses to let a retry replace
  (`schema.ts:610-612`).
- **Unbounded tables.** `audit_logs` and `sync_runs` have no retention or pruning;
  only `rate_limit_counters` cleans itself up opportunistically.
- **The scheduler is strictly serial.** `runDueIntegrations` processes due
  connectors one at a time with a single batch limit
  (`lib/services/sync.ts:609-663`): one slow tenant delays every other tenant's
  sync.
- **No caching layer, no CDN strategy for API data.** Every response is
  `Cache-Control: no-store` by design (`lib/api/response.ts:10-13`), which is
  correct for tenant isolation but means no read scaling beyond the database.

## 8. Security, compliance and account lifecycle

- **Opt-out is inverted by default.** `marketingOptIn` defaults to `true` in both
  the schema (`lib/db/schema.ts:310`) and the create contract
  (`lib/api/contracts.ts:108`), while dispatch filters on it only when
  `marketingOptInOnly === true` — optional and unset by default
  (`contracts.ts:203`, `lib/services/insights.ts:247`). A campaign created with the
  default audience can therefore queue messages to customers who opted out. There
  is no suppression list, no unsubscribe link in the template renderer
  (`lib/services/campaigns.ts:50-52`) and no per-customer consent history.
- **No DSAR path.** No account deletion, data export or erasure flow exists;
  customer deletion is a soft flag (`lib/services/customers.ts:162-185`). Free-text
  PII in `customers.notes` and hashed IPs in `audit_logs` have no retention policy.
- **One secret protects two things.** `ipHashSecret()` falls back to
  `BETTER_AUTH_SECRET` (`lib/env.ts:109-111`) and `IP_HASH_SECRET` is optional;
  IPv4's small address space makes those hashes brute-forceable if that single
  secret leaks.
- **Client IP trust depends on proxy hygiene.** `clientIp` accepts `x-real-ip`
  then the first `x-forwarded-for` entry (`lib/api/request-identity.ts`); without a
  rewriting proxy, rate limits and audit forensics can be evaded by rotating the
  header.
- **The audit trail is best-effort.** Write failures are logged and swallowed
  (`lib/api/audit.ts:30-32`), so "append-only trail" is not guaranteed; there is no
  tamper-evidence (hash chaining) and no retention policy.
- **CSP allows inline scripts on prerendered pages.** `proxy.ts:38-42` gives
  `/`, `/pricing`, `/faq` and friends `script-src 'unsafe-inline'` because their
  hydration payload is built ahead of time; only `/workspace` and `/admin` get the
  nonce + `strict-dynamic` policy (acknowledged at `docs/BACKEND.md:349-352`).
  `style-src 'unsafe-inline'` is required by Recharts inline styles.
- **No MFA, SSO, or session management.** There is no second factor, no device
  list, no "revoke other sessions", and no login anomaly alerting. Session cookies
  are additionally cached client-side for up to 5 minutes
  (`lib/auth.ts:48`), so revoking a membership or suspending a member does not
  invalidate the cached token immediately.
- **Platform surface is an email allowlist** gated by `PLATFORM_ADMIN_EMAILS`
  (`lib/env.ts:120-131`), which fails closed — but access to the inbound-lead inbox
  is not itself audited.
- **No secret scanning or dependency auditing** in the pipeline, and
  credential-like config keys are rejected by a naming heuristic rather than by
  construction (`docs/BACKEND.md:307`).

## 9. Engineering process and operations

- **Zero domain tests.** No test runner is installed and there are no test files;
  the prediction maths, ingest normalisation, money rounding and the SSRF guard in
  `lib/connectors/fetch.ts` are exercised only indirectly by two shell suites that
  need a live server, a database and (for `connector:check`) the public internet.
- **No CI.** There is no `.github/` workflow: `typecheck`, `build`, `smoke.sh` and
  `connector:check` are run by hand, so a broken build or a failing assertion can
  reach `main` unnoticed.
- **No lint or format configuration.** ~15,000 lines of TypeScript/TSX are guarded
  by `tsc` alone; there is no ESLint, Prettier or editorconfig.
- **No observability.** Errors are `console.error` only
  (`lib/api/route.ts:85-90`); there are no metrics, traces or error-reporting
  integration. `/api/v1/health` proves the database answers a `select` and nothing
  more. The only sync signal is `integrations.lastError` plus `sync_runs`.
- **No API specification.** The contract lives in prose tables in
  `docs/BACKEND.md`; there is no OpenAPI document, so external consumers cannot
  generate a client or diff the surface.
- **Deployment assets are missing.** No Dockerfile, compose file or IaC. Boot
  migrations run only when `VERCEL_ENV` is unset or `production`
  (`lib/db/migrate.ts:156-159`): a Vercel staging/preview host never migrates, while
  a non-Vercel staging host always does.
- **Packaging loose ends.** `package.json` is still named `my-project`, has no
  `engines` field despite the documented Node 22+ / pnpm 10+ requirement, and no
  script runs the smoke suite in CI.
- **No load or soak testing.** The two number-one scale assumptions — the
  500-customer insight cap and a database write per rate-limited request — have
  never been exercised under concurrency.
- **Provider configuration is aspirational.** `.env.example` documents `ZOHO_*`,
  `WHATSAPP_API_TOKEN` and `SMS_API_KEY`; no code reads them (see §1), so the
  documented integration surface is larger than the implemented one.

## 10. Already documented versus newly identified

`docs/BACKEND.md:336-361` already records: DEMO-only messaging, no payment
collection, no email invitations, in-memory pagination for computed lists, CSP
`unsafe-inline` on prerendered pages, pasted (non-OAuth) credentials,
phone-required customers, synchronous connector syncs, and no delta deletes. Those
are restated above with their blast radius, but they are not discoveries.

The findings below were **not** previously written down anywhere in the repository:

| # | New finding | Section |
| --- | --- | --- |
| 1 | Campaign audiences and every dashboard KPI are silently capped at the first 500 customers (alphabetically, 60 orders each) — a correctness bug, not just a scale limit | §2 |
| 2 | `SCHEDULED` campaigns never execute, and dispatch records `SENT` / `COMPLETED` with no delivery path | §1 |
| 3 | No password reset and no email verification exist at all | §3 |
| 4 | Zero automated tests and no CI; no test runner is even installed | §9 |
| 5 | Opt-out is not honoured unless the campaign explicitly asks for it | §8 |
| 6 | No plan, seat or feature enforcement; the plan catalogue is duplicated in two files | §4 |
| 7 | `revenueAttributed` and opportunity conversion states are never populated, so ROI is unmeasurable | §1, §5 |
| 8 | A `sync_runs` row can be stranded in `RUNNING` because the 15s query timeout is shorter than the 300s sync budget, which then blocks retries via the partial unique index | §7 |
| 9 | The Zoho, WhatsApp and SMS variables in `.env.example` are dead configuration — no code reads them | §1, §9 |
| 10 | Forecast chart and headline KPI cannot be reconciled; `probability` is an uncalibrated blend | §5 |
| 11 | The consistency term in the reorder score is anchored to `intervals[0]` instead of the mean | §5 |
| 12 | Manual corrections to imported customers and products are silently reverted by the next sync | §6 |

## 11. Remediation order

Sequenced by risk removed per unit of effort. Effort is a rough shape, not an
estimate.

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| 1 | Honour opt-out by default (`marketingOptInOnly` should default true at dispatch, or filter unconditionally), and add an unsubscribe line to templates | Legal/reputational exposure in a WhatsApp/SMS market; one-line change plus tests | Hours |
| 2 | Make the 500-customer / 60-order caps explicit: raise them, paginate insights, or surface "computed from N of M customers" in the API and UI | Silent wrong numbers undermine every dashboard and campaign | Days |
| 3 | Add password reset + email verification behind a mail provider (Resend/SES/SMTP), and enforce `requireEmailVerification` | Users cannot recover accounts today | Days |
| 4 | Introduce a test runner (Vitest) and CI. Start with the pure modules — `lib/reorder/analytics.ts`, `lib/connectors/canonical.ts`, `isBlockedAddress` in `lib/connectors/fetch.ts`, the cursor helpers in `lib/api/response.ts` — then add a CI job running `typecheck`, `build` and `smoke.sh` against a disposable Postgres | Nothing can be refactored safely without this | Days |
| 5 | Plan enforcement: seat checks in `addMember`, feature gates where plans differ, and single-source the plan catalogue from `lib/pricing.ts` | The pricing page currently promises what the code ignores | Days |
| 6 | Delivery worker plus `QUEUED → SENT → DELIVERED/FAILED` transitions, a provider adapter interface with the existing `DEMO` adapter, and a scheduled-campaign runner that also fixes `SCHEDULED` campaigns never firing | Same subsystem as priorities 1 and 7 | Weeks |
| 7 | Attribution: set `revenueAttributed` and close opportunities (`ORDER_CREATED` / `CONVERTED`) when an order lands for a contacted customer | Unlocks the ROI story the product sells | Days |
| 8 | Replace in-request syncs with a job (queue or the cron entrypoint with bounded slices), make `applyLastOrderAt` a single set-based update, and reconcile `statement_timeout` against sync duration | Removes the stranding risk and the N+1 rebuild | Week |
| 9 | Observability: structured logging with request id, error reporting, and counters for sync outcomes and rate-limit rejections; retention jobs for `audit_logs`, `sync_runs` and `rate_limit_counters` | You cannot operate what you cannot see | Days |
| 10 | Consistency pass: timezone injection and `organizations.timezone` in the engine, multi-currency either supported or rejected at write time, UI pagination using the existing `nextCursor`, OpenAPI generated from the Zod contracts | Pays down correctness debt that will otherwise compound | Weeks |

## Re-verifying this review

```bash
pnpm typecheck                                  # expected: clean
pnpm db:check                                   # connectivity + table inventory
BASE=http://localhost:3000 bash scripts/smoke.sh   # needs a running server
grep -rn 'maxDuration' app/api                   # sync budgets
grep -rnE 'MAX_CUSTOMERS|MAX_ORDERS_PER_CUSTOMER' lib/services/insights.ts
grep -rn 'revenueAttributed' lib app components  # expected: schema only
grep -rnE 'sendResetPassword|requireEmailVerification' lib app   # expected: empty
```

Treat this document as a living inventory: when a limitation is fixed, delete its
row here and, if it was previously listed in `docs/BACKEND.md`, remove it there
too. Anything that survives a release without a test covering it belongs back in
§9.
