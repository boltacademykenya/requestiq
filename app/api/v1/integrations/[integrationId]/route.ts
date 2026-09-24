import { assertContext } from '@/lib/api/context'
import { integrationUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { noContent, ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { removeIntegration, updateIntegration } from '@/lib/services/integrations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  body: integrationUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { integrationId } = readParams(params, uuidParam('integrationId'))
    return ok(await updateIntegration(assertContext(auth), integrationId, body, { ipHash }), requestId)
  },
})

export const DELETE = createRoute({
  auth: 'required',
  capability: 'integration:manage',
  handler: async ({ auth, params, requestId, ipHash }) => {
    const { integrationId } = readParams(params, uuidParam('integrationId'))
    await removeIntegration(assertContext(auth), integrationId, { ipHash })
    return noContent(requestId)
  },
})
