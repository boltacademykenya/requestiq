import { assertContext } from '@/lib/api/context'
import { campaignCreateSchema, campaignListQuerySchema } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { created, listed } from '@/lib/api/response'
import { createCampaign, listCampaigns } from '@/lib/services/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = createRoute({
  auth: 'required',
  capability: 'campaign:read',
  query: campaignListQuerySchema,
  handler: async ({ auth, query, requestId }) => {
    const result = await listCampaigns(assertContext(auth), query)
    return listed(result.items, result.pagination, requestId)
  },
})

export const POST = createRoute({
  auth: 'required',
  capability: 'campaign:write',
  body: campaignCreateSchema,
  handler: async ({ auth, body, requestId, ipHash }) =>
    created(await createCampaign(assertContext(auth), body, { ipHash }), requestId),
})
