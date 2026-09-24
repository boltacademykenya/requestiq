# Data connectors

ReorderIQ's intelligence is only as good as the order history behind it. A
*connector* is how that history gets in — from Zoho, Shopify, WooCommerce,
Paystack, a POS, an ERP, or any REST endpoint that returns JSON.

The important design decision: **a provider is configuration, not code.** There is
no `zoho.ts`. A connector is a declarative spec — endpoints, a field mapping, a
paging style — that `lib/connectors/**` interprets as data. Adding a provider is a
few-minute job in the UI, and a tenant whose system we have never heard of can
connect it themselves.

```
lib/connectors/
  config.ts    the spec (zod) + the canonical field list shared with the UI
  presets.ts   starting points for Zoho, Shopify, WooCommerce, Paystack, custom
  paths.ts     the mapping expression language (dot, [0], [*], {a} {b}, @literal)
  canonical.ts coercions + per-row validation -> customer / product / order
  fetch.ts     SSRF-hardened outbound JSON fetch
  request.ts   endpoint URL building + credential attachment
  secret.ts    AES-256-GCM sealing for stored credentials
lib/services/
  sync.ts      the engine: preview, run, schedule, run history
  ingest.ts    idempotent upserts keyed on the source system's identity
```

## Provider coverage

There are **four ready-to-configure third-party data providers**: Zoho Inventory,
Shopify, WooCommerce and Paystack. The fifth template, **Custom / any REST API**,
is the supported route for a company's own backend, POS, ERP, CSV-export service,
or another JSON API. It is a real connector, not sample data.

M-Pesa, WhatsApp Business and SMS are present in the wider product model because
they are payment or outreach channels, but they do **not** currently appear as
data-source templates. They should not be represented as order-history imports
until there is a supported ledger endpoint and a mapping that can be tested.

## Which providers to enable, and in what order

Order history is the product; customers alone produce no intelligence
(`orders.length < 2` yields a score of 10 and no prediction). So the priority is
whoever holds the *ledger*, not whoever has the nicest API.

| Tier | Provider | Why |
| --- | --- | --- |
| 1 | Zoho Inventory | Already the ICP's inventory system; contacts, items and sales orders in one place. |
| 1 | Shopify, WooCommerce | Storefronts with real order history and a documented REST API. |
| 1 | **Custom / any REST API** | Highest coverage of all. Kenyan SME history usually lives in a desktop POS, an ERP or a spreadsheet export — not on a documented API. This is also the onboarding tool and the on-premise path. |
| 2 | Paystack | A payment gives an exact amount and timestamp: the strongest possible input to the interval maths, and self-healing. |
| 3 | WhatsApp Business, SMS gateway | Makes the intelligence actionable. Note these are *outreach* channels, not data sources — they have no connector template. |

`GET /api/v1/integrations/presets` returns the templates the UI offers. They are
starting points: the tenant adjusts whatever their account differs on.

## Setting one up (UI)

`Workspace → Integrations → Add a source`.

1. **Connection** — display name, base URL, authentication, the credential, any
   static headers/query parameters, and the sync interval. **Test connection**
   sends one GET with exactly what is on screen (nothing is saved) and shows the
   endpoint's own answer: status, timing, headers and body. A stored credential is
   reused only when the credential field is blank.
2. **Resources & field mapping** — enable customers / products / orders and give
   each one an endpoint, a records path, a paging style and the field mapping.
   **Import API structure** can fill this in from a document the provider sent
   (see below), and every mapping input offers the paths of the last response as a
   pick-list.
3. **Test & preview** — reads one page and shows the mapped rows, *every row it
   would reject with the reason*, and the raw response it read. Nothing is written.
4. **Save draft → Activate.** A new connection is saved as `PENDING`, which is not
   a live state, so an unfinished connection can never sync by accident. Preview
   deliberately works on drafts; activating is an explicit step.

## Importing an API structure

A counterparty rarely hands over a working connector; they hand over *something
that describes their API*. The import panel accepts the three things that turn up
in practice, parses them **in the browser** (nothing is uploaded) and proposes form
values that the operator reviews:

