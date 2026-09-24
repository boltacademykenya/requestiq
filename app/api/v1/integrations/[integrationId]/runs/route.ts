import { syncRunListQuerySchema, uuidParam } from '@/lib/api/contracts'
import { assertContext } from '@/lib/api/context'
import { createRoute } from '@/lib/api/route'
import { listed } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { listSyncRuns } from '@/lib/services/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Recent sync attempts for a connection: what ran, what it wrote and what it rejected. */
export const GET = createRoute({
  auth: 'required',
  capability: 'integration:read',
  query: syncRunListQuerySchema,
  handler: async ({ auth, query, params, requestId }) => {
    const context = assertContext(auth)
    const { integrationId } = readParams(params, uuidParam('integrationId'))
    const runs = await listSyncRuns(context.organization.id, integrationId, query.limit)
    return listed(runs, { limit: query.limit, cursor: null, nextCursor: null }, requestId)
  },
})
