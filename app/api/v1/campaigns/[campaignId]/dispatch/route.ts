import { assertContext } from '@/lib/api/context'
import { campaignDispatchSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { dispatchCampaign } from '@/lib/services/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Queues the campaign for its audience using the run-safe DEMO message provider. */
export const POST = createRoute({
  auth: 'required',
  capability: 'campaign:write',
  body: campaignDispatchSchema,
  rateLimit: { name: 'campaign_dispatch', limit: 10, windowSeconds: 300 },
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { campaignId } = readParams(params, uuidParam('campaignId'))
    return ok(await dispatchCampaign(assertContext(auth), campaignId, body, { ipHash }), requestId)
  },
})
