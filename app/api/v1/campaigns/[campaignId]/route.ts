import { assertContext } from '@/lib/api/context'
import { campaignUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { updateCampaign } from '@/lib/services/campaigns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = createRoute({
  auth: 'required',
  capability: 'campaign:write',
  body: campaignUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { campaignId } = readParams(params, uuidParam('campaignId'))
    return ok(await updateCampaign(assertContext(auth), campaignId, body, { ipHash }), requestId)
  },
})
