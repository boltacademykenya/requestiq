import type { SyncRunCounts } from '@/lib/connectors/canonical'
import type { ConnectorConfig } from '@/lib/connectors/config'
import type { ConnectorPreset } from '@/lib/connectors/presets'
import type { OpportunityStatus, Status } from '@/lib/reorder/types'

/**
 * JSON transport contracts.
 *
 * DTOs are the only shapes that cross the network. Database rows are mapped
 * explicitly into these types so internal columns can never leak.
 * Timestamps are ISO-8601 strings; the client revives them where needed.
 */
export type OrganizationDto = {
  id: string
  name: string
  slug: string
  industry: string
  country: string
  currency: string
  timezone: string
  createdAt: string
}

export type ProductDto = {
  id: string
  organizationId: string
  name: string
  sku: string | null
  category: string | null
  unit: string
  price: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Where a canonical customer is known: one entry per connected source.
 *
 * This is a list because a customer is one identity with many aliases — the same
 * buyer may live in an ERP, a storefront and a payment provider. `sources` being
 * empty is how the UI says "manual": the customer was never imported, rather than
 * the platform being unknown.
 */
export type CustomerSourceDto = {
  /** The connection, which is the actual source (two Shopify stores are two). */
  integrationId: string
  provider: string
  displayName: string | null
  status: string
  /** That connection's own id for this customer. */
  externalId: string
  firstSeenAt: string
  /** When this connection last refreshed the alias. */
  lastSyncedAt: string
  /** When the connection itself last completed a run; null means never. */
  integrationLastSyncedAt: string | null
  /** Whether this connection is the tenant's customer master (contact fields). */
  master: boolean
}

export type CustomerDto = {
  id: string
  organizationId: string
  name: string
  initials: string | null
  phone: string
  email: string | null
  location: string | null
  customerType: string
  assignedSalesperson: string | null
  marketingOptIn: boolean
  isActive: boolean
  lastOrderAt: string | null
  sources: CustomerSourceDto[]
  createdAt: string
  updatedAt: string
}

/** Outcome of re-pulling one customer from every source that knows them. */
export type CustomerRefreshDto = {
  customerId: string
  connections: Array<{
    integrationId: string
    provider: string
    displayName: string | null
    /** `SKIPPED` means a run for that connection was already in flight. */
    outcome: 'SYNCED' | 'SKIPPED' | 'FAILED'
    reason: string | null
    run: SyncRunDto | null
  }>
}

export type OrderLineDto = {
  id: string
  productId: string | null
  productName: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type OrderDto = {
  id: string
  organizationId: string
  customerId: string
  reference: string
  status: 'COMPLETED' | 'PENDING' | 'CANCELLED'
  source: 'MANUAL' | 'SIMULATED' | 'API' | 'IMPORT'
  paymentMethod: string | null
  currency: string
  subtotal: number
  total: number
  orderedAt: string
  notes: string | null
  items: OrderLineDto[]
  createdAt: string
  updatedAt: string
}

export type CustomerInsightDto = CustomerDto & {
  orders: OrderDto[]
  intervals: number[]
  averageInterval: number
  medianInterval: number
  confidence: number
  predictedNext: string | null
  status: Status
  reorderScore: number
  totalSpend: number
  averageOrderValue: number
  recommendedProducts: string[]
  action: string
}

export type OpportunityDto = {
  id: string
  customerId: string
  customerName: string
  expectedDate: string
  reorderScore: number
  expectedValue: number
  probability: number
  status: OpportunityStatus
  lastContactedAt: string | null
  computedAt: string
  updatedAt: string
}

export type CampaignDto = {
  id: string
  name: string
  type: string
  channel: string
  status: string
  audienceFilter: Record<string, unknown>
  messageTemplate: string | null
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  recipientCount: number
  sentCount: number
  createdAt: string
  updatedAt: string
}

export type MessageDto = {
  id: string
  customerId: string
  customerName: string
  campaignId: string | null
  channel: string
  direction: string
  status: string
  provider: string
  body: string
  sentAt: string | null
  createdAt: string
}

export type IntegrationDto = {
  id: string
  provider: string
  status: string
  displayName: string | null
  config: Record<string, string | number | boolean>
  /** Declarative connector spec, or null when the provider is not configured yet. */
  connector: ConnectorConfig | null
  syncIntervalMinutes: number
  nextSyncAt: string | null
  /** Whether a credential is stored. The credential itself never crosses the wire. */
  hasCredential: boolean
  externalAccountId: string | null
  lastSyncedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type SyncRunDto = {
  id: string
  integrationId: string
  trigger: 'MANUAL' | 'SCHEDULE'
  status: 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
  counts: SyncRunCounts
  error: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
}

/** One run's outcome, returned by `POST …/sync` and the run history. */
export type SyncResultDto = {
  run: SyncRunDto
  integration: IntegrationDto
}

/** One outbound connector request, as the operator sees it in the editor. */
export type ConnectorHttpDto = {
  /** The final URL, after redirects. */
  endpoint: string
  status: number | null
  statusText: string | null
  contentType: string | null
  /** Wall-clock time for the request. */
  durationMs: number
  /** Real size of the response body, before display truncation. */
  bytes: number
  /** A safe subset: credential-bearing and cookie headers are never included. */
  headers: Array<{ name: string; value: string }>
  /**
   * The body as text — pretty-printed JSON when it parsed. Credential-looking
   * values are redacted and the whole body is capped, so this is a diagnostic
   * view rather than an export.
   */
  body: string
  /** True when `body` was cut for display. */
  truncated: boolean
  /** True when the complete body parsed as JSON (so `body` can be re-parsed). */
  json: boolean
}

/** A dry-run of a mapping: canonical rows, plus why any were rejected. */
export type ConnectorPreviewDto = {
  resource: 'customers' | 'products' | 'orders'
  endpoint: string
  fetched: number
  accepted: number
  rows: Array<Record<string, unknown>>
  rejections: Array<{ reason: string; count: number }>
  /**
   * The page the preview read. Present whenever the endpoint answered, including
   * when that answer was a 401 or an HTML error page — which is exactly the case
   * the operator needs to see.
   */
  response: ConnectorHttpDto | null
  /**
   * Why the read produced no rows: a non-2xx status, a body that is not JSON, a
   * records path that matched nothing. Null when the read succeeded.
   *
   * Endpoint problems are returned rather than thrown, because the preview's job
   * is to show them. Configuration problems (no connector, no credential, a
   * blocked address) still fail the request.
   */
  error: string | null
}

/**
 * Outcome of "Test connection": one GET with the connection's own settings, before
 * any resource is mapped.
 */
export type ConnectorConnectionTestDto = {
  ok: boolean
  /** The URL actually requested, after redirects when a response arrived. */
  endpoint: string
  status: number | null
  durationMs: number
  /** The raw answer, when one arrived. Null for a transport failure. */
  response: ConnectorHttpDto | null
  /** Why the probe failed: a non-2xx status, a non-JSON body, a transport error. */
  error: string | null
}

export type ConnectorPresetDto = ConnectorPreset

export type SubscriptionDto = {
  id: string
  plan: 'SMALL' | 'MEDIUM' | 'LARGE' | 'CUSTOM'
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED'
  paymentProvider: 'NONE' | 'MPESA' | 'PAYSTACK' | 'INVOICE'
  seats: number
  amount: number
  currency: string
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  cancelledAt: string | null
}

export type MemberDto = {
  id: string
  userId: string
  name: string
  email: string
  role: 'OWNER' | 'ADMIN' | 'ANALYST' | 'SALES'
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED'
  createdAt: string
}

export type LeadDto = {
  id: string
  name: string
  businessName: string
  email: string
  phone: string | null
  topic: string
  message: string
  status: string
  createdAt: string
  handledAt: string | null
}

export type AuditLogDto = {
  id: string
  action: string
  entityType: string
  entityId: string | null
  actorUserId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type SessionDto = {
  user: { id: string; name: string; email: string }
  organization: OrganizationDto | null
  role: MemberDto['role'] | null
  capabilities: string[]
}

export type KpiDto = {
  totalCustomers: number
  activeCustomers: number
  dueToday: number
  dueSoon: number
  overdue: number
  atRisk: number
  predictedRevenue: number
  averageOrderValue: number
}

export type InsightOverviewDto = {
  kpis: KpiDto
  statusCounts: Partial<Record<Status, number>>
  revenueForecast: Array<{ date: string; revenue: number }>
  intervalBuckets: Array<{ label: string; value: number }>
  topOpportunities: OpportunityDto[]
}

export type ContactAcknowledgement = {
  id: string
  receivedAt: string
  message: string
}
