import { assertContext } from '@/lib/api/context'
import { customerUpdateSchema, uuidParam } from '@/lib/api/contracts'
import { createRoute } from '@/lib/api/route'
import { noContent, ok } from '@/lib/api/response'
import { readParams } from '@/lib/api/validation'
import { deactivateCustomer, getCustomer, updateCustomer } from '@/lib/services/customers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = uuidParam('customerId')

export const GET = createRoute({
  auth: 'required',
  capability: 'customer:read',
  handler: async ({ auth, params, requestId }) => {
    const { customerId } = readParams(params, paramsSchema)
    return ok(await getCustomer(assertContext(auth), customerId), requestId)
  },
})

export const PATCH = createRoute({
  auth: 'required',
  capability: 'customer:write',
  body: customerUpdateSchema,
  handler: async ({ auth, body, params, requestId, ipHash }) => {
    const { customerId } = readParams(params, paramsSchema)
    return ok(await updateCustomer(assertContext(auth), customerId, body, { ipHash }), requestId)
  },
})

/** Soft delete: history is preserved, the customer leaves active views. */
export const DELETE = createRoute({
  auth: 'required',
  capability: 'customer:write',
  handler: async ({ auth, params, requestId, ipHash }) => {
    const { customerId } = readParams(params, paramsSchema)
    await deactivateCustomer(assertContext(auth), customerId, { ipHash })
    return noContent(requestId)
  },
})
