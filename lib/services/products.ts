import { and, asc, eq, gt, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type { productCreateSchema, productListQuerySchema, productUpdateSchema } from '@/lib/api/contracts'
import type { ProductDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { decodeCursor, encodeCursor } from '@/lib/api/response'
import { db } from '@/lib/db/client'
import { toProductDto } from '@/lib/db/mappers'
import { products } from '@/lib/db/schema'
import type { Paginated } from './customers'

type CreateInput = z.infer<typeof productCreateSchema>
type UpdateInput = z.infer<typeof productUpdateSchema>
type ListQuery = z.infer<typeof productListQuerySchema>

export async function listProducts(context: AuthContext, query: ListQuery): Promise<Paginated<ProductDto>> {
  const conditions = [eq(products.organizationId, context.organization.id)]
  if (query.activeOnly === 'true') conditions.push(eq(products.isActive, true))
  if (query.category) conditions.push(eq(products.category, query.category))
  if (query.search) {
    const term = `%${query.search.replace(/[%_\\]/g, (match) => `\\${match}`)}%`
    const searchCondition = or(sql`${products.name} ilike ${term}`, sql`coalesce(${products.sku}, '') ilike ${term}`)
    if (searchCondition) conditions.push(searchCondition)
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  if (cursor) {
    conditions.push(
      or(
        gt(products.name, cursor.sort),
        and(eq(products.name, cursor.sort), gt(products.id, cursor.id)),
      )!,
    )
  }

  const rows = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(asc(products.name), asc(products.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)

  return {
    items: page.map(toProductDto),
    pagination: {
      limit: query.limit,
      cursor: query.cursor ?? null,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id, sort: last.name }) : null,
      total: page.length,
    },
  }
}

export async function getProduct(context: AuthContext, productId: string): Promise<ProductDto> {
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.organizationId, context.organization.id)))
    .limit(1)
  if (!row) throw ApiError.notFound('That product does not exist in this organization.')
  return toProductDto(row)
}

export async function createProduct(
  context: AuthContext,
  input: CreateInput,
  options: { ipHash?: string } = {},
): Promise<ProductDto> {
  const [row] = await db
    .insert(products)
    .values({
      organizationId: context.organization.id,
      name: input.name,
      sku: input.sku ?? null,
      category: input.category ?? null,
      unit: input.unit ?? 'unit',
      price: input.price,
      isActive: input.isActive,
    })
    .returning()

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'product.created',
    entityType: 'product',
    entityId: row.id,
    metadata: { name: row.name, price: Number(row.price) },
    ipHash: options.ipHash ?? null,
  })

  return toProductDto(row)
}

export async function updateProduct(
  context: AuthContext,
  productId: string,
  input: UpdateInput,
  options: { ipHash?: string } = {},
): Promise<ProductDto> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) patch.name = input.name
  if (input.sku !== undefined) patch.sku = input.sku ?? null
  if (input.category !== undefined) patch.category = input.category ?? null
  if (input.unit !== undefined) patch.unit = input.unit ?? 'unit'
  if (input.price !== undefined) patch.price = input.price
  if (input.isActive !== undefined) patch.isActive = input.isActive

  const [row] = await db
    .update(products)
    .set(patch)
    .where(and(eq(products.id, productId), eq(products.organizationId, context.organization.id)))
    .returning()

  if (!row) throw ApiError.notFound('That product does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'product.updated',
    entityType: 'product',
    entityId: row.id,
    metadata: { fields: Object.keys(patch).filter((key) => key !== 'updatedAt') },
    ipHash: options.ipHash ?? null,
  })

  return toProductDto(row)
}

export async function deactivateProduct(
  context: AuthContext,
  productId: string,
  options: { ipHash?: string } = {},
): Promise<{ id: string; deactivated: true }> {
  const [row] = await db
    .update(products)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(products.id, productId), eq(products.organizationId, context.organization.id)))
    .returning({ id: products.id, name: products.name })

  if (!row) throw ApiError.notFound('That product does not exist in this organization.')

  await writeAuditLog({
    organizationId: context.organization.id,
    actorUserId: context.user.id,
    action: 'product.deactivated',
    entityType: 'product',
    entityId: row.id,
    metadata: { name: row.name },
    ipHash: options.ipHash ?? null,
  })

  return { id: row.id, deactivated: true }
}
