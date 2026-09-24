import { assertContext } from '@/lib/api/context'
import { opportunityListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { listed } from '@/lib/api/response'
import { loadOpportunities } from '@/lib/services/insights'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'opportunity:read',
  query: opportunityListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const context = assertContext(auth)
    const items = await loadOpportunities(context.organization.id, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.minScore !== undefined ? { minScore: query.minScore } : {}),
      limit: query.limit,
    })
    return listed(items, { limit: query.limit, cursor: null, nextCursor: null, total: items.length }, requestId)
  },
})
