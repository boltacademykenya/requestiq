import { and, asc, desc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm'
import { writeAuditLog } from '@/lib/api/audit'
import type {
  ConnectorConnectionTestDto,
  ConnectorPreviewDto,
  ConnectorPresetDto,
  SyncResultDto,
  SyncRunDto,
} from '@/lib/api/dto'
import { ApiError, pgErrorCode } from '@/lib/api/errors'
import {
  emptyRunCounts,
  normaliseCustomer,
  normaliseOrder,
  normaliseProduct,
  recordRejection,
  type NormalisedOrder,
  type SyncRunCounts,
} from '@/lib/connectors/canonical'
import type {
  ConnectorConfig,
  ConnectorConnectionConfig,
  ConnectorResourceConfig,
  ConnectorOrdersResourceConfig,
} from '@/lib/connectors/config'
import { presentHttpResponse } from '@/lib/connectors/diagnostics'
import { fetchJson, nextLinkFromHeader, type HttpResponseCapture, type JsonFetchResult } from '@/lib/connectors/fetch'
import { collectRecords, readPath } from '@/lib/connectors/paths'
import { connectorPreset, listConnectorPresets } from '@/lib/connectors/presets'
import { authHeaders, authQuery, requiresCredential, resolveEndpoint } from '@/lib/connectors/request'
import { decryptCredential } from '@/lib/connectors/secret'
import { db } from '@/lib/db/client'
import { toIntegrationDto, toSyncRunDto } from '@/lib/db/mappers'
import { integrations, organizations, syncRuns } from '@/lib/db/schema'
import type { IntegrationRow, SyncRunRow, SyncTrigger } from '@/lib/db/schema'
import { applyLastOrderAt, upsertCustomers, upsertOrders, upsertProducts, type IngestActor } from './ingest'
import { syncOpportunities } from './insights'

/**
 * The sync engine.
 *
 * A run reads each enabled resource, maps it to canonical rows and writes them
 * through `lib/services/ingest.ts`. Resources are processed customers -> products
 * -> orders, because orders resolve their customer. Afterwards the affected
 * customers' opportunities are recomputed, so a sync ends with fresh
 * intelligence rather than just fresh rows.
 *
 * Every attempt is recorded in `sync_runs` with per-resource counters and a
 * sample of rejection reasons. A failure never aborts the whole fleet: the
 * scheduler moves on to the next tenant.
 */

export type ConnectorResource = 'customers' | 'products' | 'orders'

/** Traffic is bounded on purpose: a tenant may not exhaust memory with one run. */
const RESOURCE_ORDER: ConnectorResource[] = ['customers', 'products', 'orders']

/* -------------------------------------------------------------------------- */
/* Fetching                                                                   */
/* -------------------------------------------------------------------------- */

type ResourceFetch = { records: unknown[]; endpoint: string; pages: number }

type FetchContext = {
  config: ConnectorConfig
  resourceName: ConnectorResource
  resource: ConnectorResourceConfig
  path: string
  credential: string | null
  updatedSince: string | null
  /** Stop after the first page (the preview path). */
  singlePage?: boolean
  maxRecords?: number
  /**
   * Diagnostics hook. The preview keeps the last response so the operator can read
   * it; a sync run leaves this undefined and never pays for decoding the body twice.
   */
  onResponse?: (capture: HttpResponseCapture) => void
}

/** Names the top-level keys of a response, to explain a mapping mistake. */
function describeJson(root: unknown): string {
  if (root === null || root === undefined) return 'an empty body'
  if (Array.isArray(root)) return `an array of ${root.length}`
  if (typeof root !== 'object') return `a ${typeof root}`
  const keys = Object.keys(root as Record<string, unknown>)
  if (!keys.length) return 'an empty object'
  return `keys: ${keys.slice(0, 10).join(', ')}${keys.length > 10 ? ', …' : ''}`
}

/**
 * Reads a page and, on the first one, fails loudly when the records path matches
 * nothing.
 *
 * Without this, a mistyped `recordsPath` reads as "the source has no rows" — a
 * silent no-op that looks like a healthy sync. An *empty* array is legitimate and
 * passes; a path that resolves to nothing does not.
 */
function readPage(result: JsonFetchResult, context: FetchContext, isFirst: boolean): unknown[] {
  if (isFirst && result.json !== null && result.json !== undefined) {
    const path = context.resource.recordsPath.trim()
    if (!path) {
      if (!Array.isArray(result.json)) {
        throw ApiError.unprocessable(
          `The "${context.resourceName}" endpoint returned an object, not a list. Set the records path to the field holding the rows (the response has ${describeJson(result.json)}).`,
        )
      }
    } else if (readPath(result.json, path) === undefined) {
      throw ApiError.unprocessable(
        `The records path "${path}" matched nothing in the response (the response has ${describeJson(result.json)}).`,
      )
    }
  }
  return collectRecords(result.json, context.resource.recordsPath)
}

function requestOptions(
  config: ConnectorConfig,
  credential: string | null,
  onResponse?: (capture: HttpResponseCapture) => void,
) {
  return {
    headers: { ...config.headers, ...authHeaders(config.auth, credential) },
    timeoutMs: config.timeoutMs,
    ...(onResponse ? { onResponse } : {}),
  }
}

/** Applies the connector's static query, its credential and an incremental cursor. */
function baseParams(context: FetchContext, extra: Record<string, string | number | undefined> = {}) {
  const params: Record<string, string | number | undefined> = {
    ...context.config.query,
    ...context.resource.query,
    ...authQuery(context.config.auth, context.credential),
    ...extra,
  }
  if (context.updatedSince && context.resource.updatedSinceParam) {
    params[context.resource.updatedSinceParam] = context.updatedSince
  }
  return params
}

/**
 * Reads one resource, following the configured paging style.
 *
 * The loop is bounded three ways (`maxPages`, `maxRecords`, and the provider
 * signalling it is done) so a broken cursor cannot spin forever.
 */
async function fetchResource(context: FetchContext): Promise<ResourceFetch> {
  const { config, resource, credential } = context
  const pagination = resource.pagination
  const maxRecords = context.maxRecords ?? resource.maxRecords
  const records: unknown[] = []
  /** Only used for diagnostics; the first request URL that was actually called. */
  let endpoint = ''
  let pages = 0

  if (pagination.mode === 'link-header') {
    let nextUrl: string | null = null
    for (let index = 0; index < pagination.maxPages; index += 1) {
      const initialPageSize = pagination.sizeParam ? { [pagination.sizeParam]: pagination.pageSize } : {}
      const url = nextUrl ?? resolveEndpoint(config.baseUrl, context.path, baseParams(context, initialPageSize))
      const result = await fetchJson(url, requestOptions(config, credential, context.onResponse))
      const page = readPage(result, context, index === 0)
      pages += 1
      endpoint = result.url
      records.push(...page)
      if (context.singlePage || records.length >= maxRecords) break
      nextUrl = nextLinkFromHeader(result.headers.link, result.url)
      if (!nextUrl) break
    }
    return { records: records.slice(0, maxRecords), endpoint, pages }
  }

  if (pagination.mode === 'cursor') {
    let cursor: string | null = null
    for (let index = 0; index < pagination.maxPages; index += 1) {
      const extra: Record<string, string | number> = {}
      if (pagination.sizeParam) extra[pagination.sizeParam] = pagination.pageSize
      if (cursor) extra[pagination.param ?? 'cursor'] = cursor
      const result = await fetchJson(
        resolveEndpoint(config.baseUrl, context.path, baseParams(context, extra)),
        requestOptions(config, credential, context.onResponse),
      )
      const page = readPage(result, context, index === 0)
      pages += 1
      endpoint = result.url
      records.push(...page)
      if (context.singlePage || records.length >= maxRecords) break
      const nextValue = pagination.cursorPath ? readPath(result.json, pagination.cursorPath) : null
      cursor = nextValue === null || nextValue === undefined || nextValue === '' ? null : String(nextValue)
      if (!cursor) break
    }
    return { records: records.slice(0, maxRecords), endpoint, pages }
  }

  // `none` reads one page; `page` and `offset` walk until the provider runs dry.
  const totalPages = pagination.mode === 'none' || context.singlePage ? 1 : pagination.maxPages
  for (let index = 0; index < totalPages; index += 1) {
    const extra: Record<string, string | number | undefined> = {}
    if (pagination.mode === 'page') {
      extra[pagination.param ?? 'page'] = pagination.startPage + index
      if (pagination.sizeParam) extra[pagination.sizeParam] = pagination.pageSize
    }
    if (pagination.mode === 'offset') {
      extra[pagination.param ?? 'offset'] = pagination.startPage + index * pagination.pageSize
      if (pagination.sizeParam) extra[pagination.sizeParam] = pagination.pageSize
    }
    const result = await fetchJson(
      resolveEndpoint(config.baseUrl, context.path, baseParams(context, extra)),
      requestOptions(config, credential, context.onResponse),
    )
    const page = readPage(result, context, index === 0)
    pages += 1
    if (index === 0) endpoint = result.url
    records.push(...page)
    if (records.length >= maxRecords) break
    if (pagination.mode === 'page' && page.length < pagination.pageSize) break
    if (pagination.mode === 'none') break
    if (page.length === 0) break
  }

  return { records: records.slice(0, maxRecords), endpoint, pages }
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                */
/* -------------------------------------------------------------------------- */

async function loadIntegration(organizationId: string, integrationId: string): Promise<IntegrationRow> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, integrationId), eq(integrations.organizationId, organizationId)))
    .limit(1)
  if (!row) throw ApiError.notFound('That integration does not exist in this organization.')
  return row
}

