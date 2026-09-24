import { and, eq, ne, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type { customerCreateSchema, customerListQuerySchema, customerUpdateSchema } from '@/lib/api/contracts'
import type { CustomerInsightDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { decodeCursor, encodeCursor } from '@/lib/api/response'
import { db } from '@/lib/db/client'
import { toCustomerInsightDto } from '@/lib/db/mappers'
import { campaignRecipients, customerSources, customers, messages, opportunities, orders } from '@/lib/db/schema'
import { applyLastOrderAt } from './ingest'
import { loadCustomerInsight, loadCustomerInsights } from './insights'

type CreateInput = z.infer<typeof customerCreateSchema>
type UpdateInput = z.infer<typeof customerUpdateSchema>
type ListQuery = z.infer<typeof customerListQuerySchema>

export type Paginated<T> = {
  items: T[]
  pagination: { limit: number; cursor: string | null; nextCursor: string | null; total: number }
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
}

function normaliseOptional(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function sortInsights(items: CustomerInsightDto[], sort: ListQuery['sort']) {
  switch (sort) {
    case 'recent':
      return items.sort(
        (a, b) => new Date(b.lastOrderAt ?? b.createdAt).getTime() - new Date(a.lastOrderAt ?? a.createdAt).getTime(),
      )
    case 'score':
      return items.sort((a, b) => b.reorderScore - a.reorderScore)
    case 'spend':
      return items.sort((a, b) => b.totalSpend - a.totalSpend)
    default:
      return items.sort((a, b) => a.name.localeCompare(b.name))
  }
}

export async function listCustomers(context: AuthContext, query: ListQuery): Promise<Paginated<CustomerInsightDto>> {
  const insights = await loadCustomerInsights(context.organization.id, {
    ...(query.search ? { search: query.search } : {}),
    ...(query.source ? { integrationId: query.source } : {}),
  })
  const filtered = query.status ? insights.filter((insight) => insight.status === query.status) : insights
  const sorted = sortInsights(filtered, query.sort)

  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const startIndex = cursor ? sorted.findIndex((insight) => insight.id === cursor.id) + 1 : 0
  const page = sorted.slice(startIndex, startIndex + query.limit)
  const last = page.at(-1)

  return {
    items: page,
    pagination: {
      limit: query.limit,
      cursor: query.cursor ?? null,
      nextCursor:
        last && startIndex + query.limit < sorted.length ? encodeCursor({ id: last.id, sort: query.sort }) : null,
      total: sorted.length,
    },
  }
}

export async function getCustomer(context: AuthContext, customerId: string): Promise<CustomerInsightDto> {
  const insight = await loadCustomerInsight(context.organization.id, customerId)
  if (!insight) throw ApiError.notFound('That customer does not exist in this organization.')
  return insight
}

export async function createCustomer(
  context: AuthContext,
  input: CreateInput,
  options: { ipHash?: string } = {},
): Promise<CustomerInsightDto> {
  const [row] = await db
    .insert(customers)
    .values({
      organizationId: context.organization.id,
      name: input.name,
      initials: initialsOf(input.name),
      phone: input.phone,
      email: normaliseOptional(input.email),
      location: normaliseOptional(input.location) ?? context.organization.country,
      customerType: input.customerType ?? 'BUSINESS',
      assignedSalesperson: normaliseOptional(input.assignedSalesperson),
      marketingOptIn: input.marketingOptIn,
      notes: normaliseOptional(input.notes),
    })
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'customer.created',
    entityType: 'customer',
    entityId: row.id,
    metadata: { name: row.name },
    ipHash: options.ipHash ?? null,
  })

  return toCustomerInsightDto(row, [])
}

export async function updateCustomer(
  context: AuthContext,
  customerId: string,
  input: UpdateInput,
  options: { ipHash?: string } = {},
): Promise<CustomerInsightDto> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    patch.name = input.name
    patch.initials = initialsOf(input.name)
  }
  if (input.phone !== undefined) patch.phone = input.phone
  if (input.email !== undefined) patch.email = normaliseOptional(input.email)
  if (input.location !== undefined) patch.location = normaliseOptional(input.location)
  if (input.customerType !== undefined) patch.customerType = input.customerType ?? 'BUSINESS'
  if (input.assignedSalesperson !== undefined) patch.assignedSalesperson = normaliseOptional(input.assignedSalesperson)
  if (input.marketingOptIn !== undefined) patch.marketingOptIn = input.marketingOptIn
  if (input.notes !== undefined) patch.notes = normaliseOptional(input.notes)
  if (input.isActive !== undefined) patch.isActive = input.isActive

  const [row] = await db
    .update(customers)
    .set(patch)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, context.organization.id)))
    .returning()

  if (!row) throw ApiError.notFound('That customer does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'customer.updated',
    entityType: 'customer',
    entityId: row.id,
    metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    ipHash: options.ipHash ?? null,
  })

  return getCustomer(context, row.id)
}

/**
 * Soft delete: order history is retained for reporting, the customer simply
 * stops appearing in lists and predictions.
 */
export async function deactivateCustomer(
  context: AuthContext,
  customerId: string,
  options: { ipHash?: string } = {},
): Promise<{ id: string; deactivated: true }> {
  const [row] = await db
    .update(customers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, context.organization.id)))
    .returning({ id: customers.id, name: customers.name })

  if (!row) throw ApiError.notFound('That customer does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'customer.deactivated',
    entityType: 'customer',
    entityId: row.id,
    metadata: { name: row.name },
    ipHash: options.ipHash ?? null,
  })

  return { id: row.id, deactivated: true }
}

