import { and, asc, eq } from 'drizzle-orm'
import { writeAuditLog } from '@/lib/api/audit'
import type { AuthContext } from '@/lib/api/context'
import type { CustomerRefreshDto } from '@/lib/api/dto'
import { ApiError } from '@/lib/api/errors'
import { db } from '@/lib/db/client'
import { customerSources, customers, integrations } from '@/lib/db/schema'
import { runIntegrationSync } from './sync'

/**
 * Refreshes the sources that actually know a customer.
 *
 * There is deliberately no "fetch this one record" operation in the connector
 * spec, so promising a single-record refresh would be a lie. What is honest and
 * implementable is: find the connections that hold an alias for this customer and
 * re-run each of them, then report what each one did. That re-pulls the
 * customer's order history from the systems that have it — which is what the
 * person clicking the button actually wants.
 *
 * A connection that is already syncing is reported as skipped rather than as a
 * failure: the run in flight will pick up the same data.
 */
export async function refreshCustomer(
  context: AuthContext,
  customerId: string,
  options: { ipHash?: string | null } = {},
): Promise<CustomerRefreshDto> {
  const organizationId = context.organization.id

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
    .limit(1)
  if (!customer) throw ApiError.notFound('That customer does not exist in this organization.')

  const aliases = await db
    .select({
      integrationId: customerSources.integrationId,
      provider: integrations.provider,
      displayName: integrations.displayName,
    })
    .from(customerSources)
    .innerJoin(integrations, eq(integrations.id, customerSources.integrationId))
    .where(and(eq(customerSources.organizationId, organizationId), eq(customerSources.customerId, customerId)))
    .orderBy(asc(customerSources.firstSeenAt))

  const connections: CustomerRefreshDto['connections'] = []
  const seen = new Set<string>()

  for (const alias of aliases) {
    if (seen.has(alias.integrationId)) continue
    seen.add(alias.integrationId)

    const base = {
      integrationId: alias.integrationId,
      provider: alias.provider,
      displayName: alias.displayName,
    }

    try {
      const result = await runIntegrationSync({
        organizationId,
        integrationId: alias.integrationId,
        trigger: 'MANUAL',
        actorUserId: context.user.id,
        ipHash: options.ipHash ?? null,
      })
      connections.push({
        ...base,
        outcome: result.run.status === 'FAILED' ? 'FAILED' : 'SYNCED',
        reason: result.run.error,
        run: result.run,
      })
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409
      connections.push({
        ...base,
        outcome: conflict ? 'SKIPPED' : 'FAILED',
        reason: error instanceof ApiError ? error.message : 'This connection could not be refreshed.',
        run: null,
      })
    }
  }

  await writeAuditLog({
    organizationId,
    actorUserId: context.user.id,
    action: 'customer.refreshed',
    entityType: 'customer',
    entityId: customerId,
    metadata: { connections: connections.map((entry) => ({ integrationId: entry.integrationId, outcome: entry.outcome })) },
    ipHash: options.ipHash ?? null,
  })

  return { customerId, connections }
}
