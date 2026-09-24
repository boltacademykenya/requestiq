import type {
  AuditLogDto,
  CampaignDto,
  CustomerDto,
  CustomerInsightDto,
  CustomerSourceDto,
  IntegrationDto,
  LeadDto,
  MemberDto,
  MessageDto,
  OpportunityDto,
  OrderDto,
  OrderLineDto,
  OrganizationDto,
  ProductDto,
  SubscriptionDto,
  SyncRunDto,
} from '@/lib/api/dto'
import { getInsight } from '@/lib/reorder/analytics'
import type { Customer, CustomerInsight, Order } from '@/lib/reorder/types'
import type {
  AuditLogRow,
  CampaignRow,
  ContactSubmissionRow,
  CustomerRow,
  IntegrationRow,
  MemberRow,
  MessageRow,
  OpportunityRow,
  OrderItemRow,
  OrderRow,
  OrganizationRow,
  ProductRow,
  SubscriptionRow,
  SyncRunRow,
  UserRow,
} from './schema'

/**
 * Explicit row -> DTO mapping.
 *
 * Nothing is ever spread from a database row, so internal columns (secret
 * references, soft-delete flags, notes, IP hashes) cannot leak by accident.
 */
const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null)

export function toOrganizationDto(row: OrganizationRow): OrganizationDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    industry: row.industry,
    country: row.country,
    currency: row.currency,
    timezone: row.timezone,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toProductDto(row: ProductRow): ProductDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    sku: row.sku,
    category: row.category,
    unit: row.unit,
    price: Number(row.price),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * `sources` is passed in rather than joined here: provenance is loaded in one
 * batched query per page, so this stays a pure row -> DTO mapping.
 */
export function toCustomerDto(row: CustomerRow, sources: CustomerSourceDto[] = []): CustomerDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    initials: row.initials,
    phone: row.phone,
    email: row.email,
    location: row.location,
    customerType: row.customerType,
    assignedSalesperson: row.assignedSalesperson,
    marketingOptIn: row.marketingOptIn,
    isActive: row.isActive,
    lastOrderAt: iso(row.lastOrderAt),
    sources,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toOrderLineDto(row: OrderItemRow): OrderLineDto {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    quantity: row.quantity,
    unitPrice: Number(row.unitPrice),
    lineTotal: Number(row.lineTotal),
  }
}

