import { and, eq } from 'drizzle-orm'
import { assertContext } from '@/lib/api/context'
import { opportunityUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { writeAuditLog } from '@/lib/api/audit'
import { ApiError } from '@/lib/api/errors'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { db } from '@/lib/db/client'
import { toOpportunityDto } from '@/lib/db/mappers'
import { customers, opportunities } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = uuidParam('opportunityId')

/** Updates the pipeline state of a reorder opportunity. */
export const PATCH = createRoute({
  auth: 'required',
  capability: 'opportunity:write',
  body: opportunityUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const context = assertContext(auth)
    const { opportunityId } = readParams(params, paramsSchema)

    const patch: Record<string, unknown> = { status: body.status, updatedAt: new Date() }
    if (body.expectedValue !== undefined) patch.expectedValue = body.expectedValue
    if (body.probability !== undefined) patch.probability = body.probability
    if (body.status === 'CONTACTED') patch.lastContactedAt = new Date()

    const [row] = await db
      .update(opportunities)
      .set(patch)
      .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, context.organization.id)))
      .returning()

    if (!row) throw ApiError.notFound('That opportunity does not exist in this organization.')

    const [customer] = await db
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, row.customerId))
      .limit(1)

    await writeAuditLog({
      organizationId: context.organization.id,
      actorUserId: context.user.id,
      action: 'opportunity.updated',
      entityType: 'opportunity',
      entityId: row.id,
      metadata: { status: row.status },
      ipHash,
    })

    return ok(toOpportunityDto(row, customer?.name ?? 'Unknown customer'), requestId)
  },
})
