import { and, asc, desc, eq, getTableColumns, gte, inArray, lte, or, sql } from 'drizzle-orm'
import type { CustomerInsightDto, CustomerSourceDto, InsightOverviewDto, OpportunityDto } from '@/lib/api/dto'
import { db } from '@/lib/db/client'
import { toCustomerInsightDto, toOpportunityDto, toOrderDto } from '@/lib/db/mappers'
import { chunk } from '@/lib/db/query-utils'
import { customerSources, customers, integrations, opportunities, orderItems, orders } from '@/lib/db/schema'
import type { OpportunityStatus } from '@/lib/db/schema'
import {
  computeIntervalBuckets,
  computeKpis,
  computeProbability,
  computeRevenueForecast,
  computeStatusCounts,
} from '@/lib/reorder/analytics'

const MAX_CUSTOMERS = 500
const MAX_ORDERS_PER_CUSTOMER = 60

type CustomerStatus = CustomerInsightDto['status']
type CampaignAudienceFilter = {
  statuses?: CustomerStatus[]
  minReorderScore?: number
  dueWithinDays?: number
  marketingOptInOnly?: boolean
}

export type InsightFilters = {
  status?: CustomerStatus
  search?: string
  minScore?: number
  customerIds?: string[]
  /** Only customers known to this connection, for the "platform" filter. */
  integrationId?: string
  limit?: number
}

/**
 * Provenance for a page of customers, in one query per batch.
 *
 * Deliberately separate from the insight maths: where a customer came from is
 * metadata, and the prediction engine must not depend on it.
 */
async function loadCustomerSources(
  organizationId: string,
  customerIds: string[],
): Promise<Map<string, CustomerSourceDto[]>> {
  const byCustomer = new Map<string, CustomerSourceDto[]>()
  if (!customerIds.length) return byCustomer

  for (const group of chunk(customerIds, 200)) {
    const rows = await db
      .select({
        customerId: customerSources.customerId,
        integrationId: customerSources.integrationId,
        externalId: customerSources.externalId,
        firstSeenAt: customerSources.firstSeenAt,
        lastSyncedAt: customerSources.lastSyncedAt,
        provider: integrations.provider,
        displayName: integrations.displayName,
        status: integrations.status,
        integrationLastSyncedAt: integrations.lastSyncedAt,
        config: integrations.config,
      })
      .from(customerSources)
      .innerJoin(integrations, eq(integrations.id, customerSources.integrationId))
      .where(
        and(
          eq(customerSources.organizationId, organizationId),
          inArray(customerSources.customerId, group),
        ),
      )
      .orderBy(asc(customerSources.firstSeenAt))

    for (const row of rows) {
      const source: CustomerSourceDto = {
        integrationId: row.integrationId,
        provider: row.provider,
        displayName: row.displayName,
        status: row.status,
        externalId: row.externalId,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSyncedAt: row.lastSyncedAt.toISOString(),
        integrationLastSyncedAt: row.integrationLastSyncedAt ? row.integrationLastSyncedAt.toISOString() : null,
        master: row.config?.masterCustomer === true,
      }
      const bucket = byCustomer.get(row.customerId)
      if (bucket) bucket.push(source)
      else byCustomer.set(row.customerId, [source])
    }
  }

  return byCustomer
}

/** Connections whose aliases put a customer in scope, for the platform filter. */
function customersOfIntegration(organizationId: string, integrationId: string) {
  return db
    .select({ id: customerSources.customerId })
    .from(customerSources)
    .where(
      and(
        eq(customerSources.organizationId, organizationId),
        eq(customerSources.integrationId, integrationId),
      ),
    )
}

/**
 * Loads customers with their order history and derives reorder insights.
 *
 * Both queries are bounded (customers and orders-per-customer) so a tenant with
 * a long history cannot exhaust server memory.
 */