export function toOrderDto(row: OrderRow, items: OrderItemRow[]): OrderDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerId: row.customerId,
    reference: row.reference,
    status: row.status,
    source: row.source,
    paymentMethod: row.paymentMethod,
    currency: row.currency,
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    orderedAt: row.orderedAt.toISOString(),
    notes: row.notes,
    items: items.map(toOrderLineDto),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toOpportunityDto(row: OpportunityRow, customerName: string): OpportunityDto {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName,
    expectedDate: row.expectedDate.toISOString().slice(0, 10),
    reorderScore: row.reorderScore,
    expectedValue: Number(row.expectedValue),
    probability: row.probability,
    status: row.status,
    lastContactedAt: iso(row.lastContactedAt),
    computedAt: row.computedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toMemberDto(row: MemberRow, user: Pick<UserRow, 'id' | 'name' | 'email'>): MemberDto {
  return {
    id: row.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toSubscriptionDto(row: SubscriptionRow): SubscriptionDto {
  return {
    id: row.id,
    plan: row.plan,
    status: row.status,
    paymentProvider: row.paymentProvider,
    seats: row.seats,
    amount: Number(row.amount),
    currency: row.currency,
    currentPeriodStart: row.currentPeriodStart.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelledAt: iso(row.cancelledAt),
  }
}

/**
 * Note `hasCredential`: the sealed credential and its reference are intentionally
 * never mapped, so they cannot leak through an API response.
 */
export function toIntegrationDto(row: IntegrationRow): IntegrationDto {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    displayName: row.displayName,
    config: row.config,
    connector: row.connector ?? null,
    syncIntervalMinutes: row.syncIntervalMinutes,
    nextSyncAt: iso(row.nextSyncAt),
    hasCredential: row.secretCiphertext !== null,
    externalAccountId: row.externalAccountId,
    lastSyncedAt: iso(row.lastSyncedAt),
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSyncRunDto(row: SyncRunRow): SyncRunDto {
  return {
    id: row.id,
    integrationId: row.integrationId,
    trigger: row.trigger,
    status: row.status,
    counts: row.counts,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
  }
}

export function toCampaignDto(row: CampaignRow, counts: { recipients: number; sent: number }): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    channel: row.channel,
    status: row.status,
    audienceFilter: row.audienceFilter as Record<string, unknown>,
    messageTemplate: row.messageTemplate,
    scheduledAt: iso(row.scheduledAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    recipientCount: counts.recipients,
    sentCount: counts.sent,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toMessageDto(row: MessageRow, customerName: string): MessageDto {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName,
    campaignId: row.campaignId,
    channel: row.channel,
    direction: row.direction,
    status: row.status,
    provider: row.provider,
    body: row.body,
    sentAt: iso(row.sentAt),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toLeadDto(row: ContactSubmissionRow): LeadDto {
  return {
    id: row.id,
    name: row.name,
    businessName: row.businessName,
    email: row.email,
    phone: row.phone,
    topic: row.topic,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    handledAt: iso(row.handledAt),
  }
}

export function toAuditLogDto(row: AuditLogRow): AuditLogDto {
  return {
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorUserId: row.actorUserId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }
}

/* -------------------------------------------------------------------------- */
/* Domain mapping (insight computation)                                       */
/* -------------------------------------------------------------------------- */

/** Historical order in the shape the prediction engine consumes. */
export function toDomainOrder(row: OrderRow, items: OrderItemRow[]): Order {
  return {
    id: row.reference,
    organizationId: row.organizationId,
    customerId: row.customerId,
    date: row.orderedAt,
    total: Number(row.total),
    products: items.map((item) => ({ name: item.productName, quantity: item.quantity })),
    source: row.source,
  }
}

export function toDomainCustomer(row: CustomerRow, orders: Order[]): Customer {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    initials: row.initials ?? row.name.split(' ').slice(0, 2).map((part) => part[0]).join(''),
    phone: row.phone,
    email: row.email ?? '',
    location: row.location ?? '',
    customerType: row.customerType,
    ...(row.assignedSalesperson ? { assignedSalesperson: row.assignedSalesperson } : {}),
    orders,
    marketingOptIn: row.marketingOptIn,
  }
}

/**
 * Full insight payload for one customer: contact data + order history +
 * prediction metadata derived from that history.
 */
export function toCustomerInsightDto(
  row: CustomerRow,
  orders: OrderDto[],
  sources: CustomerSourceDto[] = [],
): CustomerInsightDto {
  const domainOrders: Order[] = orders
    .filter((order) => order.status !== 'CANCELLED')
    .map((order) => ({
      id: order.reference,
      organizationId: order.organizationId,
      customerId: order.customerId,
      date: new Date(order.orderedAt),
      total: order.total,
      products: order.items.map((item) => ({ name: item.productName, quantity: item.quantity })),
      source: order.source,
    }))
  const insight: CustomerInsight = getInsight(toDomainCustomer(row, domainOrders))

  return {
    ...toCustomerDto(row, sources),
    orders,
    intervals: insight.intervals,
    averageInterval: insight.averageInterval,
    medianInterval: insight.medianInterval,
    confidence: insight.confidence,
    predictedNext: iso(insight.predictedNext),
    status: insight.status,
    reorderScore: insight.reorderScore,
    totalSpend: insight.totalSpend,
    averageOrderValue: insight.averageOrderValue,
    recommendedProducts: insight.recommendedProducts,
    action: insight.action,
  }
}