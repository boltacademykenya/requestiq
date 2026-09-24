import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type { OrderDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { decodeCursor, encodeCursor } from '@/lib/api/response'
import { db } from '@/lib/db/client'
import { toOrderDto } from '@/lib/db/mappers'
import { chunk } from '@/lib/db/query-utils'
import { customers, orderItems, orders, products } from '@/lib/db/schema'
import type { OrderSource, OrderStatus } from '@/lib/db/schema'
import { syncOpportunities } from './insights'

export type OrderActor = { organizationId: string; actorUserId: string | null }

export type OrderLineInput = {
  productId?: string
  productName: string
  quantity: number
  unitPrice?: number
}

export type CreateOrderInput = {
  customerId: string
  reference?: string
  status: OrderStatus
  source?: OrderSource
  paymentMethod?: string | null
  orderedAt?: Date
  notes?: string | null
  currency?: string
  items: OrderLineInput[]
}

const round2 = (value: number) => Math.round(value * 100) / 100

function referenceOf() {
  const stamp = Date.now().toString(36).toUpperCase()
  const noise = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `SO-${stamp}${noise}`.slice(0, 40)
}

/**
 * Prices are resolved server-side from the product catalogue: a client supplied
 * price is ignored whenever the line references a known product.
 */
async function priceLines(organizationId: string, items: OrderLineInput[]) {
  const catalogue = await db
    .select()
    .from(products)
    .where(and(eq(products.organizationId, organizationId), eq(products.isActive, true)))

  const byId = new Map(catalogue.map((row) => [row.id, row]))
  const byName = new Map(catalogue.map((row) => [row.name.toLowerCase(), row]))

  return items.map((item) => {
    const matched = item.productId ? byId.get(item.productId) : byName.get(item.productName.toLowerCase())
    const unitPrice = matched ? Number(matched.price) : item.unitPrice
    if (unitPrice === undefined) {
      throw ApiError.unprocessable(
        `"${item.productName}" is not in the product catalogue. Add the product or provide a unit price.`,
      )
    }
    return {
      productId: matched?.id ?? null,
      productName: matched?.name ?? item.productName,
      quantity: item.quantity,
      unitPrice: round2(unitPrice),
      lineTotal: round2(unitPrice * item.quantity),
    }
  })
}

/**
 * Creates an order with its line items inside a transaction and then refreshes
 * the affected customer's reorder opportunity.
 */
export async function createOrder(
  actor: OrderActor,
  input: CreateOrderInput,
  options: { ipHash?: string; audit?: boolean } = {},
): Promise<OrderDto> {
  const [customer] = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, actor.organizationId)))
    .limit(1)

  if (!customer) throw ApiError.unprocessable('The order must reference a customer in this organization.')

  const lines = await priceLines(actor.organizationId, input.items)
  const subtotal = round2(lines.reduce((total, line) => total + line.lineTotal, 0))
  const orderedAt = input.orderedAt ?? new Date()
  const status: OrderStatus = input.status

  let created: { orderId: string; reference: string } | null = null

  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const reference = input.reference ?? referenceOf()
    try {
      created = await db.transaction(async (tx) => {
        const [orderRow] = await tx
          .insert(orders)
          .values({
            organizationId: actor.organizationId,
            customerId: customer.id,
            reference,
            status,
            source: input.source ?? 'MANUAL',
            paymentMethod: input.paymentMethod ?? null,
            currency: input.currency ?? 'KES',
            subtotal,
            total: subtotal,
            orderedAt,
            notes: input.notes ?? null,
            createdByUserId: actor.actorUserId,
          })
          .returning({ id: orders.id, reference: orders.reference })

        await tx.insert(orderItems).values(
          lines.map((line) => ({
            organizationId: actor.organizationId,
            orderId: orderRow.id,
            productId: line.productId,
            productName: line.productName,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
          })),
        )

        if (status !== 'CANCELLED') {
          await tx
            .update(customers)
            .set({
              lastOrderAt: sql`greatest(coalesce(${customers.lastOrderAt}, to_timestamp(0)), ${orderedAt})`,
              updatedAt: new Date(),
            })
            .where(eq(customers.id, customer.id))
        }

        return { orderId: orderRow.id, reference: orderRow.reference }
      })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === '23505' && !input.reference && attempt < 2) continue
      throw error
    }
  }

  if (!created) throw ApiError.conflict('Could not generate a unique order reference. Please retry.')

  if (options.audit !== false) {
    await writeAuditLog({
      organizationId: actor.organizationId,
      actorUserId: actor.actorUserId,
      action: 'order.created',
      entityType: 'order',
      entityId: created.orderId,
      metadata: { reference: created.reference, total: subtotal, lines: lines.length, status },
      ipHash: options.ipHash ?? null,
    })
  }

  if (status !== 'CANCELLED') {
    try {
      await syncOpportunities(actor.organizationId, [customer.id])
    } catch (error) {
      console.error('[orders] opportunity refresh failed', error instanceof Error ? error.message : error)
    }
  }

  return loadOrder(actor.organizationId, created.orderId)
}