export async function loadCustomerInsights(
  organizationId: string,
  filters: InsightFilters = {},
): Promise<CustomerInsightDto[]> {
  const limit = Math.min(filters.limit ?? MAX_CUSTOMERS, MAX_CUSTOMERS)

  const conditions = [eq(customers.organizationId, organizationId), eq(customers.isActive, true)]
  if (filters.customerIds?.length) conditions.push(inArray(customers.id, filters.customerIds))
  if (filters.integrationId) {
    conditions.push(inArray(customers.id, customersOfIntegration(organizationId, filters.integrationId)))
  }
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_\\]/g, (match) => `\\${match}`)}%`
    const searchCondition = or(
      sql`${customers.name} ilike ${term}`,
      sql`coalesce(${customers.email}, '') ilike ${term}`,
      sql`${customers.phone} ilike ${term}`,
    )
    if (searchCondition) conditions.push(searchCondition)
  }

  const customerRows = await db
    .select()
    .from(customers)
    .where(and(...conditions))
    .orderBy(asc(customers.name))
    .limit(limit)

  if (!customerRows.length) return []

  const customerIds = customerRows.map((row) => row.id)
  const ranked = db.$with('ranked_orders').as(
    db
      .select({
        ...getTableColumns(orders),
        rn: sql<number>`row_number() over (partition by ${orders.customerId} order by ${orders.orderedAt} desc)`.as('rn'),
      })
      .from(orders)
      // Reorder timing and customer spend must be based on settled purchases.
      // Pending/failed/cancelled source records are kept in the orders screen,
      // but they are not evidence that a customer actually bought again.
      .where(
        and(
          eq(orders.organizationId, organizationId),
          inArray(orders.customerId, customerIds),
          eq(orders.status, 'COMPLETED'),
        ),
      ),
  )

  const orderRows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rn, MAX_ORDERS_PER_CUSTOMER))
    .orderBy(desc(ranked.orderedAt))

  const itemsByOrder = new Map<string, (typeof orderItems.$inferSelect)[]>()
  for (const group of chunk(orderRows.map((row) => row.id))) {
    const itemRows = await db.select().from(orderItems).where(inArray(orderItems.orderId, group))
    for (const item of itemRows) {
      const bucket = itemsByOrder.get(item.orderId)
      if (bucket) bucket.push(item)
      else itemsByOrder.set(item.orderId, [item])
    }
  }

  const ordersByCustomer = new Map<string, ReturnType<typeof toOrderDto>[]>()
  for (const row of orderRows) {
    const dto = toOrderDto(row, itemsByOrder.get(row.id) ?? [])
    const bucket = ordersByCustomer.get(row.customerId)
    if (bucket) bucket.push(dto)
    else ordersByCustomer.set(row.customerId, [dto])
  }

  const sourcesByCustomer = await loadCustomerSources(
    organizationId,
    customerRows.map((row) => row.id),
  )

  let insights = customerRows.map((row) =>
    toCustomerInsightDto(row, ordersByCustomer.get(row.id) ?? [], sourcesByCustomer.get(row.id) ?? []),
  )

  if (filters.status) insights = insights.filter((insight) => insight.status === filters.status)
  if (typeof filters.minScore === 'number') {
    const threshold = filters.minScore
    insights = insights.filter((insight) => insight.reorderScore >= threshold)
  }

  return insights
}

export async function loadCustomerInsight(
  organizationId: string,
  customerId: string,
): Promise<CustomerInsightDto | null> {
  const [insight] = await loadCustomerInsights(organizationId, { customerIds: [customerId], limit: 1 })
  return insight ?? null
}

function deriveOpportunityStatus(insight: CustomerInsightDto): OpportunityStatus {
  switch (insight.status) {
    case 'DUE_TODAY':
      return 'DUE'
    case 'DUE_SOON':
      return insight.reorderScore >= 80 ? 'HIGH_OPPORTUNITY' : 'UPCOMING'
    case 'OVERDUE':
      return 'OVERDUE'
    case 'AT_RISK':
    case 'DORMANT':
      return 'AT_RISK'
    default:
      return 'UPCOMING'
  }
}

/**
 * Persists the reorder opportunities implied by current order history.
 * Called after order writes and on the first dashboard load for a tenant.
 */
export async function syncOpportunities(organizationId: string, customerIds?: string[]): Promise<number> {
  const insights = await loadCustomerInsights(organizationId, {
    ...(customerIds?.length ? { customerIds } : {}),
  })

  const rows = insights
    .filter((insight) => insight.predictedNext !== null && insight.orders.length > 1)
    .map((insight) => ({
      organizationId,
      customerId: insight.id,
      expectedDate: new Date(insight.predictedNext as string),
      reorderScore: insight.reorderScore,
      expectedValue: Math.max(1, insight.averageOrderValue),
      probability: computeProbability(insight),
      status: deriveOpportunityStatus(insight),
      computedAt: new Date(),
      updatedAt: new Date(),
    }))

  if (!rows.length) return 0

  for (const group of chunk(rows, 200)) {
    await db
      .insert(opportunities)
      .values(group)
      .onConflictDoUpdate({
        target: [opportunities.organizationId, opportunities.customerId, opportunities.expectedDate],
        set: {
          reorderScore: sql`excluded.reorder_score`,
          expectedValue: sql`excluded.expected_value`,
          probability: sql`excluded.probability`,
          computedAt: sql`excluded.computed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }

  return rows.length
}

