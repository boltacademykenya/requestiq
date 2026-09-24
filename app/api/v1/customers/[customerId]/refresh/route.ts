import { uuidParam } from '@/lib/api/contracts'
import { assertContext } from '@/lib/api/context'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { refreshCustomer } from '@/lib/services/customer-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Re-pulls this customer's history from every source that knows them.
 *
 * Gated on `integration:manage`, not `customer:write`: this reads a tenant's
 * external systems, the same privilege the Integrations tab requires. It re-runs
 * the connections that hold an alias for the customer, which is the honest
 * meaning of "refresh this customer" without a single-record connector resource.
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  rateLimit: RATE_LIMITS.integrationSync,
  handler: async ({ auth, params, requestId, ipHash }) => {
    const { customerId } = readParams(params, uuidParam('customerId'))
    return ok(await refreshCustomer(assertContext(auth), customerId, { ipHash }), requestId)
  },
})
