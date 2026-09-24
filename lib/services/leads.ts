import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { writeAuditLog } from '@/lib/api/audit'
import type { contactSchema, leadListQuerySchema } from '@/lib/api/contracts'
import type { LeadDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { toLeadDto } from '@/lib/db/mappers'
import { contactSubmissions } from '@/lib/db/schema'
import type { Paginated } from './customers'
import { hashIp } from '@/lib/api/request-identity'

type ContactInput = z.infer<typeof contactSchema>
type LeadListQuery = z.infer<typeof leadListQuerySchema>

export type LeadStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED' | 'SPAM'

/**
 * Stores a public contact submission.
 *
 * Protections: honeypot rejection, duplicate suppression (same email + message
 * within 10 minutes returns the original record) and IP hashing instead of
 * storing raw addresses.
 */
export async function submitContact(
  input: ContactInput,
  meta: { ip: string; userAgent: string | null },
): Promise<{ id: string; createdAt: Date; duplicate: boolean }> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)

  const [duplicate] = await db
    .select({ id: contactSubmissions.id, createdAt: contactSubmissions.createdAt })
    .from(contactSubmissions)
    .where(
      and(
        sql`lower(${contactSubmissions.email}) = ${input.email}`,
        eq(contactSubmissions.message, input.message),
        gte(contactSubmissions.createdAt, tenMinutesAgo),
      ),
    )
    .orderBy(desc(contactSubmissions.createdAt))
    .limit(1)

  if (duplicate) return { id: duplicate.id, createdAt: duplicate.createdAt, duplicate: true }

  const [row] = await db
    .insert(contactSubmissions)
    .values({
      name: input.name,
      businessName: input.business,
      email: input.email,
      phone: input.phone && input.phone.length ? input.phone : null,
      topic: input.topic,
      message: input.message,
      status: 'NEW',
      sourceIpHash: hashIp(meta.ip),
      userAgent: meta.userAgent,
    })
    .returning({ id: contactSubmissions.id, createdAt: contactSubmissions.createdAt })

  return { id: row.id, createdAt: row.createdAt, duplicate: false }
}

/**
 * Lists inbound contact-form submissions **platform-wide**.
 *
 * There is intentionally no tenant filter: the public contact form is anonymous,
 * so a submission cannot belong to an organization. This is therefore ReorderIQ's
 * own sales inbox and is only reachable through the platform-admin surface —
 * never from a tenant workspace. Do not add an `organizationId` filter here
 * expecting isolation; add the tenant column and populate it at submission time
 * instead.
 */
export async function listLeads(query: LeadListQuery): Promise<Paginated<LeadDto>> {
  const conditions = []
  if (query.status) conditions.push(eq(contactSubmissions.status, query.status))

  const rows = await db
    .select()
    .from(contactSubmissions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(contactSubmissions.createdAt))
    .limit(query.limit)

  return {
    items: rows.map(toLeadDto),
    pagination: { limit: query.limit, cursor: null, nextCursor: null, total: rows.length },
  }
}

export async function updateLeadStatus(
  actor: { id: string },
  leadId: string,
  status: LeadStatus,
  options: { ipHash?: string } = {},
): Promise<LeadDto> {
  const [row] = await db
    .update(contactSubmissions)
    .set({ status, handledAt: status === 'NEW' ? null : new Date() })
    .where(eq(contactSubmissions.id, leadId))
    .returning()

  if (!row) throw ApiError.notFound('That enquiry does not exist.')

  await writeAuditLog({
    // Platform-level event: it belongs to no tenant, so it must not be written
    // into whichever organization the staff member happens to be a member of.
    organizationId: null,
    actorUserId: actor.id,
    action: 'lead.status_changed',
    entityType: 'contact_submission',
    entityId: row.id,
    metadata: { status },
    ipHash: options.ipHash ?? null,
  })

  return toLeadDto(row)
}
