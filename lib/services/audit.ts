import { and, desc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { AuthContext } from '@/lib/api/context'
import type { auditListQuerySchema } from '@/lib/api/contracts'
import type { AuditLogDto } from '@/lib/api/dto'
import { db } from '@/lib/db/client'
import { toAuditLogDto } from '@/lib/db/mappers'
import { auditLogs } from '@/lib/db/schema'
import type { Paginated } from './customers'

type ListQuery = z.infer<typeof auditListQuerySchema>

/** Tenant-scoped audit trail (owners and admins only). */
export async function listAuditLogs(context: AuthContext, query: ListQuery): Promise<Paginated<AuditLogDto>> {
  const conditions = [eq(auditLogs.organizationId, context.organization.id)]
  if (query.entityType) conditions.push(eq(auditLogs.entityType, query.entityType))

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.limit)

  return {
    items: rows.map(toAuditLogDto),
    pagination: { limit: query.limit, cursor: null, nextCursor: null, total: rows.length },
  }
}
