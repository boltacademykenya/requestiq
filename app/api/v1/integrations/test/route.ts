import { connectorProbeSchema } from '@/lib/api/contracts'
import { assertContext } from '@/lib/api/context'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { probeConnectorConnection } from '@/lib/services/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Tests a connection: one GET with the connection's own settings.
 *
 * Deliberately not scoped to an integration — the connector arrives in the body
 * (see `connectorProbeSchema`), so an operator can check a base URL and a
 * credential before enabling a resource or saving anything. `integrationId` is
 * optional and only lets a blank credential fall back to that connection's stored
 * one.
 *
 * The endpoint's own answer — including a 401 with its error body — comes back as
 * `data` with `ok: false`, because showing it is the point. Refusals that never
 * reached the endpoint (a blocked address, a timeout, a missing credential) fail
 * the request, since there is no response to display.
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  body: connectorProbeSchema,
  rateLimit: RATE_LIMITS.integrationTest,
  handler: async ({ auth, body, requestId }) => {
    const context = assertContext(auth)
    return ok(
      await probeConnectorConnection({
        organizationId: context.organization.id,
        connector: body.connector,
        ...(body.credential !== undefined ? { credential: body.credential } : {}),
        ...(body.integrationId ? { integrationId: body.integrationId } : {}),
        ...(body.path ? { path: body.path } : {}),
      }),
      requestId,
    )
  },
})
