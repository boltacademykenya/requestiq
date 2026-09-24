import { uuidParam } from '@/lib/api/contracts'
import { assertContext } from '@/lib/api/context'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { runIntegrationSync } from '@/lib/services/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Runs this connection's sync now.
 *
 * The same engine the scheduler drives, so what an operator sees here is exactly
 * what the scheduled run will do. Rate limited because a run reads the whole
 * source, and it ends by recomputing the affected customers' opportunities.
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  rateLimit: RATE_LIMITS.integrationSync,
  handler: async ({ auth, params, requestId, ipHash }) => {
    const context = assertContext(auth)
    const { integrationId } = readParams(params, uuidParam('integrationId'))
    return ok(
      await runIntegrationSync({
        organizationId: context.organization.id,
        integrationId,
        trigger: 'MANUAL',
        actorUserId: context.user.id,
        ipHash,
      }),
      requestId,
    )
  },
})