/** Whether another customer already holds this email (the org-wide unique key). */
async function emailIsTaken(organizationId: string, email: string, exceptCustomerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, organizationId),
        sql`lower(${customers.email}) = ${email.toLowerCase()}`,
        ne(customers.id, exceptCustomerId),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * Merges a duplicate customer into the one you keep.
 *
 * Duplicates are inevitable once more than one source is connected: someone
 * re-enters a buyer without the old email, a storefront and an ERP each invent a
 * record. A merge is the *only* safe way to fix that, because the alternative —
 * two canonical customers holding half a purchase history each — silently breaks
 * the reorder intervals the whole product predicts from.
 *
 * The survivor keeps its id (so links, messages and opportunities stay valid),
 * absorbs the duplicate's orders, aliases, messages and opportunity rows, and is
 * filled in with any contact detail the duplicate had and it did not. The
 * duplicate is then soft-deleted, never hard-deleted: its id stays in the audit
 * trail so a wrong merge can be investigated.
 */
export async function mergeCustomers(
  context: AuthContext,
  primaryId: string,
  duplicateId: string,
  options: { ipHash?: string } = {},
): Promise<CustomerInsightDto> {
  if (primaryId === duplicateId) {
    throw ApiError.unprocessable('A customer cannot be merged into itself.')
  }

  const organizationId = context.organization.id
  const [primary] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, primaryId), eq(customers.organizationId, organizationId)))
    .limit(1)
  const [duplicate] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, duplicateId), eq(customers.organizationId, organizationId)))
    .limit(1)

  if (!primary || !duplicate) {
    throw ApiError.notFound('That customer does not exist in this organization.')
  }
  if (!primary.isActive) {
    throw ApiError.unprocessable('The customer you are keeping has been removed. Reactivate it first.')
  }

  const fillIn = {
    ...(primary.email === null && duplicate.email !== null && !(await emailIsTaken(organizationId, duplicate.email, primaryId))
      ? { email: duplicate.email }
      : {}),
    ...(primary.location === null && duplicate.location !== null ? { location: duplicate.location } : {}),
    ...(primary.assignedSalesperson === null && duplicate.assignedSalesperson !== null
      ? { assignedSalesperson: duplicate.assignedSalesperson }
      : {}),
    ...(primary.notes === null && duplicate.notes !== null ? { notes: duplicate.notes } : {}),
  }

  let movedOrders = 0

  await db.transaction(async (tx) => {
    // Rows that carry a uniqueness rule of their own are cleared of the clash
    // before the repoint, otherwise the survivor would be merged into a
    // duplicate-key error on the first of them.
    await tx.execute(sql`
      delete from customer_sources
      where organization_id = ${organizationId} and customer_id = ${duplicateId}
        and exists (
          select 1 from customer_sources s
          where s.organization_id = ${organizationId}
            and s.customer_id = ${primaryId}
            and s.integration_id = customer_sources.integration_id
            and s.external_id = customer_sources.external_id
        )
    `)
    await tx
      .update(customerSources)
      .set({ customerId: primaryId })
      .where(and(eq(customerSources.organizationId, organizationId), eq(customerSources.customerId, duplicateId)))

    await tx.execute(sql`
      delete from opportunities
      where organization_id = ${organizationId} and customer_id = ${duplicateId}
        and exists (
          select 1 from opportunities o
          where o.organization_id = ${organizationId}
            and o.customer_id = ${primaryId}
            and o.expected_date = opportunities.expected_date
        )
    `)
    await tx
      .update(opportunities)
      .set({ customerId: primaryId, updatedAt: new Date() })
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.customerId, duplicateId)))

    await tx.execute(sql`
      delete from campaign_recipients
      where organization_id = ${organizationId} and customer_id = ${duplicateId}
        and exists (
          select 1 from campaign_recipients r
          where r.organization_id = ${organizationId}
            and r.customer_id = ${primaryId}
            and r.campaign_id = campaign_recipients.campaign_id
        )
    `)
    await tx
      .update(campaignRecipients)
      .set({ customerId: primaryId })
      .where(
        and(eq(campaignRecipients.organizationId, organizationId), eq(campaignRecipients.customerId, duplicateId)),
      )

    // This is the merge the product exists for: one buyer, one complete history.
    const repointed = await tx
      .update(orders)
      .set({ customerId: primaryId, updatedAt: new Date() })
      .where(and(eq(orders.organizationId, organizationId), eq(orders.customerId, duplicateId)))
      .returning({ id: orders.id })
    movedOrders = repointed.length

    await tx
      .update(messages)
      .set({ customerId: primaryId })
      .where(and(eq(messages.organizationId, organizationId), eq(messages.customerId, duplicateId)))

    await tx
      .update(customers)
      .set({ ...fillIn, isActive: false, updatedAt: new Date() })
      .where(and(eq(customers.id, duplicateId), eq(customers.organizationId, organizationId)))
  })

  // The survivor's "last order" may have come from the duplicate's history.
  await applyLastOrderAt(organizationId, [primaryId])

  await writeAuditLog({
    organizationId,
    actorUserId: context.user.id,
    action: 'customer.merged',
    entityType: 'customer',
    entityId: primaryId,
    metadata: {
      duplicateId,
      duplicateName: duplicate.name,
      ordersMoved: movedOrders,
      fieldsAbsorbed: Object.keys(fillIn),
    },
    ipHash: options.ipHash ?? null,
  })

  return getCustomer(context, primaryId)
}