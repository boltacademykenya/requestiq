import { assertContext } from '@/lib/api/context'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { loadOverview } from '@/lib/services/insights'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Dashboard payload: KPIs, status mix, forecast, interval buckets, top pipeline. */
export const GET = createRoute({
  auth: 'required',
  capability: 'customer:read',
  handler: async ({ auth, requestId }) => ok(await loadOverview(assertContext(auth).organization.id), requestId),
})
