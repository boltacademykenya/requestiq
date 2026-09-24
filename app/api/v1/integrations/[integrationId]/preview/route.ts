import { connectorPreviewSchema, uuidParam } from '@/lib/api/contracts'
import { assertContext } from '@/lib/api/context'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { previewConnector } from '@/lib/services/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Dry-runs a resource mapping: reads one page and returns the canonical rows that
 * *would* be written, plus why any row was rejected.
 *
 * Nothing is persisted, and it accepts an unsaved `connector` (and an unsaved
 * `credential`) so the editor can validate a configuration before saving it. An
 * omitted `credential` uses the stored one; an empty string means "send none".
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  body: connectorPreviewSchema,
  rateLimit: RATE_LIMITS.integrationPreview,
  handler: async ({ auth, body, params, requestId }) => {
    const context = assertContext(auth)
    const { integrationId } = readParams(params, uuidParam('integrationId'))
    return ok(
      await previewConnector({
        organizationId: context.organization.id,
        integrationId,
        resource: body.resource,
        ...(body.connector ? { connector: body.connector } : {}),
        ...(body.credential !== undefined ? { credential: body.credential } : {}),
        limit: body.limit,
      }),
      requestId,
    )
  },
})