/** Resolves the credential a run should use, failing closed when one is required. */
/**
 * Resolves the credential a connector should send.
 *
 * A connection configured with `auth.type = 'none'` is never decrypted. That
 * matters because the ciphertext outlives the config: switching a connection to
 * "no authentication" used to leave the old secret in play, so a rotated
 * `INTEGRATION_SECRET_KEY` broke a connection that does not even use a
 * credential. `authHeaders` ignores a credential for this mode anyway, so the
 * only effect of decrypting was a failure it never needed to have.
 */
function credentialFor(
  row: IntegrationRow,
  auth: ConnectorConfig['auth'],
  override?: string | null,
): string | null {
  if (!requiresCredential(auth)) return null
  if (override !== undefined) return override || null
  if (!row.secretCiphertext) return null
  return decryptCredential(row.secretCiphertext)
}

/**
 * Live states: a connector in one of these is expected to sync.
 *
 * `ERROR` stays live on purpose. A failed run records the error and schedules a
 * sooner retry, so a transient outage heals by itself; treating `ERROR` as dead
 * would mean the retry never happened and a human had to flip a dropdown.
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['CONNECTED', 'ERROR'])

function assertRunnable(row: IntegrationRow, credential: string | null, connector: ConnectorConfig) {
  if (!LIVE_STATUSES.has(row.status)) {
    throw ApiError.unprocessable('This connection is not live yet: set its status to CONNECTED before syncing.')
  }
  if (requiresCredential(connector.auth) && !credential) {
    throw ApiError.unprocessable('This connection needs a credential. Add one, then sync.')
  }
}

async function fallbackCurrency(organizationId: string): Promise<string> {
  const [org] = await db
    .select({ currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
  return org?.currency ?? 'KES'
}

/* -------------------------------------------------------------------------- */
/* Preview (dry run)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Maps the first page of a resource and returns what would be written.
 *
 * Nothing is persisted: a wrong mapping must be visible before it can pollute
 * the prediction engine. Accepts an unsaved connector and an unsaved credential
 * so the UI can test before saving.
 *
 * The response itself travels back with the result. A preview is the one place an
 * operator asks "what did this endpoint actually say?", and a 401 message, an HTML
 * error page or an unexpected envelope is the answer — so an endpoint failure is
 * returned as data (`error` + `response`) rather than thrown. Failures with no
 * response (a blocked address, a timeout, a missing credential) still throw: there
 * is nothing to show and the message already says what to do.
 */