async function loadOrder(organizationId: string, orderId: string): Promise<OrderDto> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)))
    .limit(1)
  if (!row) throw ApiError.notFound('That order does not exist in this organization.')
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, row.id))
  return toOrderDto(row, items)
}

export type OrderListQuery = {
  limit: number
  cursor?: string
  customerId?: string
  status?: OrderStatus
  from?: string
  to?: string
}

export async function listOrders(
  organizationId: string,
  query: OrderListQuery,
): Promise<{ items: OrderDto[]; pagination: { limit: number; cursor: string | null; nextCursor: string | null } }> {
  const conditions = [eq(orders.organizationId, organizationId)]
  if (query.customerId) conditions.push(eq(orders.customerId, query.customerId))
  if (query.status) conditions.push(eq(orders.status, query.status))
  if (query.from) conditions.push(sql`${orders.orderedAt} >= ${new Date(`${query.from}T00:00:00.000Z`)}`)
  if (query.to) conditions.push(sql`${orders.orderedAt} <= ${new Date(`${query.to}T23:59:59.999Z`)}`)

  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  if (cursor) {
    conditions.push(sql`(${orders.orderedAt}, ${orders.id}) < (${new Date(cursor.sort)}, ${cursor.id}::uuid)`)
  }

  const rows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.orderedAt), desc(orders.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const page = rows.slice(0, query.limit)

  const itemsByOrder = new Map<string, (typeof orderItems.$inferSelect)[]>()
  for (const group of chunk(page.map((row) => row.id))) {
    const itemRows = await db.select().from(orderItems).where(inArray(orderItems.orderId, group))
    for (const item of itemRows) {
      const bucket = itemsByOrder.get(item.orderId)
      if (bucket) bucket.push(item)
      else itemsByOrder.set(item.orderId, [item])
    }
  }

  const last = page.at(-1)
  return {
    items: page.map((row) => toOrderDto(row, itemsByOrder.get(row.id) ?? [])),
    pagination: {
      limit: query.limit,
      cursor: query.cursor ?? null,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id, sort: last.orderedAt.toISOString() }) : null,
    },
  }
}

export async function getOrder(organizationId: string, orderId: string): Promise<OrderDto> {
  return loadOrder(organizationId, orderId)
}

export async function updateOrder(
  actor: OrderActor,
  orderId: string,
  patch: { status?: OrderStatus; paymentMethod?: string | null; notes?: string | null; orderedAt?: Date },
  options: { ipHash?: string } = {},
): Promise<OrderDto> {
  const update: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.status !== undefined) update.status = patch.status
  if (patch.paymentMethod !== undefined) update.paymentMethod = patch.paymentMethod
  if (patch.notes !== undefined) update.notes = patch.notes
  if (patch.orderedAt !== undefined) update.orderedAt = patch.orderedAt

  const [row] = await db
    .update(orders)
    .set(update)
    .where(and(eq(orders.id, orderId), eq(orders.organizationId, actor.organizationId)))
    .returning({ id: orders.id, customerId: orders.customerId })

  if (!row) throw ApiError.notFound('That order does not exist in this organization.')

  await writeAuditLog({
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    action: 'order.updated',
    entityType: 'order',
    entityId: row.id,
    metadata: { fields: Object.keys(update).filter((key) => key !== 'updatedAt') },
    ipHash: options.ipHash ?? null,
  })

  try {
    await syncOpportunities(actor.organizationId, [row.customerId])
  } catch (error) {
    console.error('[orders] opportunity refresh failed', error instanceof Error ? error.message : error)
  }

  return loadOrder(actor.organizationId, row.id)
}