export type OpportunityFilters = { status?: OpportunityStatus; minScore?: number; limit?: number }

export async function loadOpportunities(
  organizationId: string,
  filters: OpportunityFilters = {},
): Promise<OpportunityDto[]> {
  const conditions = [eq(opportunities.organizationId, organizationId)]
  if (filters.status) conditions.push(eq(opportunities.status, filters.status))
  if (typeof filters.minScore === 'number') conditions.push(gte(opportunities.reorderScore, filters.minScore))

  const rows = await db
    .select({ opportunity: opportunities, customerName: customers.name })
    .from(opportunities)
    .innerJoin(customers, eq(customers.id, opportunities.customerId))
    .where(and(...conditions))
    .orderBy(asc(opportunities.expectedDate))
    .limit(Math.min(filters.limit ?? 200, 500))

  return rows.map((row) => toOpportunityDto(row.opportunity, row.customerName))
}

/** Dashboard payload: KPIs, distributions, forecast and top opportunities. */
export async function loadOverview(organizationId: string): Promise<InsightOverviewDto> {
  const insights = await loadCustomerInsights(organizationId)
  let storedOpportunities = await loadOpportunities(organizationId, { limit: 500 })

  // First visit for a fresh tenant: derive opportunities from history on demand.
  if (!storedOpportunities.length && insights.length) {
    await syncOpportunities(organizationId)
    storedOpportunities = await loadOpportunities(organizationId, { limit: 500 })
  }

  const topOpportunities = storedOpportunities
    .filter((opportunity) => opportunity.reorderScore >= 70)
    .sort((a, b) => b.expectedValue * b.probability - a.expectedValue * a.probability)
    .slice(0, 5)

  return {
    kpis: computeKpis(insights),
    statusCounts: computeStatusCounts(insights),
    revenueForecast: computeRevenueForecast(insights),
    intervalBuckets: computeIntervalBuckets(insights),
    topOpportunities,
  }
}

/** Campaign audience resolution shared by the dispatcher. */
export async function resolveAudience(
  organizationId: string,
  filter: CampaignAudienceFilter,
): Promise<CustomerInsightDto[]> {
  const insights = await loadCustomerInsights(organizationId, { minScore: filter.minReorderScore })
  const today = Date.now()

  return insights.filter((insight) => {
    if (filter.marketingOptInOnly && !insight.marketingOptIn) return false
    if (filter.statuses?.length && !filter.statuses.includes(insight.status)) return false
    if (typeof filter.dueWithinDays === 'number') {
      if (!insight.predictedNext) return false
      const days = Math.ceil((new Date(insight.predictedNext).getTime() - today) / 86_400_000)
      if (days > filter.dueWithinDays) return false
    }
    return true
  })
}