export async function previewConnector(input: {
  organizationId: string
  integrationId: string
  resource: ConnectorResource
  connector?: ConnectorConfig
  credential?: string
  limit: number
}): Promise<ConnectorPreviewDto> {
  const row = await loadIntegration(input.organizationId, input.integrationId)
  const connector = input.connector ?? row.connector
  if (!connector) throw ApiError.unprocessable('This connection has no connector configuration yet.')

  const mapping = connector.resources[input.resource]
  if (!mapping) throw ApiError.unprocessable(`The "${input.resource}" resource is not enabled in this connector.`)

  const credential = credentialFor(row, connector.auth, input.credential)
  // A preview is explicitly allowed on a connection that is not live yet: that is
  // how an operator validates a mapping before switching the provider on.
  assertRunnable({ ...row, status: 'CONNECTED' }, credential, connector)

  // Kept so a failure can be shown rather than guessed at. The preview reads a
  // single page, so there is exactly one response to keep.
  const captured: { value: HttpResponseCapture | null } = { value: null }
  const present = () => (captured.value ? presentHttpResponse(captured.value, { secrets: [credential] }) : null)

  const context: FetchContext = {
    config: connector,
    resourceName: input.resource,
    resource: mapping,
    path: mapping.path,
    credential,
    updatedSince: null,
    singlePage: true,
    maxRecords: Math.max(input.limit, 25),
    onResponse: (capture) => {
      captured.value = capture
    },
  }

  const currency = await fallbackCurrency(input.organizationId)
  const rows: Array<Record<string, unknown>> = []
  const rejections = new Map<string, number>()

  try {
    const fetched = await fetchResource(context)

    for (const record of fetched.records.slice(0, input.limit)) {
      const result = mapRecord(input.resource, mapping, record, currency)
      if (result.ok) rows.push(serialise(result.value))
      else rejections.set(result.reason, (rejections.get(result.reason) ?? 0) + 1)
    }

    for (const record of fetched.records.slice(input.limit)) {
      const result = mapRecord(input.resource, mapping, record, currency)
      if (!result.ok) rejections.set(result.reason, (rejections.get(result.reason) ?? 0) + 1)
    }

    return {
      resource: input.resource,
      endpoint: fetched.endpoint,
      fetched: fetched.records.length,
      accepted: rows.length,
      rows,
      rejections: [...rejections].map(([reason, count]) => ({ reason, count })),
      response: present(),
      error: null,
    }
  } catch (error) {
    if (!(error instanceof ApiError) || !captured.value) throw error
    return {
      resource: input.resource,
      endpoint: captured.value.url,
      fetched: 0,
      accepted: 0,
      rows: [],
      rejections: [],
      response: present(),
      error: error.message,
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Probe (connection test)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One GET with a connection's own settings — the "is this URL and this credential
 * any good?" check, usable before a single resource is mapped.
 *
 * It is deliberately state-free: the connector arrives from the form, so a
 * half-filled draft can be tested without saving it, and a probe cannot mutate a
 * connection. `integrationId` is used for one thing only — letting a blank
 * credential fall back to the stored one, so re-testing an existing connection does
 * not require pasting the secret again.
 */
export async function probeConnectorConnection(input: {
  organizationId: string
  connector: ConnectorConnectionConfig
  credential?: string | null
  integrationId?: string
  path?: string
}): Promise<ConnectorConnectionTestDto> {
  const credential = await probeCredential(input)
  if (requiresCredential(input.connector.auth) && !credential) {
    throw ApiError.unprocessable(
      'This connection needs a credential: paste it here, or save it, before testing the connection.',
    )
  }

  const url = resolveEndpoint(input.connector.baseUrl, input.path ?? '', {
    ...input.connector.query,
    ...authQuery(input.connector.auth, credential),
  })
  const captured: { value: HttpResponseCapture | null } = { value: null }
  const startedAt = Date.now()

  try {
    const result = await fetchJson(url, {
      headers: { ...input.connector.headers, ...authHeaders(input.connector.auth, credential) },
      timeoutMs: input.connector.timeoutMs,
      onResponse: (capture) => {
        captured.value = capture
      },
    })
    return {
      ok: true,
      endpoint: result.url,
      status: result.status,
      durationMs: captured.value?.durationMs ?? Date.now() - startedAt,
      response: captured.value ? presentHttpResponse(captured.value, { secrets: [credential] }) : null,
      error: null,
    }
  } catch (error) {
    // Same rule as the preview: an answer from the endpoint is a result (even a
    // 401), a refusal that never reached it is an error.
    if (!(error instanceof ApiError) || !captured.value) throw error
    return {
      ok: false,
      endpoint: captured.value.url,
      status: captured.value.status,
      durationMs: captured.value.durationMs,
      response: presentHttpResponse(captured.value, { secrets: [credential] }),
      error: error.message,
    }
  }
}

/** A typed credential wins; otherwise the connection's stored one is used. */
async function probeCredential(input: {
  organizationId: string
  credential?: string | null
  integrationId?: string
}): Promise<string | null> {
  if (input.credential !== undefined) return input.credential || null
  if (!input.integrationId) return null
  const row = await loadIntegration(input.organizationId, input.integrationId)
  if (!row.secretCiphertext) return null
  return decryptCredential(row.secretCiphertext)
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A `RUNNING` row older than this is assumed to belong to a process that died
 * mid-sync (a crash, a deploy, a timeout), not to real work still in progress.
 * Without this, one hard kill would block a connection's syncs forever.
 */
const STALE_RUN_MS = 30 * 60_000

/**
 * Claims the single run slot for a connection.
 *
 * `sync_runs` carries a partial unique index on `(integration_id) WHERE status =
 * 'RUNNING'`, so the database decides the winner: the loser gets a unique
 * violation instead of both runs proceeding. This covers every combination —
 * two manual clicks, or a scheduled run overlapping a manual one — because both
 * paths start here.
 */
async function startSyncRun(input: {
  organizationId: string
  integrationId: string
  trigger: SyncTrigger
}): Promise<SyncRunRow> {
  const insert = () =>
    db
      .insert(syncRuns)
      .values({
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        trigger: input.trigger,
        status: 'RUNNING' as const,
        counts: emptyRunCounts(),
      })
      .returning()

  try {
    const [run] = await insert()
    if (!run) throw ApiError.internal()
    return run
  } catch (error) {
    if (pgErrorCode(error)?.code !== '23505') throw error

    // Someone holds the slot. If their run is stale, retire it and take over.
    const cutoff = new Date(Date.now() - STALE_RUN_MS)
    const reaped = await db
      .update(syncRuns)
      .set({
        status: 'FAILED',
        error: 'Interrupted before it finished (the process stopped mid-sync).',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(syncRuns.integrationId, input.integrationId),
          eq(syncRuns.status, 'RUNNING'),
          lte(syncRuns.startedAt, cutoff),
        ),
      )
      .returning({ id: syncRuns.id })

    if (reaped.length) {
      const [run] = await insert()
      if (!run) throw ApiError.internal()
      return run
    }

    throw ApiError.conflict('A sync is already running for this connection. Wait for it to finish.')
  }
}

export async function runIntegrationSync(input: {
  organizationId: string
  integrationId: string
  trigger: SyncTrigger
  actorUserId: string | null
  ipHash?: string | null
}): Promise<SyncResultDto> {
  const row = await loadIntegration(input.organizationId, input.integrationId)
  const connector = row.connector
  if (!connector) throw ApiError.unprocessable('This connection has no connector configuration yet.')

  const credential = credentialFor(row, connector.auth)
  assertRunnable(row, credential, connector)

  const run = await startSyncRun({
    organizationId: input.organizationId,
    integrationId: row.id,
    trigger: input.trigger,
  })

  const counts = emptyRunCounts()
  const actor: IngestActor = {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    // The connection, not the provider: identity, aliases and "refresh from
    // source" are all per connection.
    integrationId: row.id,
  }
  const currency = await fallbackCurrency(input.organizationId)
  let failure: string | null = null
  let affectedCustomerIds: string[] = []

  try {
    for (const resource of RESOURCE_ORDER) {
      const mapping = connector.resources[resource]
      if (!mapping) continue
      const resourceCounts = counts[resource]

      const fetched = await fetchResource({
        config: connector,
        resourceName: resource,
        resource: mapping,
        path: mapping.path,
        credential,
        // Read a small overlap so a write that lands during the run is not missed.
        updatedSince: row.lastSyncedAt ? new Date(row.lastSyncedAt.getTime() - 15 * 60 * 1000).toISOString() : null,
      })

      resourceCounts.fetched = fetched.records.length

      if (resource === 'customers') {
        const valid = []
        for (const record of fetched.records) {
          const result = normaliseCustomer(record, mapping)
          if (result.ok) valid.push(result.value)
          else {
            resourceCounts.rejected += 1
            recordRejection(counts, resource, result.reason)
          }
        }
        const outcome = await upsertCustomers(actor, valid)
        mergeOutcome(resourceCounts, outcome, counts, resource)
      } else if (resource === 'products') {
        const valid = []
        for (const record of fetched.records) {
          const result = normaliseProduct(record, mapping)
          if (result.ok) valid.push(result.value)
          else {
            resourceCounts.rejected += 1
            recordRejection(counts, resource, result.reason)
          }
        }
        const outcome = await upsertProducts(actor, valid)
        mergeOutcome(resourceCounts, outcome, counts, resource)
      } else {
        const ordersMapping = mapping as ConnectorOrdersResourceConfig
        const valid: NormalisedOrder[] = []
        for (const record of fetched.records) {
          const result = normaliseOrder(record, ordersMapping, { fallbackCurrency: currency })
          if (result.ok) valid.push(result.value)
          else {
            resourceCounts.rejected += 1
            recordRejection(counts, resource, result.reason)
          }
        }
        const outcome = await upsertOrders(actor, valid)
        mergeOutcome(resourceCounts, outcome, counts, resource)
        await applyLastOrderAt(input.organizationId, outcome.affectedCustomerIds)
        affectedCustomerIds = outcome.affectedCustomerIds
      }
    }
  } catch (error) {
    if (!(error instanceof ApiError)) {
      // A non-ApiError here is a bug or an infrastructure fault, not a mapping
      // problem. Recording the stack is the only way it can be diagnosed at all;
      // the operator-facing sentence stays friendly and free of internals.
      console.error('[sync] unexpected failure', error)
    }
    failure = error instanceof ApiError ? error.message : 'The sync failed unexpectedly. Check the connection settings.'
  }

  const finishedAt = new Date()
  const status: SyncRunDto['status'] = failure ? 'FAILED' : counts.rejections.length ? 'PARTIAL' : 'SUCCEEDED'

  const [updated] = await db
    .update(syncRuns)
    .set({ status, counts, error: failure, finishedAt })
    .where(eq(syncRuns.id, run.id))
    .returning()

  // A failed run retries sooner than a healthy one, so a transient outage heals.
  const retryMinutes = failure ? 15 : row.syncIntervalMinutes
  const [integrationRow] = await db
    .update(integrations)
    .set({
      lastSyncedAt: failure ? row.lastSyncedAt : finishedAt,
      lastError: failure,
      status: failure ? 'ERROR' : 'CONNECTED',
      nextSyncAt: new Date(finishedAt.getTime() + retryMinutes * 60_000),
      updatedAt: finishedAt,
    })
    .where(and(eq(integrations.id, row.id), eq(integrations.organizationId, input.organizationId)))
    .returning()

  if (!failure && affectedCustomerIds.length) {
    try {
      await syncOpportunities(input.organizationId, affectedCustomerIds)
    } catch (error) {
      console.error('[sync] opportunity refresh failed', error instanceof Error ? error.message : error)
    }
  }

  await writeAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: failure ? 'integration.sync_failed' : 'integration.synced',
    entityType: 'integration',
    entityId: row.id,
    metadata: { provider: row.provider, trigger: input.trigger, status, counts: summarise(counts) },
    ipHash: input.ipHash ?? null,
  })

  return {
    run: toSyncRunDto(updated ?? run),
    integration: toIntegrationDto(integrationRow ?? row),
  }
}

function mergeOutcome(
  target: { created: number; updated: number; rejected: number },
  outcome: { counts: { created: number; updated: number; rejected: number }; rejections: Array<{ reason: string }> },
  counts: SyncRunCounts,
  resource: ConnectorResource,
) {
  target.created += outcome.counts.created
  target.updated += outcome.counts.updated
  target.rejected += outcome.counts.rejected
  for (const rejection of outcome.rejections) recordRejection(counts, resource, rejection.reason)
}

function summarise(counts: SyncRunCounts) {
  return {
    customers: counts.customers,
    products: counts.products,
    orders: counts.orders,
  }
}

/* -------------------------------------------------------------------------- */
/* Scheduler support                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Claims a due integration with a conditional update.
 *
 * Two overlapping scheduler runs must not sync the same connector twice, so the
 * next slot is pushed forward *before* the work starts and only if the row is
 * still due. Losing the race means the other runner owns it.
 */
async function claim(integrationId: string, minutes: number): Promise<boolean> {
  const now = new Date()
  const claimed = await db
    .update(integrations)
    .set({ nextSyncAt: new Date(now.getTime() + minutes * 60_000) })
    .where(
      and(
        eq(integrations.id, integrationId),
        or(sql`${integrations.nextSyncAt} is null`, lte(integrations.nextSyncAt, now)),
      ),
    )
    .returning({ id: integrations.id })
  return claimed.length > 0
}

export type SchedulerOutcome = {
  attempted: number
  succeeded: number
  failed: number
  /** Due connections skipped because a manual run held their slot. */
  skipped: number
  results: Array<{ integrationId: string; provider: string; status: string; error: string | null }>
}

/** Runs every connector whose slot has arrived. Used by the cron entrypoint. */
export async function runDueIntegrations(limit: number): Promise<SchedulerOutcome> {
  const due = await db
    .select({ id: integrations.id, organizationId: integrations.organizationId, provider: integrations.provider, syncIntervalMinutes: integrations.syncIntervalMinutes })
    .from(integrations)
    .where(
      and(
        inArray(integrations.status, ['CONNECTED', 'ERROR']),
        isNotNull(integrations.connector),
        or(sql`${integrations.nextSyncAt} is null`, lte(integrations.nextSyncAt, new Date())),
      ),
    )
    .orderBy(asc(integrations.nextSyncAt))
    .limit(limit)

  const outcome: SchedulerOutcome = { attempted: 0, succeeded: 0, failed: 0, skipped: 0, results: [] }

  for (const candidate of due) {
    if (!(await claim(candidate.id, candidate.syncIntervalMinutes))) continue
    outcome.attempted += 1
    try {
      const result = await runIntegrationSync({
        organizationId: candidate.organizationId,
        integrationId: candidate.id,
        trigger: 'SCHEDULE',
        actorUserId: null,
      })
      const failed = result.run.status === 'FAILED'
      if (failed) outcome.failed += 1
      else outcome.succeeded += 1
      outcome.results.push({
        integrationId: candidate.id,
        provider: candidate.provider,
        status: result.run.status,
        error: result.run.error,
      })
    } catch (error) {
      // A manual run holds this connection's slot: the claim above already
      // moved `nextSyncAt` forward, so it is picked up at the next tick. Not a
      // failure, and counting it as one would flag a healthy connection.
      if (error instanceof ApiError && error.status === 409) {
        outcome.skipped += 1
        continue
      }
      outcome.failed += 1
      outcome.results.push({
        integrationId: candidate.id,
        provider: candidate.provider,
        status: 'FAILED',
        error: error instanceof ApiError ? error.message : 'Unexpected failure.',
      })
    }
  }

  return outcome
}

/* -------------------------------------------------------------------------- */
/* History                                                                    */
/* -------------------------------------------------------------------------- */

export async function listSyncRuns(
  organizationId: string,
  integrationId: string,
  limit: number,
): Promise<SyncRunDto[]> {
  await loadIntegration(organizationId, integrationId)
  const rows = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.integrationId, integrationId), eq(syncRuns.organizationId, organizationId)))
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit)
  return rows.map(toSyncRunDto)
}

export function listPresets(): ConnectorPresetDto[] {
  return listConnectorPresets()
}

export function findPreset(provider: string): ConnectorPresetDto | null {
  return connectorPreset(provider)
}

/** Turns a canonical value into JSON for the preview response (dates as ISO). */
function serialise(value: unknown): Record<string, unknown> {
  const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    entry instanceof Date ? entry.toISOString() : entry,
  ])
  return Object.fromEntries(entries)
}

/** Maps one record for the resource, so preview and run share one code path. */
function mapRecord(
  resource: ConnectorResource,
  mapping: ConnectorResourceConfig,
  record: unknown,
  currency: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (resource === 'customers') return normaliseCustomer(record, mapping)
  if (resource === 'products') return normaliseProduct(record, mapping)
  return normaliseOrder(record, mapping as ConnectorOrdersResourceConfig, { fallbackCurrency: currency })
}
