import { leadListQuerySchema } from '@/lib/api/contracts'
import { RATE_LIMITS } from '@/lib/api/rate-limit'
import { createRoute } from '@/lib/api/route'
import { listed } from '@/lib/api/response'
import { listLeads } from '@/lib/services/leads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Inbound contact-form enquiries — **platform surface**.
 *
 * Submissions arrive through an anonymous public form, so they cannot be
 * attributed to a tenant and are deliberately not exposed anywhere in the tenant
 * API. This route is reserved for the ReorderIQ team via `PLATFORM_ADMIN_EMAILS`
 * and therefore declares no capability: no tenant role can ever reach it.
 *
 * Once staff are established as platform owners of this data, the next step is
 * to record which staff member read or changed what; `updateLeadStatus` already
 * writes a platform-level audit event.
 */
export const GET = createRoute({
  auth: 'session',
  platformAdmin: true,
  query: leadListQuerySchema,
  rateLimit: RATE_LIMITS.api,
  handler: async ({ query, requestId }) => {
    const result = await listLeads(query)
    return listed(result.items, result.pagination, requestId)
  },
})