| Input | What is read from it |
| --- | --- |
| A **sample response** (any JSON object or array) | The record list (`data`, `data.items`, a root array), the leaf paths of one record, the line-item list inside an order, and a suggested mapping. |
| An **OpenAPI / Swagger** document | The base URL (`servers[0].url`, or `host` + `basePath`), one GET collection endpoint per resource, the records path and field names from the 2xx JSON schema (`$ref`s resolved, arrays synthesised). |
| A **connector export** (this app's own spec, wrapped in `{ connector: … }` or bare) | The whole configuration: base URL, auth, endpoints, paging and mappings. Applied to the form as-is. Unknown top-level keys (`version`, `provider`, …) are ignored and reported. |

How the proposal is made, and its limits:

- **Records path.** The shallowest non-empty array of objects wins; at the same
  depth, conventional container names (`data`, `items`, `results`, …) are preferred.
  A root array means “the response is the list”. An array of scalars is never
  treated as records. A single object (one order, one customer) fills the field
  paths but leaves the records path to the operator.
- **Field mapping.** Suggestions come from the canonical field list and a
  deliberately conservative alias table. `phone` + `mobile` become
  `phone || mobile`; `first_name` + `last_name` become `{first_name} {last_name}` —
  both mapper syntax, not guesses. A field with no convincing alias is left
  **blank** rather than filled with something plausible: a blank input is visibly
  unfinished, a wrong mapping is invisibly wrong.
- **Endpoints from OpenAPI.** The last path segment is matched against per-resource
  nouns (`customers`, `contacts`, `products`, `orders`, `transactions`, …);
  non-templated paths beat `/{id}` variants. A document with relative `servers`
  URLs leaves the base URL for the operator.
- **Nothing is applied silently.** Suggestions fill only empty boxes unless
  *Replace existing mappings* is ticked, and a connector export is the only input
  that touches the whole form.

The same machinery powers the mapping pick-lists: after a **Test connection** or a
**Test & preview**, the leaf paths of the response are read with the *current*
records path, and every mapping input offers them (`Use this response in the
mapping` copies a response into the import panel when it is a payload the
operator wants to map from).

## Connector reference

### Connection

| Field | Notes |
| --- | --- |
| `baseUrl` | Root of the API, e.g. `https://www.zohoapis.com/inventory/v1`. |
| `auth.type` | `none`, `bearer`, `header`, `basic`, `query`. |
| `auth.header` | Header name for `header` auth. The credential is sent **verbatim**, so `Zoho-oauthtoken 1000.abc…` works as-is. |
| `auth.username` | Non-secret username for `basic` auth. |
| `headers` / `query` | Extra static values. Credential-looking names are rejected — put the secret in the credential field. |
| `timeoutMs` | Per-request timeout, 1–30s. |

A leading `/` on a resource path is relative to `baseUrl`, not to the host:
`baseUrl=https://host/inventory/v1` + `path=/contacts` →
`https://host/inventory/v1/contacts`. That is how provider docs read.

### Resources

| Field | Notes |
| --- | --- |
| `path` | Endpoint path, or an absolute `https://` URL. |
| `recordsPath` | Where the array of rows lives. Blank means the response *is* the array. |
| `query` | Static parameters for one resource only, such as Shopify orders' `status=any`. |
| `fields` | Canonical field → source path. |
| `values` | Optional enum translation: `{"status": {"confirmed": "COMPLETED"}}`. Keys are matched lower-cased. |
| `pagination` | `none`, `page`, `offset`, `cursor` or `link-header`. |
| `maxRecords` | Rows read per resource per run (1–10 000). |
| `moneyScale` | Multiplier for money fields. Paystack returns kobo, so `0.01`. |
| `referencePrefix` | Orders only: prepended to the external order id. Keep it stable. |
| `updatedSinceParam` | Query parameter for an incremental pull (`?updated_since=…`). |

### Mapping expressions

Field values are **data, never code** — nothing is evaluated.

| Expression | Meaning |
| --- | --- |
| `contact_name` | Object key. |
| `address.city` | Nested key. |
| `billing_addresses[0].city` | Array index. |
| `variants[0].sku` | Index into a nested array. |
| `user.api_key` | A *path* may contain "api_key"; only header/query *names* are restricted. |
| `phone \|\| mobile` | First non-empty field. Useful where a provider may use either key. |
| `{first_name} {last_name}` | Template: glues paths together (Shopify has no `name`). |
| `@BUSINESS` | Literal, not a path. |
| `@+25470000000{id}` | Literal + interpolation, for a source with no usable identifier. |
| `[*]` | Flattens a nested list (e.g. records path `orders[*].line_items`). |

A `[*]` in a *scalar* field is a mapping error and the row is rejected — importing
the first element silently would be worse.

### Canonical fields

Every source is reduced to three shapes, which is exactly what the database
stores. `*` = required; a row missing a required field is rejected with a reason.

**Customers** — `externalId`, `name`\*, `phone`\*, `email`, `location`, `customerType`

**Products** — `externalId`, `name`\*, `sku`, `category`, `unit`, `price`

**Orders** — `externalId`\* (becomes the reference), `customerExternalId`,
`customerEmail`, `customerPhone`, `orderedAt`\*, `status`, `currency`, `total`,
`paymentMethod`

**Order line items** (optional) — `productExternalId`, `productName`\*,
`quantity`\*, `unitPrice`

`GET /api/v1/integrations/presets` and the UI both read this list from one place,
so they cannot drift.

## Provider-specific setup notes

- **Zoho Inventory:** enter the organization ID in the connection-level query
  JSON and paste the full `Zoho-oauthtoken …` value into the credential field.
  Zoho requires `organization_id` on every request and access tokens expire, so
  a failed preview or sync after expiry must be given a fresh token.
- **Shopify:** enter an Admin API access token and replace `YOUR-STORE` in the
  base URL. The current REST template is deliberately versioned and configured
  with `status=any`, link-header pagination and `updated_at_min`. Shopify treats
  REST as legacy; new platform-only use cases should use a custom GraphQL bridge.
  Reading protected customer data and orders requires the corresponding scopes;
  orders older than 60 days require `read_all_orders` approval.
- **WooCommerce:** enter the consumer key as the Basic username and the consumer
  secret as the encrypted credential. The template uses `modified_after` so
  later syncs pull changed rows rather than repeatedly walking the whole store.
- **Paystack:** enter the secret key. The preset imports eligible customers and
  completed transactions, uses the documented `perPage` parameter and records
  amounts at the correct 0.01 minor-unit scale.

## What a sync does

1. **customers → products → orders.** Orders resolve their customer, so the order
   matters.
2. Each page is fetched, mapped and validated. A bad row is **counted and shown**,
   never silently dropped, and never aborts the run.
3. Rows are written idempotently (§ Identity below).
4. `lastOrderAt` is rebuilt from completed purchases and the affected customers'
   opportunities are recomputed, so pending, failed and cancelled records never
   inflate spending or distort reorder timing.
5. The attempt itself is recorded in `sync_runs` — per-resource counts plus a
   sample of rejection reasons.

### Identity and idempotency

A re-run must update, never duplicate. Rows are matched in this order:

| Resource | Match order |
| --- | --- |
| Customer | this connection's alias in `customer_sources` → email (case-insensitive) → phone (digits only, so `+254 712 000 111` matches `0712000111`) |
| Product | `external_id` **within this connection** → SKU → name (case-insensitive) |
| Order | reference (the source's order id, prefixed and sanitised) |

Two rules make that safe with more than one source connected:

- **Ids are namespaced per connection, not per provider.** `external_source` holds
  the connection id, so two Shopify stores can each have an order `12345` without
  one matching the other's customer or catalogue row. A store's own id is never
  looked up in another store's namespace.
- **An ambiguous natural key is rejected, not guessed.** If an email or a phone
  resolves to two canonical customers — or the email points at one and the phone
  at another — the row is counted as rejected with a `needs review` reason and
  appears in the run's rejection sample. Merging the wrong histories is invisible
  and permanent; a queued rejection is neither. Merge the duplicates
  (Customers → *Merge…*) and re-run the sync.

Consequences worth knowing:

- **Keep `referencePrefix` stable.** Changing it makes every order look new.
- **History keeps its own amounts.** An imported order's `unitPrice` and `total`
  come from the source, not from today's catalogue — re-pricing three-year-old
  orders would silently rewrite the interval maths. The catalogue is used only to
  link a line to a product, and as a price fallback when the source has none.
- **Nothing is deleted.** Absence from a sync never removes a record; customers
  and products are soft-deleted only by hand.
- **An alias is never repointed.** Once a connection has claimed a customer id,
  later syncs refresh that alias instead of handing the id to another customer.

## Provenance: where a customer came from

A canonical customer is one identity with **many** aliases — the same buyer may
live in an ERP, a storefront and a payment provider. `customer_sources` records
one row per (customer, connection), which is what the customers page displays.

| Question | Answer |
| --- | --- |
| Which platform is this customer from? | The **Source** column, one badge per connection (a customer known to two systems gets two). |
| Was this customer imported at all? | No `customer_sources` rows means **Manual** — added by hand in the workspace, not "unknown platform". |
| When was it last refreshed? | Per badge: the connection's `last_synced_at`, and any connection not `CONNECTED` is marked. |
| Show me only one platform's customers | The source filter on the customers page (`?source=<integration id>`), which filters on the alias table. |
| This record is wrong — pull it again | **Refresh** on the customer row. |

### More than one connection per provider

Connecting the same provider twice is supported and expected (two Shopify stores,
two Zoho organizations). Two things identify a connection, in this order:

1. `externalAccountId`, when the provider tells you which account it is;
2. otherwise the **display name**.

So when adding the second store, give it its own display name — saving with the
same name and no account id is treated as re-configuring the existing connection,
not as adding another one. Each connection then keeps its own record-id
namespace, its own aliases, and its own row in the customers page's source filter.

### Which source owns the contact fields

With several sources, "who wins" must be a policy rather than whichever sync ran
last. Set `masterCustomer: true` in one connection's `config` — the system of
record for names, phones, emails and locations. That connection owns those fields
for the customers it knows; every other source still contributes its orders and
its alias, but cannot overwrite the master's contact data. With no master, the
newest sync still wins, which is the old behaviour.

### Refreshing one customer

There is deliberately no "fetch this one record" operation in the connector spec,
so the honest action is **re-run the connections that know this customer**:
`POST /api/v1/customers/{id}/refresh` looks up the customer's aliases, runs each
distinct connection's normal sync, and reports per connection whether it synced,
was skipped (a run was already in flight) or failed. A customer with no aliases
has nothing to refresh. Because this reads a tenant's external systems it needs
`integration:manage` (OWNER/ADMIN), not `customer:write`.

### Merging duplicates

`POST /api/v1/customers/{id}/merge` with `{"duplicateId": "…"}` merges a duplicate
into the customer being kept:

- the survivor keeps its id, so links, messages and opportunities stay valid;
- the duplicate's orders, aliases, messages and opportunity rows are repointed —
  clash rows (a campaign the survivor is already in, an opportunity for the same
  expected date, an alias the same connection already holds) are dropped first;
- contact details the survivor was missing (email, location, salesperson, notes)
  are filled in from the duplicate;
- `last_order_at` is rebuilt from the merged history, because the survivor's most
  recent order may have belonged to the duplicate;
- the duplicate is **soft-deleted**, never hard-deleted, and the merge is written
  to the audit log (`customer.merged`) with both ids.

This is the only safe way to fix a duplicate: two canonical customers holding half
a purchase history each produce wrong intervals, wrong confidence and wrong
reorder prompts.

## Credentials

- Stored **AES-256-GCM sealed** (`lib/connectors/secret.ts`), keyed by scrypt from
  `INTEGRATION_SECRET_KEY`, salted per record.
- **Write-only.** No endpoint returns a credential; `IntegrationDto` exposes
  `hasCredential` only.
- **Fails closed.** With `INTEGRATION_SECRET_KEY` unset, storing a credential is
  refused (503) and nothing is written in plaintext.
- **Rotation** invalidates stored credentials by design; the operator re-enters
  them and the connection reports a credential error until they do.
- `integrations.secret_ref` remains for deployments that front a managed secret
  store, and `config` still rejects credential-looking keys.

## Scheduling

The sync engine is driven by an **HTTP entrypoint** rather than an in-process
timer, so the same code serves a single VPS and a serverless deployment:

```bash
curl -X POST https://…/api/v1/integrations/sync-due \
     -H 'x-cron-secret: …' -H 'content-type: application/json' -d '{"limit":5}'
```

Point any scheduler at it — Inngest, a cron container, cron-job.org, Kubernetes
CronJob. Every 15 minutes is plenty; each connection is only picked up when its own
slot has arrived.

- `x-cron-secret` is compared in constant time against `SYNC_CRON_SECRET`, and an
  **unset secret disables the endpoint** (403) rather than opening it.
- A due connection is **claimed** with a conditional update before the work starts,
  so overlapping scheduler runs cannot sync the same tenant twice.
- A failed run schedules a retry in **15 minutes** instead of the normal interval,
  and `ERROR` stays a live state so that retry actually happens. Only `PENDING` and
  `DISCONNECTED` are excluded.
- If a manual sync is already running for a connection, the tick **skips** it rather
  than recording a failure — the claim has already moved its slot forward, so it is
  picked up on the next tick. Skips are reported separately in the response
  (`{attempted, succeeded, failed, skipped, results}`).

## One run at a time

A connection can only ever have one run in flight, and that guarantee is enforced
by the **database**, not by a check in application code:

```sql
-- sync_runs_one_running_per_integration
CREATE UNIQUE INDEX … ON sync_runs (integration_id) WHERE status = 'RUNNING';
```

A loser is refused with **409** (`A sync is already running for this connection.`)
and starts nothing. This covers every combination — two people clicking "Sync now",
or a scheduled tick colliding with a manual run — because both paths enter through
the same claim.

The reason is not tidiness. A run rewrites each imported order's line items
(delete, then insert). Two runs writing the same order concurrently can interleave
under `READ COMMITTED` and leave the lines duplicated, which silently inflates
quantities and distorts the reorder intervals the engine predicts from. Rows that
look fine but carry double quantities are far worse than a refused sync.

A `RUNNING` row older than **30 minutes** is assumed to belong to a process that
died mid-sync and is retired as `FAILED` (`Interrupted before it finished`), so one
hard kill cannot block a connection forever.

## Security

Whatever a tenant types as a base URL is a URL this server will call, which turns
it into a proxy into its own network. `lib/connectors/fetch.ts` therefore:

- allows only `http(s)`, and only `https` in production;
- refuses credentials embedded in the URL;
- **resolves the hostname first, validates every address it maps to** against
  loopback, private, link-local, CGNAT, benchmarking, documentation and multicast
  ranges (including `169.254.169.254`, the cloud metadata endpoint), and then pins
  the socket to the validated address — a second, unvalidated lookup would be a
  DNS-rebinding hole;
- follows redirects manually, re-validating each hop, and bounds them;
- caps responses at 5 MB and each request by timeout.

On-premise sources (an ERP on the office LAN, a local Zoho) are the one legitimate
exception and must opt in explicitly:

```
INTEGRATION_ALLOW_PRIVATE_NETWORKS=true
```

Also: mapping expressions are never evaluated as code; sync, preview and connection
tests are rate limited (6 runs / 5 min, 30 previews / 5 min, 30 probes / 5 min per
user); every tenant query filters `organization_id` from the session, so another
tenant's connection id resolves to **404**, not 403; and `integration:manage` is
OWNER/ADMIN only, so an ANALYST can read connections but cannot change, sync or
credential them.

Two consequences of the diagnostics the editor shows:

- A response body is **redacted** before it crosses the wire: credential-bearing
  headers and cookies are dropped, credential-looking JSON keys are replaced, the
  exact credential the request used is removed wherever the provider echoes it, and
  the body is capped (the UI marks a truncated body). A 5 MB dataset never becomes
  a diagnostic view.
- A request that **reached** the endpoint and came back unhappy (401, 404, an HTML
  error page, a records path that matched nothing) is returned as `data` with the
  raw response, because showing it is the point. A refusal that never reached the
  endpoint — a blocked address, a DNS failure, a timeout, a missing credential —
  stays an HTTP error, so the SSRF guard keeps its 403 and there is no response to
  pretend otherwise.

## Monitoring a connection

- `POST /api/v1/integrations/test` — **Test connection**: one GET with a connector
  connection (base URL, auth, headers, query) from the request body or the form;
  optional `integrationId` reuses a stored credential; optional `path` picks what
  to probe (default: the base URL). Works before anything is saved.
- `POST …/{id}/preview` — dry-run a resource: mapped rows, rejections, and the raw
  response with `error` set when the read failed.
- `POST …/{id}/sync` — run now; the response carries the run with its counts.
- `GET …/{id}/runs` — recent attempts, per-resource created/updated/rejected and
  the rejection reasons.
- `integrations.last_error` / `last_synced_at` / `next_sync_at` feed the table.

`last_synced_at` alone is not evidence of health — a run that read nothing still
"synced". Check the counts.

### Where the UI lives

The Integrations tab keeps its integrations in a **sidebar**, and **each provider
is its own page**: the sidebar lists "All connections" plus Zoho Inventory,
Shopify, WooCommerce, Paystack and custom REST — each with a live status dot.
A provider with more than one connection gets **one entry per connection**
(labelled `<Provider> · <connection name>`), because two stores have their own
credential, schedule and run history — a single "Shopify" tab could only ever
show one of them.

Selecting an entry shows that provider's page with the connection status, the
provider-specific editor and the run history. The per-provider registry is one
small list
(`PROVIDERS` in `components/workspace/integrations-tab.tsx`); the page itself is
provider-agnostic (`components/workspace/integrations-connector-page.tsx`) and
takes everything provider-specific from the preset above.

Adding or changing a provider touches exactly two places, both configuration:

1. the template in `lib/connectors/presets.ts` (the backend entity), and
2. one entry in `PROVIDERS`.

No component or route changes. Non-data channels (M-Pesa, WhatsApp Business,
SMS gateway) are payment/outreach plumbing, not sources — they never appear as
provider pages.

`last_synced_at` alone is not evidence of health — a run that read nothing still
"synced". Check the counts.

## Verification

```bash
pnpm typecheck                                   # types across the whole chain
pnpm ui:check                                    # renders the connector UI server-side
pnpm discovery:check                             # API-structure import, no server needed
pnpm guard:check                                 # the SSRF guard, no server/DB/network needed
BASE=http://localhost:3000 bash scripts/smoke.sh          # hermetic API assertions
BASE=http://localhost:3000 pnpm connector:check           # live end-to-end ingest
BASE=http://localhost:3000 pnpm connector:tester          # live credential/error-body check
```

`connector:check` points a real connector at `jsonplaceholder.typicode.com` and
asserts the full path — the connection probe, preview with the raw response,
mapping, rejection reporting, idempotent re-run, the intelligence consuming the
result, and tenant isolation. `connector:tester` does the same against the local
third-party tester for the parts a credential changes: a wrong key must come back
as the provider's own 401 body, a missing credential must fail closed, and a
preview must report the tester's phone-less row as rejected. Both skip themselves
when their endpoint is unavailable; the SSRF assertion is skipped when the
deployment has opted into private networks, which `guard:check` covers instead.

## Known limitations

- **A phone number is required for a customer.** `customers.phone` is `not null`
  in the domain, so an email-only storefront customer is rejected with a reason
  rather than imported. Relaxing that is a schema change (and a product decision
  about outreach), not a mapping tweak.
- **No OAuth flow.** Auth is a pasted credential, so an expiring token (Zoho's
  hourly token, for instance) must be rotated by hand. A refresh-token flow with
  the provider's authorize URL is the natural next step.
- **Cursors must live in the response body** (or in the `Link` header). An API
  that returns its next cursor in a custom header needs a small extension.
- **Runs are synchronous** within the request (`maxDuration = 300`). A first
  backfill of a large account should be run in slices via `maxRecords`.
- **No delta deletes.** A record deleted at the source stays here, soft-deleted or
  not. Nothing in the mapping expresses "this row disappeared".
- **Refreshing a customer refreshes its connections.** There is no single-record
  endpoint to call, so `customers/{id}/refresh` re-runs every connection holding
  an alias for that customer. A tenant whose only need is one record re-reads the
  whole source; a `singleRecord` resource block (a `path` carrying `{id}`) is the
  extension that would make it exact.
- **Payment-provider webhooks are not wired.** Paystack is polled as an order
  source; a signed webhook would be lower-latency and idempotent by design.
