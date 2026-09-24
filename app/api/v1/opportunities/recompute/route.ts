import { assertContext } from '@/lib/api/context'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { loadOpportunities, syncOpportunities } from '@/lib/services/insights'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recomputes reorder opportunities for the whole organization from current
 * order history. Idempotent; safe to run after a bulk import.
 */
export const POST = createRoute({
  auth: 'required',
  capability: 'opportunity:read',
  rateLimit: { name: 'opportunity_recompute', limit: 6, windowSeconds: 300 },
  handler: async ({ auth, requestId }) => {
    const context = assertContext(auth)
    const synced = await syncOpportunities(context.organization.id)
    const items = await loadOpportunities(context.organization.id, { limit: 500 })
    return ok({ opportunityCount: synced, opportunities: items }, requestId)
  },
})
